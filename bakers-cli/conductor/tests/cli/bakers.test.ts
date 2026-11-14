import { execSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeAgent } from '@bakers-build/addon-claude';
import {
  FakeBbRemote,
  FakeExecutor,
  type FakeRemoteSeed,
  FakeWorkspace,
  fakeExecutor,
  fakeRemote,
  fakeWorkspace,
} from '@bakers-build/addon-fake';
import {
  type ConductorFileConfig,
  type ConductorRegistration,
  type ConductorStatus,
  ConductorTakeoverRequired,
} from '@bakers-build/conductor/contract';
import type { ProcProbe } from '@bakers-build/core';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  type BbCliDeps,
  runConductorCli,
} from '../../src/commands/conductor.js';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';
import type { DetachedSpawnRequest } from '../../src/process/detached-spawn.js';

vi.mock('dropsh', async (orig) => {
  const actual = await orig<typeof import('dropsh')>();
  return { ...actual, authStatus: vi.fn(async () => ({ loggedIn: true })) };
});

let home: string;
const originalHome = process.env.BAKERS_HOME;
const originalLog = process.env.BAKERS_CONDUCTOR_LOG;

// BB-450 D2: checkoutRootOf() now asks real git (`--git-common-dir`) rather
// than taking a bare dirname, so the checkout root must be a REAL, ISOLATED
// git repo — a bare directory (or one nested inside this monorepo's own
// checkout) would resolve to whatever repo actually surrounds the test
// process, not to this fixture.
const CHECKOUT = mkdtempSync(join(tmpdir(), 'bakers-cli-test-checkout-'));
execSync('git init --quiet', { cwd: CHECKOUT });
const LOG_PATH = join(CHECKOUT, '.bakers', 'log.txt');

afterAll(() => {
  rmSync(CHECKOUT, { recursive: true, force: true });
});

function makeConfig(
  overrides: Partial<ConductorFileConfig> = {},
): ConductorFileConfig {
  return {
    site: { base_url: 'http://web', jsonapi_prefix: '/jsonapi' },
    remote: fakeRemote(),
    executor: fakeExecutor(),
    // `system`: nothing launches here, so the machine's sandbox must not gate claims.
    agents: [
      { agent: claudeAgent({ permissions: 'system' }), alias: 'claude' },
    ],
    enabled_agents: ['claude'],
    disabled_agents: [],
    default_agent: 'claude',
    routes: { default: { '*': 'claude' } },
    workspace: fakeWorkspace(),
    label: 'test label',
    project: 'bakers',
    conductor_id: 'test-machine',
    host_key: 'test-machine',
    states: ['todo', 'working'],
    prompt: DEFAULT_AGENT_PROMPT,
    max_parallel: 2,
    poll_interval_ms: 5000,
    lease_seconds: 300,
    config_path: join(CHECKOUT, 'project.config.js'),
    ...overrides,
  };
}

// Default hermetic fetch: a 503 so fetchLatestVersion resolves to null — no
// network, no update notice. Tests that exercise the notice inject their own.
const hermeticFetch = (async () =>
  new Response('offline', { status: 503 })) as unknown as typeof fetch;

/**
 * The detached-spawn seam, recorded instead of executed: a test that reached
 * the real spawn would start a real `bakers oven start --foreground` against
 * the real `.bakers` config. Every deps bundle injects this, so the suite is
 * hermetic by default. The child never exits unless a test says so.
 */
type FakeSpawn = NonNullable<BbCliDeps['spawnConductor']> & {
  spawned: DetachedSpawnRequest[];
};

function fakeSpawn(
  opts: { pid?: number; exited?: Promise<number | null> } = {},
): FakeSpawn {
  const spawned: DetachedSpawnRequest[] = [];
  const fake = async (req: DetachedSpawnRequest) => {
    spawned.push(req);
    return {
      pid: opts.pid ?? 9999,
      exited: opts.exited ?? new Promise<number | null>(() => {}),
    };
  };
  return Object.assign(fake, { spawned });
}

function makeDeps(
  seed: FakeRemoteSeed = {},
  extra: Partial<BbCliDeps> = {},
): BbCliDeps {
  return {
    remote: new FakeBbRemote(seed),
    executor: new FakeExecutor({ outcome: 'exited' }),
    workspace: new FakeWorkspace(),
    config: makeConfig(),
    fetch: hermeticFetch,
    spawnConductor: fakeSpawn(),
    // BB-450 D9: `start` polls for a fresh heartbeat after spawning. A test
    // that does not care about that outcome still must not wait on a real
    // timer — one fast attempt against the default fake remote (which reports
    // no conductors at all) settles as `failed` at once.
    sleep: async () => {},
    startPollIntervalMs: 0,
    startPollAttempts: 1,
    ...extra,
  };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bakers-cli-'));
  process.env.BAKERS_HOME = join(home, '.bakers');
  // `start`'s failed outcome sets a process-global exit code; never let one
  // test's outcome leak into the next.
  process.exitCode = undefined;
  // Conductor-run handlers build a real file logger when stdout is not a TTY
  // (which it isn't under vitest); force the stdout sink so tests don't write
  // a stray log.txt into the checkout.
  process.env.BAKERS_CONDUCTOR_LOG = 'stdout';
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (originalHome === undefined) {
    delete process.env.BAKERS_HOME;
  } else {
    process.env.BAKERS_HOME = originalHome;
  }
  if (originalLog === undefined) {
    delete process.env.BAKERS_CONDUCTOR_LOG;
  } else {
    process.env.BAKERS_CONDUCTOR_LOG = originalLog;
  }
});

describe('bakers conductor once', () => {
  it('runs one cycle: claims + dispatches the seeded run', async () => {
    const deps = makeDeps({
      runs: [
        {
          runUuid: 'run-1',
          ticketUuid: 'tkt-1',
          stateAtStart: 'working',
          handler: 'code',
        },
      ],
      tickets: {
        'tkt-1': { identifier: 'BB-1', title: 'T', state: 'working' },
      },
    });
    await runConductorCli(['conductor', 'once'], deps);
    const remote = deps.remote as FakeBbRemote;
    // dispatch records markRunning for the claimed run
    expect(remote.calls.markRunning.some((c) => c.runUuid === 'run-1')).toBe(
      true,
    );
    expect(await remote.activeRunCount('any')).toBe(1);
  });
});

describe('bakers conductor start (detached path)', () => {
  // BB-450 AC-12/AC-13: `start` reports exactly one of three outcomes on
  // stdout — started / already running / failed — rather than the bare
  // `conductor already running for <project>` this superseded, and `failed`
  // sets a non-zero exit status.

  it('reports FAILED, with a non-zero exit, when no fresh heartbeat ever arrives', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let lines: string[] = [];
    try {
      await runConductorCli(['conductor', 'start'], makeDeps());
    } finally {
      // `mockRestore()` also resets `.mock.calls` — read them first.
      lines = logSpy.mock.calls.map((c) => String(c[0]));
      logSpy.mockRestore();
    }
    expect(lines.some((l) => l.includes('failed to start'))).toBe(true);
    expect(
      lines.some(
        (l) =>
          l.includes('spawned, but no fresh heartbeat arrived') &&
          l.includes(LOG_PATH),
      ),
    ).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('reports STARTED, with pid and host, once a fresh heartbeat arrives', async () => {
    const remote = new HeartbeatAfterSpawnRemote({ id: 'test-machine' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let lines: string[] = [];
    try {
      await runConductorCli(
        ['conductor', 'start'],
        makeDeps({}, { remote, startPollAttempts: 3 }),
      );
    } finally {
      lines = logSpy.mock.calls.map((c) => String(c[0]));
      logSpy.mockRestore();
    }
    expect(
      lines.some(
        (l) =>
          l.includes('started conductor test-machine') &&
          l.includes('pid 4242') &&
          l.includes('host test-host'),
      ),
    ).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('reports ALREADY RUNNING with the live pid and heartbeat age, and never spawns', async () => {
    const remote = new HeartbeatAfterSpawnRemote({
      id: 'test-machine',
      alreadyRunning: true,
    });
    const spawnConductor = fakeSpawn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let lines: string[] = [];
    try {
      await runConductorCli(
        ['conductor', 'start'],
        makeDeps({}, { remote, spawnConductor }),
      );
    } finally {
      lines = logSpy.mock.calls.map((c) => String(c[0]));
      logSpy.mockRestore();
    }
    expect(
      lines.some(
        (l) =>
          l.includes('already running') &&
          l.includes('pid 4242') &&
          l.includes('heartbeat'),
      ),
    ).toBe(true);
    expect(spawnConductor.spawned).toHaveLength(0);
    expect(process.exitCode).toBeUndefined();
  });
});

describe('bakers conductor start --force (BB-450 D10)', () => {
  // Must match makeConfig's host_key.
  const HOST = 'test-machine';
  const CONDUCTOR_CMDLINE =
    'node /usr/local/bin/bakers oven start --foreground --no-update-check';

  function runningRow(over: Partial<ConductorStatus> = {}): ConductorStatus {
    const now = Math.floor(Date.now() / 1000);
    return {
      id: 'test-machine',
      project: 'bakers',
      label: 'test',
      status: 'online',
      lastSeen: now,
      load: 0,
      workspaceRoot: '/home/dev/project',
      leaseExpiresAt: now + 300,
      maxParallel: 1,
      lastPid: 4242,
      hostKey: HOST,
      ...over,
    };
  }

  /** Returns each scripted response in order, repeating the last past the end. */
  class ScriptedRemote extends FakeBbRemote {
    private idx = 0;
    constructor(private readonly script: ConductorStatus[][]) {
      super();
    }
    override async listConductors(): Promise<ConductorStatus[]> {
      const row = this.script[Math.min(this.idx, this.script.length - 1)];
      this.idx += 1;
      return row ?? [];
    }
  }

  /**
   * A probe that answers `cmdlineOf` from actual process state rather than a
   * fixed script (BB-450 review B4) — the fixture the escalation test needs
   * to prove `waitForNotRunning` reads the LOCAL process and never the control
   * plane: a `SIGKILL`ed process writes no `offline`, so a remote-scripted
   * "gone" answered a question this function no longer asks.
   */
  function fakeProcProbe(
    pid: number,
    opts: { diesOn?: NodeJS.Signals } = {},
  ): ProcProbe & { sentSignals: NodeJS.Signals[] } {
    let alive = true;
    const sentSignals: NodeJS.Signals[] = [];
    return {
      supported: true,
      sentSignals,
      cmdlineOf: (p: number) =>
        p === pid && alive ? CONDUCTOR_CMDLINE : undefined,
      uidOf: (p: number) => (p === pid ? (process.getuid?.() ?? 0) : undefined),
      send: (p: number, signal: NodeJS.Signals) => {
        if (p !== pid) return;
        sentSignals.push(signal);
        if (opts.diesOn === undefined || signal === opts.diesOn) alive = false;
      },
    };
  }

  it('restarts: verified SIGTERM, then a fresh spawn once the old pid is gone', async () => {
    const remote = new ScriptedRemote([
      [runningRow()], // existing check: running, pid 4242
      // waitForFreshHeartbeat attempt 0 (BB-450 review B8): a SIGKILLed
      // conductor writes no `offline`, so the record the control plane
      // returns immediately after the kill is UNCHANGED — still `online`,
      // still pid 4242. A fixture that skipped straight to the new pid could
      // not distinguish a correct implementation from one that accepts this
      // stale-but-online row as its own.
      [runningRow()],
      // attempt 1: the new spawn registered AND heartbeated. BB-450 review
      // B15: a new pid alone is not enough — `last_seen` must have advanced
      // past the row this call started with, or a registration (which writes
      // no `last_seen` at all) would pass for a heartbeat.
      [
        runningRow({
          lastPid: 9999,
          lastSeen: Math.floor(Date.now() / 1000) + 5,
        }),
      ],
    ]);
    const spawnConductor = fakeSpawn();
    // Dies on the first signal it receives (SIGTERM) — the ordinary graceful case.
    const probe = fakeProcProbe(4242, { diesOn: 'SIGTERM' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let lines: string[] = [];
    try {
      await runConductorCli(
        ['conductor', 'start', '--force'],
        makeDeps(
          {},
          {
            remote,
            spawnConductor,
            procProbe: probe,
            startPollAttempts: 2,
            forceGraceAttempts: 2,
          },
        ),
      );
    } finally {
      lines = logSpy.mock.calls.map((c) => String(c[0]));
      logSpy.mockRestore();
    }
    expect(probe.sentSignals).toEqual(['SIGTERM']);
    expect(spawnConductor.spawned).toHaveLength(1);
    expect(
      lines.some((l) =>
        l.includes('stopped conductor test-machine for restart'),
      ),
    ).toBe(true);
    expect(
      lines.some(
        (l) =>
          l.includes('started conductor test-machine') &&
          l.includes('pid 9999'),
      ),
    ).toBe(true);
    // Never reports the pid it just killed as this start's own (B8).
    expect(lines.some((l) => l.includes('pid 4242'))).toBe(false);
    expect(process.exitCode).toBeUndefined();
  });

  it('escalates to SIGKILL when the grace period elapses with the old pid still running', async () => {
    const remote = new ScriptedRemote([
      [runningRow()], // existing check: running, pid 4242
      [runningRow()], // waitForFreshHeartbeat attempt 0: unchanged by the kill (B8)
      // attempt 1: the new spawn registered AND heartbeated (BB-450 review
      // B15 — see the SIGTERM test's copy of this comment for why the pid
      // alone would not be enough).
      [
        runningRow({
          lastPid: 9999,
          lastSeen: Math.floor(Date.now() / 1000) + 5,
        }),
      ],
    ]);
    const spawnConductor = fakeSpawn();
    // Ignores SIGTERM (still alive after it); dies only on SIGKILL — proving
    // the escalation is driven by the LOCAL pid, never by what the (unrelated,
    // never-updated) control-plane record says.
    const probe = fakeProcProbe(4242, { diesOn: 'SIGKILL' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let lines: string[] = [];
    try {
      await runConductorCli(
        ['conductor', 'start', '--force'],
        makeDeps(
          {},
          {
            remote,
            spawnConductor,
            procProbe: probe,
            startPollAttempts: 2,
            forceGraceAttempts: 1,
          },
        ),
      );
    } finally {
      lines = logSpy.mock.calls.map((c) => String(c[0]));
      logSpy.mockRestore();
    }
    expect(probe.sentSignals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(spawnConductor.spawned).toHaveLength(1);
    expect(
      lines.some(
        (l) =>
          l.includes('started conductor test-machine') &&
          l.includes('pid 9999'),
      ),
    ).toBe(true);
    // Never reports the pid it just killed as this start's own (B8).
    expect(lines.some((l) => l.includes('pid 4242'))).toBe(false);
    expect(process.exitCode).toBeUndefined();
  });

  // BB-450 review B15: a fresh pid on its own used to satisfy
  // `waitForFreshHeartbeat` even when `last_seen` was still the killed
  // conductor's — a registration writes a new pid without touching
  // `last_seen` at all (`ConductorDeriver.php:47`'s deliberate omission), so
  // `started` was reported for a conductor that had only registered, never
  // heartbeated. This fixture's final row carries the NEW pid but the SAME
  // `last_seen` the existing check saw before anything was killed — the
  // registered-but-not-yet-heartbeated state — and must NOT be accepted.
  it('does not report started when a new pid arrives without an advancing heartbeat (BB-450 review B15)', async () => {
    const staleLastSeen = Math.floor(Date.now() / 1000);
    const remote = new ScriptedRemote([
      [runningRow({ lastSeen: staleLastSeen })], // existing check: running, pid 4242
      [runningRow({ lastSeen: staleLastSeen })], // attempt 0: unchanged by the kill (B8)
      // attempt 1: registered (new pid) but last_seen has NOT advanced — the
      // exact registration-without-heartbeat state B15 closes.
      [runningRow({ lastPid: 9999, lastSeen: staleLastSeen })],
    ]);
    const spawnConductor = fakeSpawn();
    const probe = fakeProcProbe(4242, { diesOn: 'SIGTERM' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let lines: string[] = [];
    try {
      await runConductorCli(
        ['conductor', 'start', '--force'],
        makeDeps(
          {},
          {
            remote,
            spawnConductor,
            procProbe: probe,
            startPollAttempts: 2,
            forceGraceAttempts: 2,
          },
        ),
      );
    } finally {
      lines = logSpy.mock.calls.map((c) => String(c[0]));
      logSpy.mockRestore();
    }
    expect(lines.some((l) => l.includes('started conductor'))).toBe(false);
    expect(lines.some((l) => l.includes('failed to start'))).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('fails without a second spawn when the running conductor has no pid to verify', async () => {
    const remote = new ScriptedRemote([[runningRow({ lastPid: undefined })]]);
    const spawnConductor = fakeSpawn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let lines: string[] = [];
    try {
      await runConductorCli(
        ['conductor', 'start', '--force'],
        makeDeps({}, { remote, spawnConductor }),
      );
    } finally {
      lines = logSpy.mock.calls.map((c) => String(c[0]));
      logSpy.mockRestore();
    }
    expect(spawnConductor.spawned).toHaveLength(0);
    expect(lines.some((l) => l.includes('failed to restart'))).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  // A record still `online` by heartbeat (30 s old) whose pid is provably not
  // a conductor on this host: the stopping conductor's offline write never
  // arrived. `start` must treat it as offline, with or without `--force`.
  describe('recorded pid that is not running here', () => {
    const staleRow = (over: Partial<ConductorStatus> = {}) =>
      runningRow({ lastSeen: Math.floor(Date.now() / 1000) - 30, ...over });
    const dead = (): ProcProbe & { sentSignals: NodeJS.Signals[] } =>
      fakeProcProbe(1); // knows no pid 4242
    const recycled = (): ProcProbe & { sentSignals: NodeJS.Signals[] } => ({
      ...fakeProcProbe(4242),
      cmdlineOf: (p: number) =>
        p === 4242 ? '/usr/bin/vim notes.txt' : undefined,
    });
    const startWith = async (
      args: string[],
      row: ConductorStatus,
      probe: ProcProbe,
    ) => {
      const remote = new ScriptedRemote([
        [row],
        [
          runningRow({
            lastPid: 9999,
            lastSeen: Math.floor(Date.now() / 1000) + 5,
          }),
        ],
      ]);
      const spawnConductor = fakeSpawn();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await runConductorCli(
          ['conductor', 'start', ...args],
          makeDeps(
            {},
            { remote, spawnConductor, procProbe: probe, startPollAttempts: 2 },
          ),
        );
        return {
          lines: logSpy.mock.calls.map((c) => String(c[0])),
          spawned: spawnConductor.spawned.length,
        };
      } finally {
        logSpy.mockRestore();
      }
    };

    it.each([
      ['dead pid, plain start', [], dead],
      ['recycled pid, plain start', [], recycled],
      ['dead pid, --force', ['--force'], dead],
      ['recycled pid, --force', ['--force'], recycled],
    ])('%s: starts at once without signalling', async (_n, args, make) => {
      const probe = make();
      const { lines, spawned } = await startWith(args, staleRow(), probe);
      expect(
        lines.some((l) =>
          l.includes(
            'conductor test-machine: recorded pid 4242 is not running here; starting',
          ),
        ),
      ).toBe(true);
      expect(spawned).toBe(1);
      expect(probe.sentSignals).toEqual([]);
      expect(
        lines.some(
          (l) =>
            l.includes('started conductor test-machine') &&
            l.includes('pid 9999'),
        ),
      ).toBe(true);
      expect(lines.some((l) => l.includes('failed'))).toBe(false);
      expect(process.exitCode).toBeUndefined();
    });

    it.each([
      ['another host', staleRow({ hostKey: 'other-host' }), dead()],
      ['no recorded pid', staleRow({ lastPid: undefined }), dead()],
      ['an unsupported platform', staleRow(), { ...dead(), supported: false }],
      ['a live conductor of this id', staleRow(), fakeProcProbe(4242)],
    ])('refuses as today on %s while the heartbeat is fresh', async (_n, row, probe) => {
      const { lines, spawned } = await startWith([], row, probe);
      expect(lines.some((l) => l.includes('already running'))).toBe(true);
      expect(spawned).toBe(0);
      expect(probe.sentSignals).toEqual([]);
    });
  });

  it('behaves as a plain start (no stop, no message) when nothing is running yet', async () => {
    const remote = new HeartbeatAfterSpawnRemote({ id: 'test-machine' });
    const spawnConductor = fakeSpawn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let lines: string[] = [];
    try {
      await runConductorCli(
        ['conductor', 'start', '--force'],
        makeDeps({}, { remote, spawnConductor, startPollAttempts: 3 }),
      );
    } finally {
      lines = logSpy.mock.calls.map((c) => String(c[0]));
      logSpy.mockRestore();
    }
    expect(lines.some((l) => l.includes('stopped conductor'))).toBe(false);
    expect(
      lines.some((l) => l.includes('started conductor test-machine')),
    ).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  // BB-450 AC-3 — the same-conductor-from-any-directory guarantee `stop.test.ts`
  // pins for `stop` also holds for `start`: the already-running detection reads the
  // config's own `conductor_id`/`host_key`, never the process's cwd, so a repeated
  // `start` reports the same outcome from the repository root, `.bakers/`, or a linked
  // worktree.
  it('reports the same already-running conductor from the repository root, from .bakers/, and from a linked worktree', async () => {
    const repoRoot = join(home, 'checkout');
    const bakersConfigDir = join(repoRoot, '.bakers');
    const linkedWorktree = join(home, '.bakers-worktrees', 'other-ticket');
    mkdirSync(bakersConfigDir, { recursive: true });
    mkdirSync(linkedWorktree, { recursive: true });
    const originalCwd = process.cwd();
    const outcomes: string[] = [];

    try {
      for (const dir of [repoRoot, bakersConfigDir, linkedWorktree]) {
        process.chdir(dir);
        const remote = new HeartbeatAfterSpawnRemote({
          id: 'test-machine',
          alreadyRunning: true,
        });
        const spawnConductor = fakeSpawn();
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
          await runConductorCli(
            ['conductor', 'start'],
            makeDeps({}, { remote, spawnConductor }),
          );
        } finally {
          outcomes.push(logSpy.mock.calls.map((c) => String(c[0])).join('\n'));
          logSpy.mockRestore();
        }
        expect(spawnConductor.spawned).toHaveLength(0);
      }
    } finally {
      process.chdir(originalCwd);
    }

    for (const printed of outcomes) {
      expect(printed).toContain('already running');
      expect(printed).toContain('pid 4242');
    }
  });
});

/**
 * A remote whose `listConductors` reports NOT running on its first call (the
 * pre-spawn existing check) and running from the second call onward (the
 * post-spawn heartbeat poll) — unless `alreadyRunning`, which reports running
 * from the very first call, so `start` never reaches the spawn at all.
 */
class HeartbeatAfterSpawnRemote extends FakeBbRemote {
  private calls = 0;

  constructor(private readonly opts: { id: string; alreadyRunning?: boolean }) {
    super();
  }

  override async listConductors(): Promise<ConductorStatus[]> {
    this.calls += 1;
    if (!this.opts.alreadyRunning && this.calls < 2) return [];
    const now = Math.floor(Date.now() / 1000);
    return [
      {
        id: this.opts.id,
        project: 'bakers',
        label: 'test',
        status: 'online',
        lastSeen: now,
        load: 0,
        workspaceRoot: '/home/dev/project',
        leaseExpiresAt: now + 300,
        maxParallel: 1,
        lastPid: 4242,
        hostKey: 'test-host',
      },
    ];
  }
}

describe('bakers conductor start — detached spawn seam', () => {
  const start = async (
    deps: BbCliDeps,
    args: string[] = ['conductor', 'start'],
  ) => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runConductorCli(args, deps);
      return logSpy.mock.calls.map((c) => String(c[0]));
    } finally {
      logSpy.mockRestore();
    }
  };
  const spawnedOf = (deps: BbCliDeps) =>
    (deps.spawnConductor as FakeSpawn).spawned;
  const FOREGROUND = ['start', '--foreground', '--no-update-check'];

  it('spawns the running binary detached in the checkout, logging to the conductor log', async () => {
    const deps = makeDeps();
    await start(deps);
    expect(spawnedOf(deps)).toHaveLength(1);
    const [req] = spawnedOf(deps);
    expect(req.argv).toEqual([
      process.execPath,
      process.argv[1],
      'conductor',
      ...FOREGROUND,
    ]);
    expect(req.cwd).toBe(CHECKOUT);
    expect(req.env.BAKERS_CONDUCTOR_LOG).toBe('file');
    expect(req.logPath).toBe(LOG_PATH);
  });

  it('starts without any process host or herdr addon configured', async () => {
    // makeConfig() lists no addons; the start must not ask for herdr.
    const deps = makeDeps();
    const lines = await start(deps);
    expect(spawnedOf(deps)).toHaveLength(1);
    expect(lines.join('\n')).not.toMatch(/herdr/);
  });

  it('forwards --log-level but not --log-sink: the detached child logs to its file only', async () => {
    const deps = makeDeps();
    await start(deps, [
      'conductor',
      '--log-level',
      'debug',
      '--log-sink',
      'both',
      'start',
    ]);
    expect(spawnedOf(deps)[0].argv.slice(2)).toEqual([
      'conductor',
      '--log-level',
      'debug',
      ...FOREGROUND,
    ]);
  });

  it('BB-477: a variant start carries the --conductor selector so the child cannot re-resolve to the default', async () => {
    const deps = makeDeps(
      {},
      {
        config: makeConfig({
          config_path: join(
            CHECKOUT,
            '.bakers',
            'project.anerkennungsportal.config.js',
          ),
        }),
      },
    );
    await start(deps);
    expect(spawnedOf(deps)[0].argv.slice(2)).toEqual([
      '--conductor',
      'anerkennungsportal',
      'conductor',
      ...FOREGROUND,
    ]);
  });

  it('BB-477: a default or non-conductor config file name selects nothing', async () => {
    for (const name of ['project.config.js', 'connection.config.js']) {
      const deps = makeDeps(
        {},
        { config: makeConfig({ config_path: join(CHECKOUT, name) }) },
      );
      await start(deps);
      expect(spawnedOf(deps)[0].argv.slice(2)).toEqual([
        'conductor',
        ...FOREGROUND,
      ]);
    }
  });

  it('reports FAILED with the exit code and the log path when the child exits before its first heartbeat', async () => {
    const deps = makeDeps(
      {},
      {
        spawnConductor: fakeSpawn({ exited: Promise.resolve(2) }),
        startPollAttempts: 50,
        sleep: () => new Promise((r) => setTimeout(r, 5)),
      },
    );
    const lines = await start(deps);
    expect(
      lines.some(
        (l) =>
          l.includes('failed to start conductor test-machine') &&
          l.includes('exited with code 2 before its first heartbeat') &&
          l.includes(LOG_PATH),
      ),
    ).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('stops polling for a heartbeat once the child has exited', async () => {
    let sleeps = 0;
    const deps = makeDeps(
      {},
      {
        spawnConductor: fakeSpawn({ exited: Promise.resolve(2) }),
        startPollAttempts: 50,
        sleep: () => {
          sleeps++;
          return new Promise((r) => setTimeout(r, 5));
        },
      },
    );
    await start(deps);
    const atReturn = sleeps;
    await new Promise((r) => setTimeout(r, 50));
    expect(sleeps).toBe(atReturn);
  });

  it('reports FAILED with the log path when the child cannot be spawned', async () => {
    const deps = makeDeps(
      {},
      {
        spawnConductor: async () => {
          throw new Error('spawn node ENOENT');
        },
      },
    );
    const lines = await start(deps);
    expect(
      lines.some(
        (l) =>
          l.includes('failed to start conductor test-machine') &&
          l.includes('spawn node ENOENT') &&
          l.includes(LOG_PATH),
      ),
    ).toBe(true);
    expect(process.exitCode).toBe(1);
  });
});

const OLD = '1cdd3fcb-2156-4e3c-877d-52665142268c';
const OTHER = '8a0f2b6e-3c4d-4e5f-9a1b-2c3d4e5f6a7b';

/**
 * A control plane that already has this machine's conductor of the project
 * under an older id: it offers it until the start decides.
 */
class TakeoverRemote extends FakeBbRemote {
  readonly registrations: ConductorRegistration[] = [];

  constructor(
    private readonly known = false,
    private readonly adoptable = [OLD],
  ) {
    super();
  }

  override async listConductors(): Promise<ConductorStatus[]> {
    if (!this.known) return [];
    return [
      {
        id: 'test-machine',
        project: 'bakers',
        label: 'test',
        status: 'offline',
        lastSeen: 0,
        load: 0,
        workspaceRoot: CHECKOUT,
        leaseExpiresAt: 0,
        maxParallel: 1,
      },
    ];
  }

  override async registerConductor(
    reg: ConductorRegistration,
  ): Promise<string> {
    this.registrations.push(reg);
    if (!reg.adopt && !reg.create_new) {
      throw new ConductorTakeoverRequired(
        `This machine, project and variant already have "cw-framework" (bakers oven start --adopt ${OLD}); take it over, or create a new conductor with bakers oven start --new.`,
        this.adoptable,
      );
    }
    return super.registerConductor(reg);
  }
}

describe('bakers conductor start — taking over an existing conductor', () => {
  const start = async (
    remote: TakeoverRemote,
    extra: Partial<BbCliDeps> = {},
    args: string[] = [],
  ) => {
    const deps = makeDeps({}, { remote, ...extra });
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runConductorCli(
        ['conductor', 'start', '--no-update-check', ...args],
        deps,
      );
      return {
        spawned: (deps.spawnConductor as FakeSpawn).spawned.length,
        errors: err.mock.calls.flat().join('\n'),
      };
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  };
  const tty = { stdinIsTTY: true, stdoutIsTTY: true, env: {} };

  it('asks once in a terminal and takes the conductor over on yes', async () => {
    const remote = new TakeoverRemote();
    const asked: string[] = [];
    const { spawned } = await start(remote, {
      ...tty,
      askUpdate: async (q) => {
        asked.push(q);
        return '';
      },
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('cw-framework');
    expect(remote.registrations[0]?.conductor_name).toBe('conductor');
    expect(remote.registrations[1]?.adopt).toBe(OLD);
    expect(spawned).toBe(1);
  });

  it('registers a new conductor on no', async () => {
    const remote = new TakeoverRemote();
    const { spawned } = await start(remote, {
      ...tty,
      askUpdate: async () => 'n',
    });
    expect(remote.registrations[1]?.create_new).toBe(true);
    expect(spawned).toBe(1);
  });

  it('stops without a terminal, naming --adopt and --new', async () => {
    const remote = new TakeoverRemote();
    const { spawned, errors } = await start(remote, {
      stdinIsTTY: false,
      stdoutIsTTY: false,
    });
    expect(spawned).toBe(0);
    expect(process.exitCode).toBe(1);
    expect(errors).toContain(`--adopt ${OLD}`);
    expect(errors).toContain('--new');
  });

  it('lets a terminal pick one of several conductors', async () => {
    const remote = new TakeoverRemote(false, [OLD, OTHER]);
    const asked: string[] = [];
    const { spawned } = await start(remote, {
      ...tty,
      askUpdate: async (q) => {
        asked.push(q);
        return '2';
      },
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(`2) ${OTHER}`);
    expect(remote.registrations[1]?.adopt).toBe(OTHER);
    expect(spawned).toBe(1);
  });

  it('refuses --adopt together with --new', async () => {
    const remote = new TakeoverRemote();
    const { spawned, errors } = await start(remote, {}, [
      '--adopt',
      OLD,
      '--new',
    ]);
    expect(spawned).toBe(0);
    expect(remote.registrations).toHaveLength(0);
    expect(errors).toMatch(/--adopt.*--new|--new.*--adopt/);
  });

  it('takes the decision from --adopt and --new without asking', async () => {
    const adopting = new TakeoverRemote();
    await start(adopting, {}, ['--adopt', OLD]);
    expect(adopting.registrations[0]?.adopt).toBe(OLD);

    const creating = new TakeoverRemote();
    await start(creating, {}, ['--new']);
    expect(creating.registrations[0]?.create_new).toBe(true);
  });

  it('asks nothing once the conductor is known by its id', async () => {
    const remote = new TakeoverRemote(true);
    const { spawned } = await start(remote, tty);
    expect(remote.registrations).toHaveLength(0);
    expect(spawned).toBe(1);
  });
});

describe('bakers conductor start banner (BB-145)', () => {
  it('prints the installed bakers version banner on start (AC-2)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runConductorCli(['conductor', 'start'], makeDeps());
    } catch {
      // ignore any unhandled throw — we only care about console output
    }
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toMatch(/bakers v\d+\.\d+\.\d+/);
    logSpy.mockRestore();
  });

  it('prints the update notice before conductor startup output', async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((m) => {
      logs.push(String(m));
    });
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ version: '999.0.0' }))) as typeof fetch;
    const deps = makeDeps({}, { fetch: fetchImpl });
    deps.onStartLoop = () => logs.push('LOOP_STARTED');
    await runConductorCli(['conductor', 'start'], deps).catch(() => {});
    const notice = logs.findIndex((l) => l.includes('bakers update'));
    const loop = logs.indexOf('LOOP_STARTED');
    expect(notice).toBeGreaterThanOrEqual(0);
    expect(loop).toBeGreaterThan(notice);
    logSpy.mockRestore();
  });

  it('--no-update-check suppresses lookup and notice but keeps the version line', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ version: '999.0.0' })),
    ) as typeof fetch;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runConductorCli(
      ['conductor', 'start', '--no-update-check'],
      makeDeps({}, { fetch: fetchImpl }),
    ).catch(() => {});
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(printed).toMatch(/bakers v\d+\.\d+\.\d+/);
    expect(printed).not.toContain('bakers update');
    logSpy.mockRestore();
  });

  it('uses the same pre-loop banner for a direct foreground start', async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message) => {
      logs.push(String(message));
    });
    const deps = makeDeps(
      {},
      {
        fetch: (async () =>
          new Response(JSON.stringify({ version: '999.0.0' }))) as typeof fetch,
        onStartLoop: () => {
          logs.push('LOOP_STARTED');
          throw new Error('stop before long-running loop');
        },
      },
    );
    await expect(
      runConductorCli(['conductor', 'start', '--foreground'], deps),
    ).rejects.toThrow('stop before long-running loop');
    const notice = logs.findIndex((line) => line.includes('bakers update'));
    expect(notice).toBeGreaterThanOrEqual(0);
    expect(logs.indexOf('LOOP_STARTED')).toBeGreaterThan(notice);
    logSpy.mockRestore();
  });

  it('prints an update notice on start when a newer version is published (AC-3)', async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((m) => {
      logs.push(String(m));
    });
    const newer = (async () =>
      new Response(JSON.stringify({ version: '999.0.0' }), {
        status: 200,
      })) as unknown as typeof fetch;
    await runConductorCli(
      ['conductor', 'start'],
      makeDeps({}, { fetch: newer }),
    ).catch(() => {});
    expect(logs.join('\n')).toContain('bakers update');
    logSpy.mockRestore();
  });

  it('prints no notice and does not hang when the registry is offline (AC-4)', async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((m) => {
      logs.push(String(m));
    });
    const offline = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await runConductorCli(
      ['conductor', 'start'],
      makeDeps({}, { fetch: offline }),
    ).catch(() => {});
    const printed = logs.join('\n');
    expect(printed).toMatch(/bakers v\d+\.\d+\.\d+/);
    expect(printed).not.toContain('bakers update');
    logSpy.mockRestore();
  });
});

describe('bakers conductor start update prompt', () => {
  const now = new Date('2026-08-03T12:00:00.000Z');
  const newer = (async () =>
    new Response(JSON.stringify({ version: '999.0.0' }))) as typeof fetch;

  function promptDeps(extra: Partial<BbCliDeps> = {}): {
    deps: BbCliDeps;
    cachePath: string;
    spawnConductor: FakeSpawn;
  } {
    const cachePath = join(
      mkdtempSync(join(tmpdir(), 'bakers-start-update-')),
      'update-check.json',
    );
    const deps = makeDeps(
      {},
      {
        fetch: newer,
        stdinIsTTY: true,
        stdoutIsTTY: true,
        env: { ...process.env, CI: '' },
        updateCheckOptions: { cachePath, now: () => now },
        ...extra,
      },
    );
    return {
      deps,
      cachePath,
      spawnConductor: deps.spawnConductor as FakeSpawn,
    };
  }

  it('yes: runs update then migration, prints rerun, and skips startup', async () => {
    const commands: string[][] = [];
    const asked: string[] = [];
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((m) => {
      logs.push(String(m));
    });
    const { deps, spawnConductor } = promptDeps({
      env: { ...process.env, CI: '', BAKERS_CONDUCTOR: 'portal' },
      askUpdate: async (question) => {
        asked.push(question);
        return '';
      },
      runBb: async (args) => {
        commands.push(args);
      },
      onStartLoop: () => {
        logs.push('LOOP_STARTED');
      },
    });
    await runConductorCli(['conductor', 'start', '--force'], deps);
    logSpy.mockRestore();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('A new bakers version is available (');
    expect(asked[0]).toContain('999.0.0');
    expect(asked[0]).toContain('Install it now? [Y/n]');
    expect(commands).toEqual([
      ['update'],
      ['config', 'upgrade', '--scope', 'all', '--yes'],
    ]);
    expect(logs.join('\n')).toContain(
      'bakers update and configuration migration completed.',
    );
    expect(logs.join('\n')).toContain(
      'bakers --conductor portal conductor start --force',
    );
    expect(logs).not.toContain('LOOP_STARTED');
    expect(spawnConductor.spawned).toHaveLength(0);
  });

  it('no: starts immediately, persists the decline, and does not prompt again', async () => {
    const commands: string[][] = [];
    let prompts = 0;
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((m) => {
      logs.push(String(m));
    });
    const shared = join(
      mkdtempSync(join(tmpdir(), 'bakers-start-decline-')),
      'update-check.json',
    );
    const first = promptDeps({
      askUpdate: async () => {
        prompts += 1;
        return 'n';
      },
      runBb: async (args) => {
        commands.push(args);
      },
      onStartLoop: () => {
        logs.push('LOOP_STARTED');
      },
      updateCheckOptions: { cachePath: shared, now: () => now },
    });
    first.deps.updateCheckOptions = { cachePath: shared, now: () => now };
    await runConductorCli(['conductor', 'start'], first.deps);
    expect(JSON.parse(readFileSync(shared, 'utf8'))).toMatchObject({
      latestVersion: '999.0.0',
      declined: true,
    });
    const secondLogs: string[] = [];
    const secondAsk = vi.fn(async () => 'y');
    const second = makeDeps(
      {},
      {
        fetch: newer,
        stdinIsTTY: true,
        stdoutIsTTY: true,
        env: { ...process.env, CI: '' },
        updateCheckOptions: { cachePath: shared, now: () => now },
        askUpdate: secondAsk,
        runBb: async (args) => {
          commands.push(args);
        },
        onStartLoop: () => {
          secondLogs.push('LOOP_STARTED');
        },
      },
    );
    await runConductorCli(['conductor', 'start'], second);
    logSpy.mockRestore();
    expect(prompts).toBe(1);
    expect(secondAsk).not.toHaveBeenCalled();
    expect(commands).toEqual([]);
    expect(logs).toContain('LOOP_STARTED');
    expect(secondLogs).toContain('LOOP_STARTED');
    expect(first.spawnConductor.spawned).toHaveLength(1);
    expect((second.spawnConductor as FakeSpawn).spawned).toHaveLength(1);
  });

  it('repeats the question on invalid input then accepts no', async () => {
    const answers = ['maybe', 'NO'];
    const asked: string[] = [];
    const { deps, spawnConductor } = promptDeps({
      askUpdate: async (question) => {
        asked.push(question);
        return answers.shift() ?? 'n';
      },
      runBb: async () => {
        throw new Error('runBb should not run');
      },
    });
    await runConductorCli(['conductor', 'start'], deps);
    expect(asked).toHaveLength(2);
    expect(spawnConductor.spawned).toHaveLength(1);
  });

  it('treats cancellation as abort without decline, install, or start', async () => {
    const { deps, cachePath, spawnConductor } = promptDeps({
      askUpdate: async () => {
        throw new Error('cancelled');
      },
      runBb: async () => {
        throw new Error('runBb should not run');
      },
      onStartLoop: () => {
        throw new Error('onStartLoop should not run');
      },
    });
    await runConductorCli(['conductor', 'start'], deps);
    expect(spawnConductor.spawned).toHaveLength(0);
    expect(process.exitCode).toBe(1);
    const record = JSON.parse(readFileSync(cachePath, 'utf8')) as {
      declined?: boolean;
    };
    expect(record.declined).toBeUndefined();
  });

  it.each([
    ['non-TTY', { stdinIsTTY: false, stdoutIsTTY: true }],
    ['stdout not a TTY', { stdinIsTTY: true, stdoutIsTTY: false }],
    ['CI', { env: { ...process.env, CI: '1' } }],
    ['foreground', { foregroundArg: true }],
  ] as const)('%s starts remain notice-only', async (_label, variant) => {
    const askUpdate = vi.fn(async () => 'y');
    const runBb = vi.fn(async () => {});
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((m) => {
      logs.push(String(m));
    });
    const extra: Partial<BbCliDeps> = {
      askUpdate,
      runBb,
      onStartLoop: () => {
        logs.push('LOOP_STARTED');
      },
    };
    if ('stdinIsTTY' in variant) extra.stdinIsTTY = variant.stdinIsTTY;
    if ('stdoutIsTTY' in variant) extra.stdoutIsTTY = variant.stdoutIsTTY;
    if ('env' in variant) extra.env = variant.env;
    const { deps, spawnConductor } = promptDeps(extra);
    const argv =
      'foregroundArg' in variant
        ? (['conductor', 'start', '--foreground'] as string[])
        : (['conductor', 'start'] as string[]);
    if ('foregroundArg' in variant) {
      deps.onStartLoop = () => {
        logs.push('LOOP_STARTED');
        throw new Error('stop before long-running loop');
      };
      await expect(runConductorCli(argv, deps)).rejects.toThrow(
        'stop before long-running loop',
      );
    } else {
      await runConductorCli(argv, deps);
    }
    logSpy.mockRestore();
    expect(askUpdate).not.toHaveBeenCalled();
    expect(runBb).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('bakers update');
    expect(logs).toContain('LOOP_STARTED');
    if (!('foregroundArg' in variant))
      expect(spawnConductor.spawned).toHaveLength(1);
  });

  it('--no-update-check performs no lookup, prompt or notice', async () => {
    const fetchImpl = vi.fn(newer);
    const askUpdate = vi.fn(async () => 'y');
    const { deps } = promptDeps({
      fetch: fetchImpl,
      askUpdate,
      runBb: async () => {
        throw new Error('runBb should not run');
      },
    });
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((m) => {
      logs.push(String(m));
    });
    await runConductorCli(['conductor', 'start', '--no-update-check'], deps);
    logSpy.mockRestore();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(askUpdate).not.toHaveBeenCalled();
    expect(logs.join('\n')).toMatch(/bakers v\d+\.\d+\.\d+/);
    expect(logs.join('\n')).not.toContain('bakers update');
  });

  it('does not prompt when no newer version is published', async () => {
    const askUpdate = vi.fn(async () => 'y');
    const { deps, spawnConductor } = promptDeps({
      fetch: (async () =>
        new Response(JSON.stringify({ version: '0.0.1' }))) as typeof fetch,
      askUpdate,
      runBb: async () => {
        throw new Error('runBb should not run');
      },
    });
    await runConductorCli(['conductor', 'start'], deps);
    expect(askUpdate).not.toHaveBeenCalled();
    expect(spawnConductor.spawned).toHaveLength(1);
  });

  it('still prompts on a UI-populated cache that was never declined', async () => {
    const { deps, cachePath, spawnConductor } = promptDeps({
      askUpdate: async () => 'n',
      runBb: async () => {
        throw new Error('runBb should not run');
      },
    });
    writeFileSync(
      cachePath,
      JSON.stringify({
        checkedAt: now.toISOString(),
        latestVersion: '999.0.0',
      }),
    );
    await runConductorCli(['conductor', 'start'], deps);
    expect(spawnConductor.spawned).toHaveLength(1);
    expect(JSON.parse(readFileSync(cachePath, 'utf8')).declined).toBe(true);
  });

  it('prompts again after the original cache TTL expires', async () => {
    const cachePath = join(
      mkdtempSync(join(tmpdir(), 'bakers-start-ttl-')),
      'update-check.json',
    );
    writeFileSync(
      cachePath,
      JSON.stringify({
        checkedAt: now.toISOString(),
        latestVersion: '999.0.0',
        declined: true,
      }),
    );
    const askUpdate = vi.fn(async () => 'n');
    const expiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const deps = makeDeps(
      {},
      {
        fetch: newer,
        stdinIsTTY: true,
        stdoutIsTTY: true,
        env: { ...process.env, CI: '' },
        updateCheckOptions: { cachePath, now: () => expiry },
        askUpdate,
      },
    );
    await runConductorCli(['conductor', 'start'], deps);
    expect(askUpdate).toHaveBeenCalledOnce();
  });

  it('update failure with --force does not stop a running conductor or start old code', async () => {
    const errors: string[] = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation((m) => {
      errors.push(String(m));
    });
    const { deps, spawnConductor } = promptDeps({
      askUpdate: async () => 'y',
      runBb: async () => {
        throw new Error('npm failed');
      },
      onStartLoop: () => {
        throw new Error('onStartLoop should not run');
      },
    });
    await runConductorCli(['conductor', 'start', '--force'], deps);
    errSpy.mockRestore();
    expect(spawnConductor.spawned).toHaveLength(0);
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/update/i);
  });

  it('migration failure does not start after a successful update', async () => {
    const commands: string[][] = [];
    const errors: string[] = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation((m) => {
      errors.push(String(m));
    });
    const { deps, spawnConductor } = promptDeps({
      env: { ...process.env, CI: '', BAKERS_CONDUCTOR: 'portal' },
      askUpdate: async () => 'yes',
      runBb: async (args) => {
        commands.push(args);
        if (args.includes('upgrade')) throw new Error('upgrade failed');
      },
      onStartLoop: () => {
        throw new Error('onStartLoop should not run');
      },
    });
    await runConductorCli(['conductor', 'start'], deps);
    errSpy.mockRestore();
    expect(commands).toEqual([
      ['update'],
      ['config', 'upgrade', '--scope', 'all', '--yes'],
    ]);
    expect(spawnConductor.spawned).toHaveLength(0);
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain(
      'Retry with: bakers --conductor portal config upgrade --scope all --yes',
    );
    expect(errors.join('\n')).toContain(
      'bakers --conductor portal conductor start',
    );
  });

  it('warns when a decline cannot be remembered and still starts', async () => {
    const errors: string[] = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation((m) => {
      errors.push(String(m));
    });
    const writeFileImpl = vi.fn(async () => {
      throw new Error('EACCES');
    });
    const { deps, cachePath, spawnConductor } = promptDeps({
      askUpdate: async () => 'n',
    });
    writeFileSync(
      cachePath,
      JSON.stringify({
        checkedAt: now.toISOString(),
        latestVersion: '999.0.0',
      }),
    );
    deps.updateCheckOptions = {
      ...deps.updateCheckOptions,
      writeFileImpl,
    };
    await runConductorCli(['conductor', 'start'], deps);
    errSpy.mockRestore();
    expect(spawnConductor.spawned).toHaveLength(1);
    expect(errors.join('\n')).toMatch(/remember/i);
    expect(writeFileImpl).toHaveBeenCalled();
  });
});

// The `bakers oven stop` behaviour tests live in ./stop.test.ts (BB-232).
// The suite that stood here asserted the previous model — kill the registered
// herdr handle, then write `offline` from the stopping process — and both
// halves were deliberately replaced: a heartbeat overwrites an externally
// written `offline`, and killing a pane is neither necessary nor sufficient to
// stop a conductor that may have no pane at all. Every case it covered has a
// successor there against the verified-signal model.

// `bakers conductor rm` no longer exists (BB-232): its only job was deleting a
// local registry entry, and there is no registry. Its absence is asserted in
// ./no-registry.test.ts.

// `bakers oven ls` builds its rows from the control plane alone now; the
// registry-only case it used to assert cannot occur. See ./no-registry.test.ts.
