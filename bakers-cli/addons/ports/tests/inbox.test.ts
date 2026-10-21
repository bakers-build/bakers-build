import { mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InboxMessageRequest } from '@bakers-build/conductor/contract';
import { describe, expect, it, vi } from 'vitest';
import type { ClaimedDiscovery, ClaimedService } from '../src/claims.js';
import { PORTS_NEEDS_ENTRY } from '../src/config.js';
import type { TunnelDesiredRecord } from '../src/core.js';
import {
  handlersFor,
  type TunnelHandlerDeps,
  tunnelHandlers,
} from '../src/inbox.js';

function service(
  overrides: Partial<ClaimedService> & { key: string },
): ClaimedService {
  return {
    claim: 'ddev',
    status: 'healthy',
    local: `https://${overrides.key}.ddev.site`,
    rawPorts: [],
    rules: [{ key: overrides.key, service: 'https://127.0.0.1:443' }],
    ...overrides,
  };
}

const drupalAdmin = service({ key: 'drupal-admin' });
const drupalMembers = service({ key: 'drupal-members' });
const unclaimed = service({
  key: 'vite',
  status: 'dead',
  rules: [],
  limitation: 'configured port 5173 is dead',
});
const stopped = service({ key: 'xhgui', status: 'stopped', rules: [] });
const fallbackDrupal = service({
  key: 'drupal',
  limitation: 'anonymous preview; tunnel login unsupported',
});

function fixture(
  services: ClaimedService[],
  options: {
    initialRecords?: TunnelDesiredRecord[];
    bringUpResult?: { ok: boolean; message: string };
    cancelled?: boolean;
  } = {},
) {
  const calls: string[] = [];
  let records: TunnelDesiredRecord[] = options.initialRecords ?? [];
  const deps: TunnelHandlerDeps = {
    discover: async (): Promise<ClaimedDiscovery> => ({ services }),
    readRecords: async () => records,
    bringUp: async (svc, ctx) => {
      calls.push(`up:${svc.key}`);
      if (options.cancelled) expect(ctx.signal?.aborted).toBeDefined();
      if (options.bringUpResult && !options.bringUpResult.ok) {
        records = [
          ...records.filter((r) => r.key !== svc.key),
          {
            worktree: ctx.worktree,
            ticket: ctx.ticket,
            key: svc.key,
            hostname: `${ctx.ticket}-${svc.key}.example.test`,
            service: svc.rules[0]!.service,
            desired: 'present',
            applied: 'error',
            error: options.bringUpResult.message,
          },
        ];
        return options.bringUpResult;
      }
      records = [
        ...records.filter((r) => r.key !== svc.key),
        {
          worktree: ctx.worktree,
          ticket: ctx.ticket,
          key: svc.key,
          hostname: `${ctx.ticket}-${svc.key}.example.test`,
          service: svc.rules[0]!.service,
          desired: 'present',
          applied: 'applied',
        },
      ];
      return options.bringUpResult ?? { ok: true, message: 'shared' };
    },
    loadTransport: async () => ({
      ok: true,
      transport: {
        id: 'test-transport',
        identity: 'test-transport',
        zone: 'example.test',
        validateData: () => {},
        reconcile: async (records) => ({ records, ok: true }),
      },
    }),
    home: () => '/home/.bakers',
  };
  return { deps, calls, records: () => records };
}

const request = {
  id: 'req-1',
  worktreePath: '/wt',
  ticket: { identifier: 'PYNQ-42' },
} as InboxMessageRequest;

describe('ports tunnel handler', () => {
  it('shares every eligible service and renders both multisite keys on the markdown', async () => {
    const { deps, calls } = fixture([drupalAdmin, drupalMembers]);
    const result = await tunnelHandlers(deps).tunnel?.(request);
    expect(calls).toEqual(['up:drupal-admin', 'up:drupal-members']);
    expect(result?.markdown).toContain('drupal-admin');
    expect(result?.markdown).toContain('drupal-members');
    expect(result?.markdown).toContain('PYNQ-42-drupal-admin.example.test');
  });

  it('never shares an unclaimed, dead or stopped service', async () => {
    const { deps, calls } = fixture([unclaimed, stopped]);
    const result = await tunnelHandlers(deps).tunnel?.(request);
    expect(calls).toEqual([]);
    expect(calls).not.toContain('up:vite');
    expect(result?.markdown).toContain('no addon');
    expect(result?.markdown).toContain('not running');
  });

  it('re-shares a service already applied on a repeated request — BB-681 review C4: no already-applied fast path, so a dead route recovers', async () => {
    const { deps, calls } = fixture([drupalAdmin]);
    await tunnelHandlers(deps).tunnel?.(request);
    const result = await tunnelHandlers(deps).tunnel?.(request);
    expect(calls).toEqual(['up:drupal-admin', 'up:drupal-admin']);
    expect(result?.markdown).toContain('drupal-admin');
  });

  it('resolves a symlinked worktree path before discovery, sharing and record reads — BB-693', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'bb-693-')));
    const real = mkdtempSync(join(root, 'wt-'));
    const link = join(root, 'link');
    symlinkSync(real, link);
    const seen: string[] = [];
    const { deps } = fixture([drupalAdmin]);
    const result = await tunnelHandlers({
      ...deps,
      discover: async (worktree, ...rest) => {
        seen.push(`discover:${worktree}`);
        return deps.discover(worktree, ...rest);
      },
      bringUp: async (svc, ctx) => {
        seen.push(`up:${ctx.worktree}`);
        return deps.bringUp(svc, ctx);
      },
      readRecords: async (worktree) => {
        seen.push(`read:${worktree}`);
        return deps.readRecords(worktree);
      },
    }).tunnel?.({ ...request, worktreePath: link } as InboxMessageRequest);
    expect(seen).toEqual([`discover:${real}`, `up:${real}`, `read:${real}`]);
    expect(result?.markdown).toContain('drupal-admin');
  });

  it('answers only `markdown` — no rows, columns or level', async () => {
    const { deps } = fixture([]);
    const result = await tunnelHandlers(deps).tunnel?.(request);
    expect(result).toEqual({ markdown: 'No services found in this worktree.' });
  });

  it('re-shares a record whose applied state is pending or error, not treating it as live', async () => {
    const { deps, calls } = fixture([drupalAdmin], {
      initialRecords: [
        {
          worktree: '/wt',
          ticket: 'PYNQ-42',
          key: 'drupal-admin',
          hostname: 'PYNQ-42-drupal-admin.example.test',
          service: 'https://127.0.0.1:443',
          desired: 'present',
          applied: 'error',
          error: 'previous failure',
        },
      ],
    });
    const result = await tunnelHandlers(deps).tunnel?.(request);
    expect(calls).toEqual(['up:drupal-admin']);
    expect(result?.markdown).toContain('drupal-admin');
  });

  it('reports a failed bringUp instead of silently omitting the service', async () => {
    const { deps } = fixture([drupalAdmin], {
      bringUpResult: { ok: false, message: 'cloudflared config upload failed' },
    });
    const result = await tunnelHandlers(deps).tunnel?.(request);
    expect(result?.markdown).toContain('drupal-admin');
    expect(result?.markdown).toContain('cloudflared config upload failed');
  });

  it('reports the login limitation for an unprepared Drupal fallback', async () => {
    const { deps } = fixture([fallbackDrupal]);
    const result = await tunnelHandlers(deps).tunnel?.(request);
    expect(result?.markdown).toContain('tunnel login unsupported');
  });

  it('answers the loader’s own redacted diagnostic — BB-681 review I5: the inbox must not collapse every failure to one generic line while the CLI reports the real one', async () => {
    const { deps, calls } = fixture([drupalAdmin]);
    deps.loadTransport = async () => ({
      ok: false,
      message: PORTS_NEEDS_ENTRY,
    });
    const result = await tunnelHandlers(deps).tunnel?.(request);
    expect(calls).toEqual([]);
    expect(result?.markdown).toContain(PORTS_NEEDS_ENTRY);
  });

  it('tunnel answers with the config error instead of an empty list', async () => {
    vi.stubEnv('BB_HOME', mkdtempSync(join(tmpdir(), 'bakers-inbox-')));
    const result = await handlersFor({
      transport: { use: 'x' },
      services: [{ key: 'docs', match: '' }],
    }).tunnel?.(request);
    expect(result?.markdown).toBe(
      'addons[@bakers-build/addon-ports].with.services[0].match must be a non-empty string',
    );
    vi.unstubAllEnvs();
  });
});
