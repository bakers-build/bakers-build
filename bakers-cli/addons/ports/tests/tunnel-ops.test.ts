import { describe, expect, it, vi } from 'vitest';
import type { PortsTransport } from '../src/transport.js';
import {
  bringUp,
  type OperationContext,
  reap,
  reconcileTunnels,
  recordMatchesRule,
  type TunnelOpsDeps,
  takeDown,
} from '../src/tunnel-ops.js';
import {
  readMachineTunnelState,
  type TunnelDesiredRecord,
} from '../src/tunnel-state.js';

const ZONE = 'preview.example';

/** A minimal in-memory `PortsTransport` — proves the generic orchestration
 *  (bringUp/takeDown/reap/reconcileTunnels) without any Cloudflare specifics;
 *  Named Cloudflare's own sequencing lives in `addons/ports-cloudflare`. */
function fakeTransport(
  opts: {
    id?: string;
    identity?: string;
    zone?: string | undefined;
    onReconcile?: (records: readonly TunnelDesiredRecord[]) => void;
    failNext?: boolean;
  } = {},
): PortsTransport & { reconcileCalls: number } {
  const transport = {
    id: opts.id ?? 'fake',
    identity: opts.identity ?? 'fake-identity',
    zone: opts.zone === undefined ? ZONE : opts.zone,
    reconcileCalls: 0,
    validateData: () => {},
    reconcile: async (
      records: readonly TunnelDesiredRecord[],
      ctx: { checkpoint(r: readonly TunnelDesiredRecord[]): Promise<void> },
    ) => {
      transport.reconcileCalls += 1;
      opts.onReconcile?.(records);
      if (opts.failNext) {
        opts.failNext = false;
        const failed = records.map((r) =>
          r.desired === 'present'
            ? { ...r, applied: 'pending' as const, error: 'boom' }
            : r,
        );
        return { records: failed, ok: false };
      }
      const next = records
        .map((r) =>
          r.desired === 'present'
            ? {
                ...r,
                applied: 'applied' as const,
                error: undefined,
                url: `https://${r.hostname}`,
              }
            : r,
        )
        .filter((r) => r.desired === 'present');
      await ctx.checkpoint(next);
      return { records: next, ok: true };
    },
  };
  return transport;
}

function fakeDeps(): TunnelOpsDeps & { files: Record<string, string> } {
  const files: Record<string, string> = {};
  return {
    files,
    readFile: async (path) => {
      if (!(path in files)) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return files[path]!;
    },
    writeFile: async (path, data) => {
      files[path] = data;
    },
    rename: async (from, to) => {
      files[to] = files[from]!;
      delete files[from];
    },
    mkdir: async () => {},
  };
}

function ctxFor(
  worktree: string,
  ticket: string,
  transport: PortsTransport,
): OperationContext {
  return { worktree, ticket, home: '/home/.bakers', transport };
}

vi.mock('../src/lock.js', async () => {
  let chain = Promise.resolve();
  return {
    withTunnelLock: async <T>(_home: string, op: () => Promise<T>) => {
      const run = chain.then(op);
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
});

describe('reconcileTunnels (generic layer)', () => {
  it('rejects an adapter that drops a desired-present input record', async () => {
    const deps = fakeDeps();
    const transport: PortsTransport = {
      id: 'bad',
      identity: 'bad-id',
      validateData: () => {},
      reconcile: async () => ({ records: [], ok: true }),
    };
    const records: TunnelDesiredRecord[] = [
      {
        worktree: '/wt/a',
        ticket: 'a-1',
        key: 'mailpit',
        service: 'http://127.0.0.1:8026',
        desired: 'present',
        applied: 'pending',
      },
    ];
    await expect(
      reconcileTunnels(records, { transport, home: '/home/.bakers' }, deps),
    ).rejects.toThrow(/dropped desired-present/);
  });

  it('rejects an adapter that invents an unknown key', async () => {
    const deps = fakeDeps();
    const transport: PortsTransport = {
      id: 'bad',
      identity: 'bad-id',
      validateData: () => {},
      reconcile: async (records) => ({
        records: [
          ...records,
          {
            worktree: '/wt/other',
            ticket: 'z-9',
            key: 'invented',
            service: 'http://x',
            desired: 'present',
            applied: 'applied',
          },
        ],
        ok: true,
      }),
    };
    const records: TunnelDesiredRecord[] = [
      {
        worktree: '/wt/a',
        ticket: 'a-1',
        key: 'mailpit',
        service: 'http://127.0.0.1:8026',
        desired: 'present',
        applied: 'pending',
      },
    ];
    await expect(
      reconcileTunnels(records, { transport, home: '/home/.bakers' }, deps),
    ).rejects.toThrow(/not present in the input/);
  });
});

describe('bringUp / takeDown / reap orchestration', () => {
  it('bringUp is idempotent: a second call reports the same hostname, reconciling again each time (BB-681 review C4: no already-applied fast path)', async () => {
    const deps = fakeDeps();
    const transport = fakeTransport();
    const ctx = ctxFor('/wt/pynq-42', 'pynq-42', transport);
    const rule = { key: 'mailpit', service: 'http://127.0.0.1:8026' };
    const first = await bringUp(rule, ctx, deps);
    expect(first.ok).toBe(true);
    expect(first.hostname).toBe('pynq-42-mailpit.preview.example');

    const second = await bringUp(rule, ctx, deps);
    expect(second.ok).toBe(true);
    expect(second.hostname).toBe(first.hostname);
    // The transport's OWN reconcile is what notices and repairs a dead
    // route on a repeated `up` — it must run every time, not just once.
    expect(transport.reconcileCalls).toBe(2);
  });

  // BB-681 review N3: the upsert that seeds a repeated `up`'s desired
  // record must carry the PREVIOUSLY applied URL through when the origin
  // (service/hostHeader/insecureTls) is unchanged — otherwise a transport
  // whose fast-path reuse check needs to re-derive the URL (e.g. Quick
  // re-reading its log file) sees `undefined` on every single `up`, with no
  // cached fallback if that re-read is ever flaky.
  it('N3: a repeated up with the same origin carries the previously applied URL into the next reconcile input', async () => {
    const deps = fakeDeps();
    let secondInputUrl: string | undefined;
    const transport = fakeTransport({
      onReconcile: (records) => {
        const rec = records.find((r) => r.key === 'mailpit');
        if (transport.reconcileCalls === 2) secondInputUrl = rec?.url;
      },
    });
    const ctx = ctxFor('/wt/pynq-42', 'pynq-42', transport);
    const rule = { key: 'mailpit', service: 'http://127.0.0.1:8026' };
    const first = await bringUp(rule, ctx, deps);
    expect(first.ok).toBe(true);

    await bringUp(rule, ctx, deps);
    expect(secondInputUrl).toBe(first.hostname && `https://${first.hostname}`);
  });

  it('N5: bringUp re-reconciles when the claimed target changed since it was applied', async () => {
    const deps = fakeDeps();
    const transport = fakeTransport();
    const ctx = ctxFor('/wt/pynq-42', 'pynq-42', transport);
    const first = await bringUp(
      { key: 'drupal-admin', service: 'https://127.0.0.1:33217' },
      ctx,
      deps,
    );
    expect(first.ok).toBe(true);
    expect(transport.reconcileCalls).toBe(1);

    const second = await bringUp(
      { key: 'drupal-admin', service: 'https://127.0.0.1:40111' },
      ctx,
      deps,
    );
    expect(second.ok).toBe(true);
    expect(transport.reconcileCalls).toBe(2);
  });

  it('recordMatchesRule sees a changed direct origin', () => {
    const service = 'https://127.0.0.1:443';
    expect(
      recordMatchesRule(
        { service, direct: 'http://172.18.0.19:80' },
        { key: 'web', service, direct: 'http://172.18.0.23:80' },
      ),
    ).toBe(false);
    expect(
      recordMatchesRule(
        { service, direct: 'http://172.18.0.19:80' },
        { key: 'web', service, direct: 'http://172.18.0.19:80' },
      ),
    ).toBe(true);
  });

  it('bringUp hands the direct origin to the transport', async () => {
    const deps = fakeDeps();
    let seen: string | undefined;
    const transport = fakeTransport({
      onReconcile: (records) => {
        seen = records.find((r) => r.key === 'web')?.direct;
      },
    });
    await bringUp(
      {
        key: 'web',
        service: 'https://127.0.0.1:443',
        direct: 'http://172.18.0.19:80',
      },
      ctxFor('/wt/pynq-42', 'pynq-42', transport),
      deps,
    );
    expect(seen).toBe('http://172.18.0.19:80');
  });

  it('takeDown removes the rule and leaves other worktrees untouched', async () => {
    const deps = fakeDeps();
    const transport = fakeTransport();
    const ctxA = ctxFor('/wt/a', 'a-1', transport);
    const ctxB = ctxFor('/wt/b', 'b-2', transport);
    await bringUp(
      { key: 'mailpit', service: 'http://127.0.0.1:8026' },
      ctxA,
      deps,
    );
    await bringUp(
      { key: 'mailpit', service: 'http://127.0.0.1:8027' },
      ctxB,
      deps,
    );

    const down = await takeDown('/wt/a', 'mailpit', ctxA, deps);
    expect(down.ok).toBe(true);

    const state = await readMachineTunnelState('/home/.bakers', deps);
    expect(state).toMatchObject({ ok: true });
    if (state.ok) {
      expect(state.state.records.map((r) => r.worktree)).toEqual(['/wt/b']);
    }
  });

  it('the first write of tunnels.json never persists transport settings', async () => {
    const deps = fakeDeps();
    const transport = fakeTransport();
    const ctx = ctxFor('/wt/a', 'a-1', transport);
    await bringUp(
      { key: 'mailpit', service: 'http://127.0.0.1:8026' },
      ctx,
      deps,
    );
    const written = deps.files['/home/.bakers/tunnels.json']!;
    expect(written).toContain('mailpit');
    expect(written).not.toContain('settings');
  });

  it('takeDown is idempotent: a second call succeeds without re-reconciling', async () => {
    const deps = fakeDeps();
    const transport = fakeTransport();
    const ctx = ctxFor('/wt/a', 'a-1', transport);
    await bringUp(
      { key: 'mailpit', service: 'http://127.0.0.1:8026' },
      ctx,
      deps,
    );
    expect((await takeDown('/wt/a', 'mailpit', ctx, deps)).ok).toBe(true);
    const calls = transport.reconcileCalls;
    const again = await takeDown('/wt/a', 'mailpit', ctx, deps);
    expect(again.ok).toBe(true);
    expect(transport.reconcileCalls).toBe(calls);
  });

  it('reap removes only records the injected liveness check reports dead', async () => {
    const deps = fakeDeps();
    const transport = fakeTransport();
    const ctxA = ctxFor('/wt/a', 'a-1', transport);
    const ctxB = ctxFor('/wt/b', 'b-2', transport);
    await bringUp(
      { key: 'mailpit', service: 'http://127.0.0.1:8026' },
      ctxA,
      deps,
    );
    await bringUp(
      { key: 'mailpit', service: 'http://127.0.0.1:8027' },
      ctxB,
      deps,
    );

    const result = await reap(
      { home: '/home/.bakers', transport },
      async (record) => ({ live: record.worktree !== '/wt/a' }),
      deps,
    );
    expect(result.removedRecords).toBe(1);

    const state = await readMachineTunnelState('/home/.bakers', deps);
    expect(state).toMatchObject({ ok: true });
    if (state.ok)
      expect(state.state.records.map((r) => r.worktree)).toEqual(['/wt/b']);
  });

  it('reap removes/refreshes nothing when every record is still live, but still reconciles (BB-681 review C4: a dead Quick process or lost frp registration has no OTHER chance to be noticed)', async () => {
    const deps = fakeDeps();
    const transport = fakeTransport();
    const ctxA = ctxFor('/wt/a', 'a-1', transport);
    await bringUp(
      { key: 'mailpit', service: 'http://127.0.0.1:8026' },
      ctxA,
      deps,
    );
    const callsBefore = transport.reconcileCalls;

    const result = await reap(
      { home: '/home/.bakers', transport },
      async () => ({ live: true }),
      deps,
    );
    expect(result.removedRecords).toBe(0);
    expect(transport.reconcileCalls).toBe(callsBefore + 1);
  });

  it('reap refreshes a record whose container IP changed', async () => {
    const deps = fakeDeps();
    const transport = fakeTransport();
    const service = 'https://127.0.0.1:443';
    await bringUp(
      { key: 'web', service, direct: 'http://172.18.0.19:80' },
      ctxFor('/wt/a', 'a-1', transport),
      deps,
    );
    const result = await reap(
      { home: '/home/.bakers', transport },
      async () => ({
        live: true,
        rule: { key: 'web', service, direct: 'http://172.18.0.23:80' },
      }),
      deps,
    );
    expect(result.refreshedRecords).toBe(1);
    const state = await readMachineTunnelState('/home/.bakers', deps);
    if (!state.ok) throw new Error('state not readable');
    expect(state.state.records[0]?.direct).toBe('http://172.18.0.23:80');
  });

  it('a failing reconcile followed by a retry eventually reports applied', async () => {
    const deps = fakeDeps();
    const transport = fakeTransport({ failNext: true });
    const ctx = ctxFor('/wt/a', 'a-1', transport);
    const first = await bringUp(
      { key: 'mailpit', service: 'http://127.0.0.1:8026' },
      ctx,
      deps,
    );
    expect(first.ok).toBe(false);

    const retried = await reap(
      { home: '/home/.bakers', transport },
      async () => ({ live: true }),
      deps,
    );
    expect(retried.ok).toBe(true);
    const state = await readMachineTunnelState('/home/.bakers', deps);
    if (state.ok) {
      expect(state.state.records[0]).toMatchObject({ applied: 'applied' });
    }
  });
});
