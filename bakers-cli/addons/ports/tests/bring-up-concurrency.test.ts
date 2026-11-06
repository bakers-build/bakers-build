import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeLockDeps } from '../src/lock.js';
import { portsTools } from '../src/tools.js';
import type { PortsTransport } from '../src/transport.js';
import {
  bringUp,
  type OperationContext,
  readTunnelState as readMachineTunnelRecords,
  reap,
  type TunnelOpsDeps,
  takeDown,
} from '../src/tunnel-ops.js';
import {
  nodeTunnelStateDeps,
  type TunnelDesiredRecord,
} from '../src/tunnel-state.js';

// AC5 — "two worktrees running `up` concurrently both end up applied, no lost
// route" — `tunnel-ops.test.ts`'s orchestration tests MOCK `withTunnelLock`
// entirely, so they exercise `bringUp`'s logic but never prove the real
// cross-process lock actually serializes two real `bringUp` calls. This file
// is that proof: a real `flock` subprocess (per `lock.test.ts`'s own
// pattern) and a real tunnel-state file on disk, against an in-memory FAKE
// transport (no real network — Named Cloudflare's own concurrency behavior
// under this same lock is `addons/ports-cloudflare`'s concern).

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'bakers-tunnel-bringup-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function fakeTransport(
  ingress: { hostname?: string; service: string }[],
): PortsTransport {
  return {
    id: 'fake',
    identity: 'fake-id',
    zone: 'preview.example',
    validateData: () => {},
    reconcile: async (records: readonly TunnelDesiredRecord[]) => {
      // Simulate Cloudflare's own "replace the whole ingress list" behavior
      // so the test can assert both concurrent routes land in ONE list.
      const active = records.filter((r) => r.desired === 'present');
      ingress.length = 0;
      ingress.push(
        ...active.map((r) => ({ hostname: r.hostname, service: r.service })),
      );
      return {
        records: active.map((r) => ({
          ...r,
          applied: 'applied' as const,
          url: `https://${r.hostname}`,
        })),
        ok: true,
      };
    },
  };
}

function deps(): TunnelOpsDeps {
  return { ...nodeTunnelStateDeps, ...nodeLockDeps };
}

function ctxFor(
  worktree: string,
  ticket: string,
  transport: PortsTransport,
): OperationContext {
  return { worktree, ticket, home, transport };
}

describe('bringUp under real cross-process locking (AC5)', () => {
  it('two concurrent bringUp calls for different keys both end up applied, no lost route', async () => {
    const ingress: { hostname?: string; service: string }[] = [];
    const transport = fakeTransport(ingress);
    const d = deps();
    const [a, b] = await Promise.all([
      bringUp(
        { key: 'mailpit', service: 'http://127.0.0.1:8026' },
        ctxFor('/wt/pynq-42', 'pynq-42', transport),
        d,
      ),
      bringUp(
        { key: 'drupal-admin', service: 'https://127.0.0.1:33217' },
        ctxFor('/wt/pynq-42', 'pynq-42', transport),
        d,
      ),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const hostnames = ingress.map((r) => r.hostname);
    expect(hostnames).toContain('pynq-42-mailpit.preview.example');
    expect(hostnames).toContain('pynq-42-drupal-admin.preview.example');
  }, 15000);

  it('two concurrent bringUp calls from different worktrees both land in the one machine-wide set', async () => {
    const ingress: { hostname?: string; service: string }[] = [];
    const transport = fakeTransport(ingress);
    const d = deps();
    const [a, b] = await Promise.all([
      bringUp(
        { key: 'mailpit', service: 'http://127.0.0.1:8026' },
        ctxFor('/wt/a', 'a-1', transport),
        d,
      ),
      bringUp(
        { key: 'mailpit', service: 'http://127.0.0.1:9000' },
        ctxFor('/wt/b', 'b-2', transport),
        d,
      ),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const hostnames = ingress.map((r) => r.hostname);
    expect(hostnames).toContain('a-1-mailpit.preview.example');
    expect(hostnames).toContain('b-2-mailpit.preview.example');
  }, 15000);
});

describe('ports_up tool calls under real cross-process locking (AC5)', () => {
  it('parallel ports_up from two worktrees both end up applied', async () => {
    const ingress: { hostname?: string; service: string }[] = [];
    const transport = fakeTransport(ingress);
    const d = deps();
    const worktrees = [join(home, 'wt-a'), join(home, 'wt-b')];
    await Promise.all(worktrees.map((wt) => mkdir(wt)));
    const tools = portsTools({
      loadTransport: async () => ({ ok: true, transport }),
      discover: async () => ({
        services: [
          {
            key: 'web',
            claim: 'container',
            status: 'healthy',
            local: 'http://127.0.0.1:80',
            rawPorts: [],
            rules: [{ key: 'web', service: 'http://127.0.0.1:80' }],
          },
        ],
        unclaimed: [],
        diagnostics: [],
      }),
      readRecords: (wt) => readMachineTunnelRecords(wt, home, d),
      bringUp: (rule, ctx) => bringUp(rule, ctx, d),
      takeDown: (wt, key, ctx) => takeDown(wt, key, ctx, d),
      reap: (ctx, isLive) => reap(ctx, isLive, d),
      branch: () => null,
      home: () => home,
    });
    const call = (wt: string, ticket: string) =>
      tools.ports_up!({
        worktreePath: wt,
        ticket: { identifier: ticket },
        args: { service: 'web' },
        signal: new AbortController().signal,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        callTool: async () => ({ text: '' }),
      });
    const results = await Promise.all([
      call(worktrees[0]!, 'a-1'),
      call(worktrees[1]!, 'b-2'),
    ]);
    expect(results.map((r) => r.text)).toEqual([
      expect.stringContaining('a-1-web.preview.example'),
      expect.stringContaining('b-2-web.preview.example'),
    ]);
    expect(ingress.map((r) => r.hostname).sort()).toEqual([
      'a-1-web.preview.example',
      'b-2-web.preview.example',
    ]);
  }, 15000);
});
