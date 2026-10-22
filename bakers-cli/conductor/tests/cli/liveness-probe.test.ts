import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeAgent } from '@bakers-build/addon-claude';
import {
  FakeBbRemote,
  fakeExecutor,
  fakeRemote,
  fakeWorkspace,
} from '@bakers-build/addon-fake';
import type {
  ConductorFileConfig,
  ConductorStatus,
} from '@bakers-build/conductor/contract';
import type { ProcProbe } from '@bakers-build/core';
import { deriveConductorLiveness } from '@bakers-build/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BbCliDeps,
  buildConductorProgram,
} from '../../src/commands/conductor.js';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';

vi.mock('dropsh', async (orig) => {
  const actual = await orig<typeof import('dropsh')>();
  return { ...actual, authStatus: vi.fn(async () => ({ loggedIn: true })) };
});

/**
 * `bakers oven ls`/`status` probing THIS machine's own pid (BB-473,
 * defect 2): `deriveConductorLiveness` (core) is record-only and MUST NOT
 * change (it also classifies conductors on other hosts this machine cannot
 * probe) — `classify()` additionally consults an injected `ProcProbe` when
 * the row is this machine's own conductor (`hostKey` matches) with a
 * positive `lastPid` on record.
 */
describe('bakers oven ls/status: local pid probe (BB-473)', () => {
  let home: string;
  let out: string[];
  const originalHome = process.env.BB_HOME;
  const originalLog = process.env.BB_CONDUCTOR_LOG;
  const HOST = 'cw-dev-box';
  const CONDUCTOR_CMDLINE =
    'node /usr/local/bin/bakers oven start --foreground --no-update-check';

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'bakers-liveness-probe-'));
    process.env.BB_HOME = join(home, '.bakers');
    process.env.BB_CONDUCTOR_LOG = 'silent';
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      out.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.BB_HOME;
    else process.env.BB_HOME = originalHome;
    if (originalLog === undefined) delete process.env.BB_CONDUCTOR_LOG;
    else process.env.BB_CONDUCTOR_LOG = originalLog;
  });

  function row(over: Partial<ConductorStatus> = {}): ConductorStatus {
    const nowS = Math.floor(Date.now() / 1000);
    return {
      id: 'mid-liveness',
      project: 'bakers',
      label: 'liveness test',
      status: 'online',
      lastSeen: nowS,
      load: 0,
      workspaceRoot: join(home, '.bakers'),
      leaseExpiresAt: nowS + 300,
      maxParallel: 1,
      hostKey: HOST,
      ...over,
    };
  }

  async function runLs(
    rows: ConductorStatus[],
    probe?: ProcProbe,
  ): Promise<void> {
    const deps: BbCliDeps = {
      remote: new ListRemote(rows),
      config: makeConfig(),
      procProbe: probe,
    };
    await buildConductorProgram(deps).parseAsync(['oven', 'ls'], {
      from: 'user',
    });
  }

  async function runStatus(
    rows: ConductorStatus[],
    probe?: ProcProbe,
  ): Promise<void> {
    const deps: BbCliDeps = {
      remote: new ListRemote(rows),
      config: makeConfig(),
      procProbe: probe,
    };
    await buildConductorProgram(deps).parseAsync(['oven', 'status'], {
      from: 'user',
    });
  }

  function makeConfig(): ConductorFileConfig {
    return {
      site: { base_url: 'http://web', jsonapi_prefix: '/jsonapi' },
      remote: fakeRemote(),
      executor: fakeExecutor(),
      agent: [{ agent: claudeAgent() }],
      workspace: fakeWorkspace(),
      label: 'liveness test',
      project: 'bakers',
      states: ['coding'],
      prompt: DEFAULT_AGENT_PROMPT,
      max_parallel: 1,
      poll_interval_ms: 5000,
      lease_seconds: 300,
      conductor_id: 'mid-liveness',
      host_key: HOST,
      config_path: join(home, '.bakers', 'conductor.config.js'),
    } as ConductorFileConfig;
  }

  // R7: probe reports a live pid with matching cmdline+uid → classification
  // stays online.
  it('R7: a live, verified pid leaves an online record online', async () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
    });
    await runLs([row({ lastPid: 4242 })], probe);

    const text = out.join('\n');
    expect(text).toContain('online');
    expect(text).not.toContain('offline');
  });

  // R6 / R8: probe reports the recorded pid is dead or belongs to a recycled
  // (mismatching-cmdline) process → treated as dead, overriding the
  // record's `online` to `offline`.
  it('R6: a dead pid overrides an online record to offline', async () => {
    const probe = fakeProbe({}); // no process at all — dead pid.
    await runLs([row({ lastPid: 9999 })], probe);

    const text = out.join('\n');
    expect(text).toContain('offline');
    expect(text).not.toContain('online');
  });

  it('R8: a recycled pid (mismatching cmdline) is treated as dead, not proof of life', async () => {
    const probe = fakeProbe({
      4242: {
        cmdline: '/usr/bin/some-other-program',
        uid: process.getuid?.() ?? 0,
      },
    });
    await runLs([row({ lastPid: 4242 })], probe);

    const text = out.join('\n');
    expect(text).toContain('offline');
    expect(text).not.toContain('online');
  });

  // R9: hostKey mismatch → probe never invoked; row equals what
  // deriveConductorLiveness alone returns.
  it('R9: a foreign-host conductor is never probed; classification matches deriveConductorLiveness alone', async () => {
    const probe = fakeProbe({}); // would report the pid dead, if ever asked.
    const foreignRow = row({ hostKey: 'other-host', lastPid: 9999 });
    await runStatus([foreignRow], probe);

    const expected = deriveConductorLiveness(
      foreignRow,
      Math.floor(Date.now() / 1000),
    );
    const text = out.join('\n');
    expect(text).toContain(expected);
    // The probe was never consulted, so a dead pid does NOT flip this to
    // offline the way R6 does for a same-host row.
    expect(expected).toBe('online');
  });

  // R10: lastPid absent/0/non-integer, or probe reports unsupported →
  // record-derived answer stands unchanged.
  it('R10: no lastPid on record → record-derived answer stands (no probe call possible)', async () => {
    const probe = fakeProbe({});
    const noPidRow = row({ lastPid: undefined });
    await runLs([noPidRow], probe);

    const text = out.join('\n');
    expect(text).toContain('online');
  });

  it('R10: an unsupported-platform probe leaves the record-derived answer unchanged', async () => {
    const probe = fakeProbe({}, { supported: false });
    await runLs([row({ lastPid: 4242 })], probe);

    const text = out.join('\n');
    expect(text).toContain('online');
    expect(text).not.toContain('offline');
  });

  // R11: ls and status, same fixture, produce identical classification.
  it('R11: ls and status classify the same fixture conductor identically', async () => {
    const probe1 = fakeProbe({});
    const probe2 = fakeProbe({});
    const badRow = row({ lastPid: 9999 });

    out = [];
    await runLs([badRow], probe1);
    const lsText = out.join('\n');

    out = [];
    await runStatus([badRow], probe2);
    const statusText = out.join('\n');

    expect(lsText).toContain('offline');
    expect(statusText).toContain('offline');
  });

  // R12: printed value for every branch is one of online|stale|offline.
  it('R12: every printed status is a known ConductorLiveness word', async () => {
    const KNOWN = ['online', 'stale', 'offline'];
    const cases: Array<[ConductorStatus, ProcProbe | undefined]> = [
      [
        row({ lastPid: 4242 }),
        fakeProbe({
          4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
        }),
      ],
      [row({ lastPid: 9999 }), fakeProbe({})],
      [row({ hostKey: 'other-host', lastPid: 9999 }), fakeProbe({})],
      [row({ lastPid: undefined }), fakeProbe({})],
      [row({ lastPid: 4242 }), fakeProbe({}, { supported: false })],
    ];
    for (const [r, probe] of cases) {
      out = [];
      await runLs([r], probe);
      const text = out.join('\n');
      const word = KNOWN.find((w) => text.includes(w));
      expect(word).toBeDefined();
    }
  });
});

class ListRemote extends FakeBbRemote {
  constructor(private readonly rows: ConductorStatus[]) {
    super();
  }

  override async listConductors(): Promise<ConductorStatus[]> {
    return this.rows;
  }
}

interface FakeProbe extends ProcProbe {
  sent: Array<[number, string]>;
}

function fakeProbe(
  procs: Record<number, { cmdline: string; uid: number }>,
  opts: { supported?: boolean } = {},
): FakeProbe {
  const sent: Array<[number, string]> = [];
  return {
    supported: opts.supported ?? true,
    sent,
    cmdlineOf: (pid: number) => procs[pid]?.cmdline,
    uidOf: (pid: number) => procs[pid]?.uid,
    send: (pid: number, signal: NodeJS.Signals) => {
      sent.push([pid, signal]);
    },
  };
}
