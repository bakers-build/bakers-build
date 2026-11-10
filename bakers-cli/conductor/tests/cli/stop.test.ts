import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BbCliDeps,
  buildConductorProgram,
  strayConductorsOf,
} from '../../src/commands/conductor.js';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';

vi.mock('dropsh', async (orig) => {
  const actual = await orig<typeof import('dropsh')>();
  return { ...actual, authStatus: vi.fn(async () => ({ loggedIn: true })) };
});

/**
 * `bakers oven stop` is a verified signal, and nothing else.
 *
 * It no longer kills a herdr tab (that killed the pane, not necessarily the
 * conductor) and no longer writes `offline` itself — a heartbeat would erase
 * that write, so the exiting process owns it. What is left is: find this
 * conductor's row, prove the process is really it, signal it.
 *
 * BB-450 D1: the proof is process identity (a live pid whose command line
 * identifies a bakers conductor, owned by this user) plus a `host_key` match —
 * never the process's working directory, which only ever coincided with
 * `workspace_root` over a herdr spawn.
 */
describe('bakers conductor stop', () => {
  let home: string;
  let out: string[];
  const originalHome = process.env.BAKERS_HOME;
  const originalLog = process.env.BAKERS_CONDUCTOR_LOG;
  const WORKSPACE = '/home/dev/project';
  const HOST = '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30';
  const CONDUCTOR_CMDLINE =
    'node /usr/local/bin/bakers oven start --foreground --no-update-check';

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'bakers-stop-'));
    // BAKERS_HOME names the `.bakers` root itself, not a home containing one.
    process.env.BAKERS_HOME = join(home, '.bakers');
    process.env.BAKERS_CONDUCTOR_LOG = 'silent';
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      out.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.BAKERS_HOME;
    else process.env.BAKERS_HOME = originalHome;
    if (originalLog === undefined) delete process.env.BAKERS_CONDUCTOR_LOG;
    else process.env.BAKERS_CONDUCTOR_LOG = originalLog;
  });

  it('sends a verified SIGTERM to the conductor of this checkout', async () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
    });

    await run(['stop'], probe, [row({ lastPid: 4242 })]);

    expect(probe.sent).toEqual([[4242, 'SIGTERM']]);
  });

  it('does not write offline itself — the exiting process owns that', async () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
    });
    const remote = new StopRemote([row({ lastPid: 4242 })]);

    await run(['stop'], probe, undefined, remote);

    expect(remote.statusWrites).toEqual([]);
  });

  it('refuses to signal a live pid whose command line is not a bakers conductor, and says so', async () => {
    const probe = fakeProbe({
      4242: {
        cmdline: '/usr/bin/unrelated-daemon',
        uid: process.getuid?.() ?? 0,
      },
    });

    await run(['stop'], probe, [row({ lastPid: 4242 })]);

    expect(probe.sent).toEqual([]);
    expect(out.join('\n')).toContain('recycled');
  });

  it("refuses to signal a conductor whose host_key is not this machine's", async () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
    });

    await run(['stop'], probe, [
      row({ lastPid: 4242, hostKey: 'someone-elses-box' }),
    ]);

    expect(probe.sent).toEqual([]);
    expect(out.join('\n')).toContain('host_key');
  });

  it('reports plainly when the conductor never recorded a pid', async () => {
    const probe = fakeProbe({});

    await run(['stop'], probe, [row({})]);

    expect(probe.sent).toEqual([]);
    expect(out.join('\n').toLowerCase()).toContain('no pid');
    expect(out.join('\n')).toContain('started in a way that records one');
  });

  it('reports when the control plane has no such conductor', async () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
    });

    await run(['stop'], probe, []);

    expect(probe.sent).toEqual([]);
    expect(out.join('\n')).toContain('mid-stop');
  });

  it('reports a stray record naming the same checkout, and never signals it', async () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
      9999: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
    });

    await run(['stop'], probe, [
      row({ lastPid: 4242 }),
      row({ id: 'mid-stray', lastPid: 9999 }),
    ]);

    expect(probe.sent).toEqual([[4242, 'SIGTERM']]);
    expect(out.join('\n')).toContain('mid-stray');
    expect(out.join('\n')).toContain('left untouched');
  });

  it('--now sends SIGKILL through the same verification gate', async () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
    });

    await run(['stop', '--now'], probe, [row({ lastPid: 4242 })]);

    expect(probe.sent).toEqual([[4242, 'SIGKILL']]);
  });

  it('--now refuses an unverified pid exactly like a graceful stop', async () => {
    const probe = fakeProbe({
      4242: {
        cmdline: '/usr/bin/unrelated-daemon',
        uid: process.getuid?.() ?? 0,
      },
    });

    await run(['stop', '--now'], probe, [row({ lastPid: 4242 })]);

    expect(probe.sent).toEqual([]);
  });

  it('--now says offline follows on lease expiry, since a kill writes none', async () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
    });

    await run(['stop', '--now'], probe, [row({ lastPid: 4242 })]);

    expect(out.join('\n').toLowerCase()).toContain('lease');
  });

  // BB-450 review B14 — this test injects `deps.config` (via `run()`'s
  // `makeConfig()`), so `resolveConfig()` returns before `resolveConfigPath()`
  // / `loadConductorConfig()` / `loadBbConfig()` ever run
  // (`commands/conductor.ts:126-128`): config discovery is bypassed entirely,
  // not exercised. What this DOES pin: the verification `cmdStop` performs
  // once it has a config — a live pid, a conductor command line, this
  // caller's uid, a matching `host_key` — reads no cwd at all, proven by
  // moving the process across three real directories while nothing else
  // changes. `ProcProbe`/`SignalVerifiedInput` carry no cwd member
  // (`core/src/core/proc.ts:7-20`), so there is no field left for a cwd
  // comparison to read even if one were reintroduced here — a guard against a
  // FUTURE regression, not the AC-3 pin itself. The genuine regression test —
  // real config discovery, no injected `deps.config` — follows below.
  it('the verified-signal check itself reads no cwd, regardless of the calling directory', async () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
    });
    const repoRoot = join(home, 'checkout');
    const bakersConfigDir = join(repoRoot, '.bakers');
    const linkedWorktree = join(home, '.bakers-worktrees', 'other-ticket');
    mkdirSync(bakersConfigDir, { recursive: true });
    mkdirSync(linkedWorktree, { recursive: true });
    const originalCwd = process.cwd();

    try {
      for (const dir of [repoRoot, bakersConfigDir, linkedWorktree]) {
        process.chdir(dir);
        await run(['stop'], probe, [row({ lastPid: 4242 })]);
      }
    } finally {
      process.chdir(originalCwd);
    }

    expect(probe.sent).toEqual([
      [4242, 'SIGTERM'],
      [4242, 'SIGTERM'],
      [4242, 'SIGTERM'],
    ]);
  });

  // BB-450 review B14 — the actual AC-3 regression: three REAL directories,
  // each holding its own `.bakers/project.config.js` + `.bakers/connection.config.js`
  // (as a git worktree checkout would — the files are tracked, so every
  // worktree of one commit carries identical content), resolved through the
  // genuine walk-up (`resolveConfigPath`/`loadConductorConfig`/
  // `loadBbConfig`) with NO `deps.config` injected. `HOME` is sandboxed to
  // this test's own temp dir so `readMachineContext()`
  // (`~/.bakers/machine.config.js`) and the connection config's home fallback
  // never touch the real machine running the suite.
  it('resolves the SAME conductor through real config discovery from the repository root, .bakers/, and a linked worktree', async () => {
    const probe = fakeProbe({
      4242: { cmdline: CONDUCTOR_CMDLINE, uid: process.getuid?.() ?? 0 },
    });
    const originalHomeEnv = process.env.HOME;
    process.env.HOME = home;

    const engineConfig = `
const slot = (kind) => ({ kind, id: kind, requiredModules: [] });
export default {
  server: slot('server'),
  executor: slot('executor'),
  worktree: slot('worktree'),
  project: { name: 'bakers' },
  states: ['working'],
};
`;
    const connectionConfig = `
export default {
  site: { base_url: 'http://web', jsonapi_prefix: '/jsonapi' },
  workspace_id: 'test-workspace',
  plugins: [],
};
`;
    const machineConfig = `
export default {
  machine_id: '${HOST}',
  label: 'cw-laptop',
  addons: [{ use: '@bakers-build/addon-claude' }],
};
`;

    try {
      mkdirSync(join(home, '.bakers'), { recursive: true });
      writeFileSync(join(home, '.bakers', 'machine.config.js'), machineConfig);

      const repoRoot = join(home, 'real-checkout');
      const repoBbDir = join(repoRoot, '.bakers');
      const linkedWorktree = join(
        home,
        '.bakers-worktrees',
        'real-other-ticket',
      );
      const worktreeBbDir = join(linkedWorktree, '.bakers');
      for (const dir of [repoBbDir, worktreeBbDir]) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'project.config.js'), engineConfig);
        writeFileSync(join(dir, 'connection.config.js'), connectionConfig);
      }

      // The id is derived: machine UUID + project + variant.
      const remote = new StopRemote([
        row({ id: `${HOST}-bakers-conductor`, lastPid: 4242 }),
      ]);
      const originalCwd = process.cwd();
      try {
        for (const dir of [repoRoot, repoBbDir, linkedWorktree]) {
          process.chdir(dir);
          const deps: BbCliDeps = { remote, procProbe: probe };
          await buildConductorProgram(deps).parseAsync(['conductor', 'stop'], {
            from: 'user',
          });
        }
      } finally {
        process.chdir(originalCwd);
      }
    } finally {
      if (originalHomeEnv === undefined) delete process.env.HOME;
      else process.env.HOME = originalHomeEnv;
    }

    expect(probe.sent).toEqual([
      [4242, 'SIGTERM'],
      [4242, 'SIGTERM'],
      [4242, 'SIGTERM'],
    ]);
  });

  function row(over: Partial<ConductorStatus> = {}): ConductorStatus {
    return {
      id: 'mid-stop',
      project: 'bakers',
      label: 'stop test',
      status: 'online',
      lastSeen: 0,
      load: 0,
      workspaceRoot: WORKSPACE,
      leaseExpiresAt: 0,
      maxParallel: 1,
      hostKey: HOST,
      ...over,
    };
  }

  async function run(
    argv: string[],
    probe: FakeProbe,
    rows?: ConductorStatus[],
    remote?: StopRemote,
  ): Promise<void> {
    const deps: BbCliDeps = {
      remote: remote ?? new StopRemote(rows ?? []),
      config: makeConfig(),
      procProbe: probe,
    };
    await buildConductorProgram(deps).parseAsync(['conductor', ...argv], {
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
      label: 'stop test',
      project: 'bakers',
      states: ['working'],
      prompt: DEFAULT_AGENT_PROMPT,
      max_parallel: 1,
      poll_interval_ms: 5000,
      lease_seconds: 300,
      conductor_id: 'mid-stop',
      host_key: HOST,
      config_path: join(home, 'project.config.js'),
    } as ConductorFileConfig;
  }
});

describe('strayConductorsOf', () => {
  const own: ConductorStatus = {
    id: 'a',
    project: 'bakers',
    label: '',
    status: 'online',
    lastSeen: 0,
    load: 0,
    workspaceRoot: '/repo',
    leaseExpiresAt: 0,
    maxParallel: 1,
  };

  it('finds another record naming the same checkout, excluding itself', () => {
    const stray = { ...own, id: 'b' };
    expect(strayConductorsOf([own, stray], own)).toEqual([stray]);
  });

  it('ignores a record with no workspace_root at all', () => {
    const never = { ...own, id: 'b', workspaceRoot: '' };
    expect(strayConductorsOf([own, never], own)).toEqual([]);
  });

  it('yields nothing when this record has no workspace_root to compare', () => {
    const bare = { ...own, workspaceRoot: '' };
    expect(strayConductorsOf([bare], bare)).toEqual([]);
  });
});

class StopRemote extends FakeBbRemote {
  statusWrites: Array<[string, string]> = [];

  constructor(private readonly rows: ConductorStatus[]) {
    super();
  }

  override async listConductors(): Promise<ConductorStatus[]> {
    return this.rows;
  }

  override async setConductorStatus(id: string, status: string): Promise<void> {
    this.statusWrites.push([id, status]);
  }
}

interface FakeProbe extends ProcProbe {
  sent: Array<[number, string]>;
}

function fakeProbe(
  procs: Record<number, { cmdline: string; uid: number }>,
): FakeProbe {
  const sent: Array<[number, string]> = [];
  return {
    supported: true,
    sent,
    cmdlineOf: (pid: number) => procs[pid]?.cmdline,
    uidOf: (pid: number) => procs[pid]?.uid,
    send: (pid: number, signal: NodeJS.Signals) => {
      sent.push([pid, signal]);
    },
  };
}
