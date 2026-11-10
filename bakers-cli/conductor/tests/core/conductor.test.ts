import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ClaudeAgent,
  claudeAgent,
  encodeClaudeProjectDir,
  parseClaudeTranscript,
} from '@bakers-build/addon-claude';
import { parseCodexTranscript } from '@bakers-build/addon-codex';
import {
  FakeBbRemote,
  FakeExecutor,
  type FakeRemoteSeed,
  type FakeSeedRun,
  type FakeSeedTicket,
  FakeWorkspace,
  fakeExecutor,
  fakeInbox,
  fakeRemote,
  fakeWorkspace,
} from '@bakers-build/addon-fake';
import type {
  AgentRunIdentity,
  BbAgent,
  BbExecutor,
  BbRemote,
  BbWorkspace,
  ConductorFileConfig,
  HookContext,
  HookListener,
  HookListenerContext,
  HookName,
  HookResult,
  ResolvedAgent,
  SpawnRunInput,
  WorktreeTeardown,
} from '@bakers-build/conductor/contract';
import { type ConductorLogger, shellQuote } from '@bakers-build/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';
import { attemptFamily, attemptSessionId } from '../../src/core/attempt.js';
import type { Conductor } from '../../src/core/conductor.js';
import { measureMrChanges } from '../../src/core/mr-changes.js';
import { loadInbox } from '../../src/plugins/message.js';
import { TestConductor } from '../test-conductor.js';

// Git runs against a real repository in mr-changes.test.ts; here the reap
// only has to call it and write what it returns.
vi.mock('../../src/core/mr-changes.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/core/mr-changes.js')>()),
  measureMrChanges: vi.fn(),
}));

/**
 * A worktree directory that REALLY exists on disk, for every reaper fixture that
 * models a PRESENT worktree.
 *
 * The reaper only runs `after_done` for a directory that is actually there
 * (BB-293 AC 2) — the hook is a shell spawned with that directory as its
 * `cwd`, so an absent one can only ever produce an `ENOENT` the shared exec
 * helper logs at ERROR. A made-up path like `/wt/t-1` therefore stops
 * exercising the hook the moment the guard exists, and would let a blanket
 * removal of the hook call pass unnoticed.
 */
const PRESENT_WORKTREE = mkdtempSync(join(tmpdir(), 'bakers-reap-present-'));
/**
 * A path guaranteed NOT to exist — the absent-worktree fixture. Nested inside
 * {@link PRESENT_WORKTREE} so it is reclaimed with it and can never collide with
 * a real directory.
 */
const ABSENT_WORKTREE = join(PRESENT_WORKTREE, 'gone');

afterAll(() => {
  rmSync(PRESENT_WORKTREE, { recursive: true, force: true });
});

/** Walks up from this test file to the repo root (the dir that holds WORKFLOW.md). */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    try {
      readFileSync(join(dir, 'WORKFLOW.md'), 'utf8');
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error('WORKFLOW.md not found walking up from the test file');
}

/**
 * Reads the project's real WORKFLOW.md: the entry line plus phase-named hints;
 * ordering + stop/continue routing live in the frame skill, so the guard's
 * Scenarios are asserted there.
 */
function readProjectWorkflow(): string {
  return readFileSync(join(repoRoot(), 'WORKFLOW.md'), 'utf8');
}

/** Reads a bakers step-owning skill's SKILL.md. */
function readSkill(name: string): string {
  return readFileSync(
    join(repoRoot(), '.claude/skills/bakers-build/skills', name, 'SKILL.md'),
    'utf8',
  );
}

/** Reads a bb-workflow reference: a state file or a mechanic. */
function readReference(name: string): string {
  return readFileSync(
    join(
      repoRoot(),
      '.claude/skills/bakers-build/skills/bb-workflow/references',
      name,
    ),
    'utf8',
  );
}

/** Returns the body of a `## <heading>` section up to the next `## ` header. */
function mdSection(md: string, heading: string): string {
  const lines = md.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

interface LogCall {
  level: 'debug' | 'info' | 'warn' | 'error';
  obj: object;
  msg?: string;
}

function spyLogger(): { log: ConductorLogger; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const mk = (level: LogCall['level']) => (obj: object, msg?: string) => {
    calls.push({ level, obj, msg });
  };
  return {
    calls,
    log: {
      debug: mk('debug'),
      info: mk('info'),
      warn: mk('warn'),
      error: mk('error'),
    },
  };
}

/** Minimal fake agent for conductor dispatch tests. */
const fakeAgent: BbAgent = {
  id: 'claude',
  launchCommand: (p: string) =>
    p === '' ? 'claude' : `claude '${p}' --dangerously-skip-permissions`,
  getRunLog: async () => '',
  parseFootprint: (log: string) => parseClaudeTranscript(log),
};

/** Wrap a BbAgent as the 1-element ResolvedAgent[] the Conductor now takes. */
const resolved = (a: BbAgent): ResolvedAgent[] => [{ id: a.id, agent: a }];

const CHECKOUT = join(tmpdir(), 'bakers-conductor-test-checkout');

function makeConfig(
  overrides: Partial<ConductorFileConfig> = {},
): ConductorFileConfig {
  return {
    site: { base_url: 'http://web', jsonapi_prefix: '/jsonapi' },
    remote: fakeRemote(),
    executor: fakeExecutor(),
    agent: [{ agent: claudeAgent() }],
    workspace: fakeWorkspace(),
    label: 'test label',
    // conductor_id is required (BB-353); a default here keeps every
    // pre-existing test that does not care about identity unaffected by
    // BB-450 D5 removing the directory-derived id fallback.
    conductor_id: 'bakers-test-conductor',
    project: 'bakers',
    states: ['todo', 'working'],
    prompt: DEFAULT_AGENT_PROMPT,
    // The budget lives on the fake machine row for this host (default 5).
    host_key: 'test-host',
    poll_interval_ms: 5000,
    lease_seconds: 300,
    config_path: `${CHECKOUT}/project.config.js`,
    ...overrides,
  };
}

type RecordingCall =
  | { kind: 'cleanupRun'; branch: string; runId: number }
  | { kind: 'stopRun'; branch: string }
  | { kind: 'startRun'; identifier: string }
  | { kind: 'removeWorktree'; branch: string; worktreePath?: string };

/**
 * Simple recording executor — captures startRun inputs and cleanupRun/startRun
 * call order. `runHook` and `removeWorktree` are not executor methods: they
 * record the conductor's hooks and the workspace teardown, wired to their
 * owners by {@link TestConductor}.
 */
class RecordingExecutor implements BbExecutor {
  readonly id = 'recording';
  readonly started: SpawnRunInput[] = [];
  /** Ordered log of cleanupRun()/stopRun()/startRun() invocations. */
  readonly calls: RecordingCall[] = [];
  /** Branches passed to removeWorktree(), in call order. */
  readonly removed: string[] = [];
  /** (branch, worktreePath) pairs passed to removeWorktree(), in call order. */
  readonly removeArgs: Array<{ branch: string; worktreePath?: string }> = [];
  /** When true, capabilities().persistent is true (herdr-like). */
  persistent = false;
  /** When set, removeWorktree throws it (simulates a miss/teardown failure). */
  removeWorktreeError: Error | null = null;
  /**
   * removeWorktree's return: true = worktree present on this host and torn
   * down ('removed'); false = not present here and unresolvable
   * ('unverified'). Defaults true.
   */
  removeWorktreePresent = true;
  /**
   * removeWorktree's outcome when {@link removeWorktreePresent} holds
   * (BB-293). Defaults to `removed`; set it to `already_absent` to model a
   * worktree that was gone before the reaper got there.
   */
  removeWorktreeOutcome: WorktreeTeardown = 'removed';
  /** Lifecycle-hook invocations, in call order (name + cwd + ticket). */
  readonly hookCalls: Array<{ name: HookName; cwd: string; ticket: string }> =
    [];

  capabilities() {
    return { persistent: this.persistent };
  }

  /** Hook slots whose command "fails" — runHook reports ok:false for these. */
  readonly failingHooks = new Set<HookName>();

  async runHook(
    name: HookName,
    cwd: string,
    ctx: HookContext,
  ): Promise<HookResult> {
    // Best-effort by contract — never throws (the real executor swallows), but
    // it DOES report its outcome so the caller can record it (BB-237 AC-6).
    this.hookCalls.push({ name, cwd, ticket: ctx.ticket });
    if (this.failingHooks.has(name)) {
      return { hook: name, ran: true, ok: false, error: `${name} boom` };
    }
    return { hook: name, ran: true, ok: true };
  }

  async startRun(input: SpawnRunInput) {
    this.started.push(input);
    this.calls.push({ kind: 'startRun', identifier: input.ticket.identifier });
    return { sessionRef: input.ticket.branchName };
  }

  /** When set, cleanupRun throws it (simulates a failing tab-close). */
  cleanupRunError: Error | null = null;
  /** Observer invoked at cleanupRun time — used to snapshot cross-object state
   * (e.g. that finalizeRun has already been recorded) for ordering assertions. */
  onCleanupRun: ((branch: string) => void) | null = null;

  async stopRun(branch: string): Promise<void> {
    this.calls.push({ kind: 'stopRun', branch });
  }

  async cleanupRun(branch: string, runId: number): Promise<void> {
    this.calls.push({ kind: 'cleanupRun', branch, runId });
    this.onCleanupRun?.(branch);
    if (this.cleanupRunError) {
      throw this.cleanupRunError;
    }
  }

  async removeWorktree(
    branch: string,
    worktreePath?: string,
  ): Promise<WorktreeTeardown> {
    this.calls.push({ kind: 'removeWorktree', branch, worktreePath });
    this.removeArgs.push({ branch, worktreePath });
    if (this.removeWorktreeError) {
      throw this.removeWorktreeError;
    }
    if (!this.removeWorktreePresent) {
      return 'unverified'; // not resolvable here → nothing torn down.
    }
    this.removed.push(branch);
    return this.removeWorktreeOutcome;
  }
}

async function startedConductor(
  config: ConductorFileConfig,
  remote: FakeBbRemote,
  executor: BbExecutor,
  workspace = new FakeWorkspace(),
): Promise<Conductor> {
  const { log } = spyLogger();
  const conductor = new TestConductor(
    config,
    remote,
    executor,
    workspace,
    resolved(fakeAgent),
    log,
    CHECKOUT,
  );
  await conductor.start();
  return conductor;
}

describe('Conductor', () => {
  it.each([false, true])('publishes connection only at actual serve start (serve=%s)', async (serve) => {
    const remote = new FakeBbRemote();
    const register = vi.spyOn(remote, 'registerConductor');
    const heartbeat = vi.spyOn(remote, 'heartbeat');
    const hook = vi.fn<NonNullable<HookListener['before_conductor_start']>>((machine) => { machine.connection_url = 'ssh://user@host:22'; });
    const conductor = new TestConductor(
      makeConfig({ hookListeners: [{ before_conductor_start: hook }] }),
      remote, new RecordingExecutor(), new FakeWorkspace(), resolved(fakeAgent), spyLogger().log, CHECKOUT,
    );
    if (serve) conductor.claimServeProcess();
    await conductor.start(); await conductor.tick(); await conductor.tick();
    expect(hook).toHaveBeenCalledTimes(serve ? 1 : 0);
    expect(register.mock.calls[0][0].connection_url).toBe(serve ? 'ssh://user@host:22' : undefined);
    expect(heartbeat.mock.calls.length).toBeGreaterThan(0);
    for (const [reg] of heartbeat.mock.calls) expect(reg).not.toHaveProperty('connection_url');
    if (serve) {
      expect(hook.mock.calls[0][0]).toEqual({ host_key: 'test-host', connection_url: 'ssh://user@host:22' });
      expect(hook.mock.calls[0][1]).toEqual({ id: 'bakers-test-conductor', project: 'bakers', variant: 'conductor' });
    }
  });

  // BB-663: the after_create bootstrap record lives beside the shared
  // CHECKOUT config file, keyed by worktree path, not inside the worktree.
  // Clear it before every test so one test's recorded outcome for a fixed
  // path (e.g. `/fake/BB-1`, reused across many tests) cannot leak into
  // another's "no record yet" assumption.
  beforeEach(() => {
    rmSync(`${CHECKOUT}/project.config.bootstrapped.json`, {
      force: true,
    });
  });

  it('logs capacity withholding separately from reported load and does not dispatch', async () => {
    const remote: BbRemote = new FakeBbRemote();
    remote.machineCapacity = async () => ({ maxParallel: 9, currentLoad: 7 });
    remote.claimNext = async () => ({
      reason: 'machine_capacity',
      occupancy: 9,
      capacity: 9,
      retryAt: null,
    });
    const executor = new RecordingExecutor();
    const { log, calls } = spyLogger();
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      new FakeWorkspace(),
      resolved(fakeAgent),
      log,
      CHECKOUT,
    );
    await conductor.start();
    await conductor.tick();
    expect(executor.started).toHaveLength(0);
    expect(calls).toContainEqual({
      level: 'info',
      msg: 'claim withheld: machine at capacity',
      obj: {
        conductorId: conductor.id,
        reason: 'machine_capacity',
        occupancy: 9,
        capacity: 9,
        reportedLoad: 7,
        retryAt: null,
      },
    });
    expect(calls.some((call) => call.msg === 'idle, nothing to claim')).toBe(
      false,
    );
    remote.claimNext = async () => null;
    await conductor.tick();
    expect(calls.some((call) => call.msg === 'idle, nothing to claim')).toBe(
      true,
    );
  });

  it('exposes the id from config.conductor_id — no directory-derived fallback (BB-450 D5)', () => {
    const conductor = new TestConductor(
      makeConfig({ conductor_id: 'cw-dev-box-bakers' }),
      new FakeBbRemote(),
      new FakeExecutor({ outcome: 'exited' }),
      new FakeWorkspace(),
      resolved(fakeAgent),
      spyLogger().log,
      CHECKOUT,
    );
    expect(conductor.id).toBe('cw-dev-box-bakers');
  });

  it('throws naming bakers init rather than deriving an id from the checkout directory when the machine has no UUID', () => {
    const conductor = new TestConductor(
      makeConfig({ conductor_id: undefined }),
      new FakeBbRemote(),
      new FakeExecutor({ outcome: 'exited' }),
      new FakeWorkspace(),
      resolved(fakeAgent),
      spyLogger().log,
      CHECKOUT,
    );
    expect(() => conductor.id).toThrow('run bakers init');
  });

  it('dispatches up to max_parallel and records markRunning per dispatch', async () => {
    const seed: FakeRemoteSeed = {
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'todo' },
        't-2': { identifier: 'BB-2', title: 'Two', state: 'todo' },
        't-3': { identifier: 'BB-3', title: 'Three', state: 'todo' },
      },
    };
    const remote = new FakeBbRemote(seed);
    // Three runs available to claim; the machine's budget is 2.
    remote.seedMachineLoad('test-host', { currentLoad: 0, maxParallel: 2 });
    for (const i of [1, 2, 3]) {
      remote.queue.push({
        runUuid: `r-${i}`,
        runId: i,
        ticketUuid: `t-${i}`,
        stateAtStart: 'todo',
        handler: 'code',
      });
    }
    const executor = new RecordingExecutor();
    const conductor = await startedConductor(makeConfig(), remote, executor);

    await conductor.tick();

    expect(executor.started.map((s) => s.run.uuid)).toEqual(['r-1', 'r-2']);
    expect(remote.calls.markRunning).toEqual([
      {
        runUuid: 'r-1',
        attrs: {
          worktree_path: '/fake/BB-1',
          agent: 'claude',
          startedAt: expect.any(Number),
        },
      },
      {
        runUuid: 'r-2',
        attrs: {
          worktree_path: '/fake/BB-2',
          agent: 'claude',
          startedAt: expect.any(Number),
        },
      },
    ]);
  });

  // BB-353 D5: dispatch budget is shared across conductors on one host.
  // Control-plane machine.current_load (after heartbeat) gates claims — not only
  // this process's activeRunCount.
  it('claims nothing when machine is already at capacity with 0 local active runs (BB-353 D5)', async () => {
    const seed: FakeRemoteSeed = {
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'todo' },
        't-2': { identifier: 'BB-2', title: 'Two', state: 'todo' },
      },
    };
    const remote = new FakeBbRemote(seed);
    // Peer conductors already fill the host budget (current_load >= max_parallel).
    remote.seedMachineLoad('dev-box', { currentLoad: 2, maxParallel: 2 });
    for (const i of [1, 2]) {
      remote.queue.push({
        runUuid: `r-${i}`,
        runId: i,
        ticketUuid: `t-${i}`,
        stateAtStart: 'todo',
        handler: 'code',
      });
    }
    const executor = new RecordingExecutor();
    const conductor = await startedConductor(
      makeConfig({
        host_key: 'dev-box',
        conductor_id: 'cw-dev-box-bakers',
      }),
      remote,
      executor,
    );

    await conductor.tick();

    expect(executor.started).toEqual([]);
    expect(remote.calls.markRunning).toEqual([]);
  });

  it('claims only remaining shared machine capacity (BB-353 D5)', async () => {
    const seed: FakeRemoteSeed = {
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'todo' },
        't-2': { identifier: 'BB-2', title: 'Two', state: 'todo' },
        't-3': { identifier: 'BB-3', title: 'Three', state: 'todo' },
      },
    };
    const remote = new FakeBbRemote(seed);
    // Peer holds 1 of 2 slots; this process may claim only one more.
    remote.seedMachineLoad('dev-box', { currentLoad: 1, maxParallel: 2 });
    for (const i of [1, 2, 3]) {
      remote.queue.push({
        runUuid: `r-${i}`,
        runId: i,
        ticketUuid: `t-${i}`,
        stateAtStart: 'todo',
        handler: 'code',
      });
    }
    const executor = new RecordingExecutor();
    const conductor = await startedConductor(
      makeConfig({
        host_key: 'dev-box',
        conductor_id: 'cw-dev-box-bakers',
      }),
      remote,
      executor,
    );

    await conductor.tick();

    expect(executor.started.map((s) => s.run.uuid)).toEqual(['r-1']);
    expect(remote.calls.markRunning).toHaveLength(1);
  });

  it('registration uses config.host_key (MachineContext stem), not hyphen-split of conductor_id', async () => {
    class RecordingRemote extends FakeBbRemote {
      lastReg?: {
        id: string;
        host_key?: string;
      };
      override async registerConductor(reg: {
        id: string;
        host_key?: string;
      }): Promise<string> {
        this.lastReg = { id: reg.id, host_key: reg.host_key };
        return super.registerConductor(reg as never);
      }
    }
    const remote = new RecordingRemote();
    // Project segment contains a hyphen so naive split of conductor_id would
    // mis-derive host as "laptop-my" instead of the explicit MachineContext stem.
    await startedConductor(
      makeConfig({
        conductor_id: 'cw-laptop-my-app',
        host_key: 'laptop',
      }),
      remote,
      new RecordingExecutor(),
    );

    expect(remote.lastReg?.id).toBe('cw-laptop-my-app');
    expect(remote.lastReg?.host_key).toBe('laptop');
  });

  it('dispatches the highest-priority agent and persists its id (BB-144)', async () => {
    const mk = (id: string): BbAgent => ({
      id,
      launchCommand: (p: string) => (p === '' ? `run-${id}` : `run-${id} ${p}`),
      getRunLog: async () => '',
      parseFootprint: (log: string) => parseClaudeTranscript(log),
    });
    const remote = new FakeBbRemote({
      tickets: { 't-1': { identifier: 'BB-1', title: 'One', state: 'todo' } },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'todo',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    const agents: ResolvedAgent[] = [
      { id: 'lo', agent: mk('lo'), priority: () => 1 },
      { id: 'hi', agent: mk('hi'), priority: () => 9 },
    ];
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      new FakeWorkspace(),
      agents,
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    // FakeWorkspace has no WORKFLOW.md → bare command from the chosen agent.
    expect(executor.started[0]?.command).toBe('run-hi');
    expect(remote.calls.markRunning[0]).toMatchObject({
      runUuid: 'r-1',
      attrs: { agent: 'hi' },
    });
  });

  it('logs launchWarnings once per dispatch and still reaches startRun', async () => {
    const warned: BbAgent = {
      id: 'kimi',
      launchWarnings: ['effort is unsupported and ignored'],
      launchCommand: () => 'kimi',
      getRunLog: async () => '',
      parseFootprint: (log: string) => parseClaudeTranscript(log),
    };
    const remote = new FakeBbRemote({
      tickets: { 't-1': { identifier: 'BB-1', title: 'One', state: 'todo' } },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'todo',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    const { log, calls } = spyLogger();
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      new FakeWorkspace(),
      [{ id: 'kimi', alias: 'build', agent: warned }],
      log,
      CHECKOUT,
    );
    await conductor.start();
    await conductor.tick();

    const warningLogs = calls.filter(
      (c) =>
        c.level === 'info' &&
        typeof c.msg === 'string' &&
        c.msg.includes('effort is unsupported and ignored'),
    );
    expect(warningLogs).toHaveLength(1);
    expect(warningLogs[0]?.msg).toBe(
      'kimi/build: effort is unsupported and ignored',
    );
    expect(warningLogs[0]?.obj).toMatchObject({
      ticket: 'BB-1',
      run: 'r-1',
      harness: 'kimi',
      alias: 'build',
    });
    expect(executor.started).toHaveLength(1);
  });

  it('logs nothing extra when the selected agent has no launchWarnings', async () => {
    const remote = new FakeBbRemote({
      tickets: { 't-1': { identifier: 'BB-1', title: 'One', state: 'todo' } },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'todo',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    const { log, calls } = spyLogger();
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      new FakeWorkspace(),
      resolved(fakeAgent),
      log,
      CHECKOUT,
    );
    await conductor.start();
    await conductor.tick();

    expect(
      calls.some(
        (c) =>
          typeof c.msg === 'string' &&
          c.msg.includes('unsupported and ignored'),
      ),
    ).toBe(false);
    expect(executor.started).toHaveLength(1);
  });

  it('finalize routes footprint parsing by the persisted run.agent (BB-144)', async () => {
    const parsedBy: string[] = [];
    const mk = (id: string): BbAgent => ({
      id,
      launchCommand: () => id,
      getRunLog: async () => `log-${id}`,
      parseFootprint: (_log: string) => {
        parsedBy.push(id);
        return parseClaudeTranscript('');
      },
    });
    const agents: ResolvedAgent[] = [
      { id: 'first', agent: mk('first') },
      { id: 'second', agent: mk('second') },
    ];
    const remote = new FakeBbRemote({
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: '/wt/r-1',
          agent: 'second',
        },
        {
          runUuid: 'r-2',
          ticketUuid: 't-2',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: '/wt/r-2',
          // no agent id persisted → falls back to the first candidate.
        },
      ],
    });
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      new RecordingExecutor(),
      new FakeWorkspace(),
      agents,
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    // r-1 routed to 'second' (persisted); r-2 fell back to 'first'.
    expect(parsedBy).toEqual(['second', 'first']);
  });

  it('passes the run UUID as the agent run identity at dispatch and at finalize (BB-473)', async () => {
    // A fake agent that records exactly what identity it was called with, at
    // both launch and finalize — proving the SAME run.runUuid crosses both
    // call sites (the fix for the mtime-trap: agents can pin/select a
    // transcript by this id instead of scanning a directory by mtime).
    const launchedWith: (AgentRunIdentity | undefined)[] = [];
    const launchedIn: (string | undefined)[] = [];
    const readWith: (AgentRunIdentity | undefined)[] = [];
    const agent: BbAgent = {
      id: 'claude',
      launchCommand: (
        p: string,
        run?: AgentRunIdentity,
        workspacePath?: string,
      ) => {
        launchedWith.push(run);
        launchedIn.push(workspacePath);
        return p === '' ? 'claude' : `claude '${p}'`;
      },
      getRunLog: async (_worktreePath: string, run?: AgentRunIdentity) => {
        readWith.push(run);
        return '';
      },
      parseFootprint: (log: string) => parseClaudeTranscript(log),
    };
    const remote = new FakeBbRemote({
      tickets: { 't-1': { identifier: 'BB-1', title: 'One', state: 'todo' } },
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: '/wt/r-1',
          agent: 'claude',
        },
      ],
    });
    // The FakeBbRemote seed auto-queues every seeded run as claimable too
    // (used elsewhere to seed a run that is BOTH already-run and re-claimable)
    // — drop that auto-queued entry for the already-`done` r-1 so only the
    // freshly queued r-2 is dispatched this tick.
    remote.queue.length = 0;
    remote.queue.push({
      runUuid: 'r-2',
      runId: 2,
      ticketUuid: 't-1',
      stateAtStart: 'todo',
      handler: 'code',
    });
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      new RecordingExecutor(),
      new FakeWorkspace(),
      resolved(agent),
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    expect(launchedWith).toEqual([{ sessionId: 'r-2' }]);
    expect(launchedIn).toEqual(['/fake/BB-1']);
    expect(readWith).toEqual([
      { sessionId: 'r-1', attemptFamily: attemptFamily('r-1') },
    ]);
  });

  it('pins the next free attempt-family member on a re-dispatch whose transcript already exists (BB-473 review round 4, Critical 2)', async () => {
    // `claude --session-id <uuid>` refuses to start when that session
    // already exists. A re-dispatch of the SAME run (its own runUuid
    // therefore already names a transcript from the first attempt) must
    // still be able to launch the agent — this is the second-dispatch shape
    // the round-2 review found unpinned. Round 4's fix walks the run's
    // deterministic attempt family and pins the first member that is free,
    // instead of dropping the pin entirely (round 3's fix, which review
    // round 4 found selects a SIBLING run's transcript at finalise).
    const launchedWith: (AgentRunIdentity | undefined)[] = [];
    const agent: BbAgent = {
      id: 'claude',
      launchCommand: (p: string, run?: AgentRunIdentity) => {
        launchedWith.push(run);
        return p === '' ? 'claude' : `claude '${p}'`;
      },
      getRunLog: async () => '',
      parseFootprint: (log: string) => parseClaudeTranscript(log),
      sessionExists: async (_worktreePath: string, sessionId: string) =>
        sessionId === 're-dispatched-run',
    };
    const remote = new FakeBbRemote({
      tickets: { 't-1': { identifier: 'BB-1', title: 'One', state: 'todo' } },
    });
    remote.queue.length = 0;
    remote.queue.push({
      runUuid: 're-dispatched-run',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'todo',
      handler: 'code',
    });
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      new RecordingExecutor(),
      new FakeWorkspace(),
      resolved(agent),
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    // Attempt 0 ('re-dispatched-run' itself) already exists, so the
    // conductor pins the next family member instead — its own transcript can
    // never collide with attempt 1's.
    expect(launchedWith).toEqual([
      { sessionId: attemptSessionId('re-dispatched-run', 1) },
    ]);
  });

  it('round 5 (review round 4, Critical 2): TWO real dispatches of the SAME run finalise with attempt 2s transcript, not attempt 1s or a sibling', async () => {
    // The regression review round 4 asked for: extend the two-dispatch test
    // with a concurrently-written SIBLING transcript newer than the bound —
    // exactly the case round 3's `startedAt`-window fix got wrong (it can
    // select ANY newer file in the cwd-keyed directory, not only this run's
    // own). Round 4's fix pins/selects by the run's deterministic attempt
    // family instead, which nothing outside this run can collide with. Uses
    // the real `ClaudeAgent` against a real temp `$HOME` so the on-disk
    // selection logic is exercised for real, not re-implemented by a fake
    // agent.
    const home = mkdtempSync(join(tmpdir(), 'claude-home-'));
    const cwd = '/fake/BB-1';
    const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd));
    // `system`: nothing launches here, so the machine's sandbox must not gate claims.
    const agent = new ClaudeAgent({ permissions: 'system' }, home);

    class ClaudeLikeExecutor extends RecordingExecutor {
      async startRun(input: SpawnRunInput) {
        // A small real delay before the transcript write (mirroring the real
        // CLI actually spawning and writing).
        await new Promise((r) => setTimeout(r, 10));
        mkdirSync(dir, { recursive: true });
        const pinned = /--session-id (\S+)/.exec(input.command)?.[1];
        // Every dispatch this test drives IS pinned (attempt family always
        // has a free member); a real CLI honours the flag it is handed.
        const name = pinned ?? 'agent-minted-unpinned';
        writeFileSync(
          join(dir, `${name}.jsonl`),
          JSON.stringify({ marker: name }),
        );
        return super.startRun(input);
      }
    }

    const remote = new FakeBbRemote({
      tickets: { 't-1': { identifier: 'BB-1', title: 'One', state: 'todo' } },
      // Seeded (not merely queued) so `markRunning`/`markDone` below have a
      // run record to mutate — the auto-queued entry this seeding also
      // creates is attempt 1's dispatch.
      runs: [
        {
          runUuid: 're-dispatched-run',
          ticketUuid: 't-1',
          stateAtStart: 'todo',
          runLogStorageAllowed: true,
        },
      ],
    });
    const executor = new ClaudeLikeExecutor();
    const workspace = new FakeWorkspace();
    // A non-null `instructions` gives `launchCommand` a non-empty prompt —
    // with an empty one it returns the bare `claude` command, never pinning
    // `--session-id` regardless of `run`, so the identity guard this test
    // exercises would never be reached.
    workspace.ensure = async () => ({
      path: cwd,
      instructions: { path: `${cwd}/WORKFLOW.md`, sha256: 'abc', text: 'x' },
      created: true,
    });
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      workspace,
      resolved(agent),
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    // Attempt 1: sessionExists() is false for the run's own uuid (attempt 0
    // of its family) → pinned to it → real ClaudeAgent-shaped file written
    // under that name.
    await conductor.tick();
    expect(
      readFileSync(join(dir, 're-dispatched-run.jsonl'), 'utf8'),
    ).toContain('marker');

    // Re-dispatch the SAME run: the queue offers its uuid again — the shape
    // that made round 3's guard necessary in the first place.
    await new Promise((r) => setTimeout(r, 50));
    remote.queue.push({
      runUuid: 're-dispatched-run',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'todo',
      handler: 'code',
    });
    await conductor.tick();
    // Attempt 2 must have pinned the NEXT family member (attempt 0's file
    // already exists) and written its own, differently-named transcript.
    const attempt2Id = attemptSessionId('re-dispatched-run', 1);
    expect(readFileSync(join(dir, `${attempt2Id}.jsonl`), 'utf8')).toContain(
      'marker',
    );

    // A SIBLING session — a still-open tab in the same reused worktree,
    // belonging to a DIFFERENT run — is written into the same cwd-keyed
    // directory, newer than both attempts. Round 3's `startedAt` window
    // alone would happily select this file; the attempt family must not.
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(
      join(dir, 'sibling-run-session.jsonl'),
      JSON.stringify({ marker: 'sibling' }),
    );

    // Finalise: the run is now `done`. `getRunLog` must select attempt 2's
    // OWN transcript — identified by family membership, not by recency —
    // never attempt 1's and never the newer sibling.
    remote.markDone('re-dispatched-run');
    await conductor.tick();

    expect(remote.calls.finalizeRun).toHaveLength(1);
    const finalised = JSON.parse(remote.calls.finalizeRun[0]?.log ?? '{}');
    expect(finalised.marker).toBe(attempt2Id);
  });

  it('dispatch passes the expected env (incl. TICKET_URL) and the FakeWorkspace path', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'todo',
          url: 'https://issues/1',
        },
      },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'todo',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    const workspace = new FakeWorkspace();
    const conductor = await startedConductor(
      makeConfig(),
      remote,
      executor,
      workspace,
    );

    await conductor.tick();

    expect(executor.started).toHaveLength(1);
    const input = executor.started[0];
    expect(input?.workspacePath).toBe('/fake/BB-1');
    expect(input?.ticket.url).toBe('https://issues/1');
    // The conductor launches the run via the agent plugin's command. The
    // FakeWorkspace has no WORKFLOW.md (instructions === null) → bare command.
    expect(input?.command).toBe('claude');
    expect(input?.env).toEqual({
      BAKERS_URL: 'http://web',
      BAKERS_ID: 't-1',
      BAKERS_TICKET_IDENTIFIER: 'BB-1',
      BAKERS_STATE: 'todo',
      BAKERS_RUN_UUID: 'r-1',
      BAKERS_TUNNEL: '0',
      WORKSPACE_ROOT: CHECKOUT,
      TICKET_URL: 'https://issues/1',
    });
  });

  it('bases the worktree on origin/<baseBranch>', async () => {
    const ensureArgs: unknown[][] = [];
    class RecordingWorkspace extends FakeWorkspace {
      override async ensure(
        identifier: string,
        title?: string,
        baseRef?: string,
      ) {
        ensureArgs.push([identifier, title, baseRef]);
        return super.ensure(identifier, title, baseRef);
      }
    }
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'working',
          baseBranch: 'feat/p-1-parent',
        },
      },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'working',
      handler: 'code',
    });
    const conductor = await startedConductor(
      makeConfig(),
      remote,
      new RecordingExecutor(),
      new RecordingWorkspace(),
    );

    await conductor.tick();

    expect(ensureArgs[0]?.[2]).toBe('origin/feat/p-1-parent');
  });

  it('dispatch passes no baseRef when the ticket has no baseBranch', async () => {
    const ensureArgs: unknown[][] = [];
    class RecordingWorkspace extends FakeWorkspace {
      override async ensure(
        identifier: string,
        title?: string,
        baseRef?: string,
      ) {
        ensureArgs.push([identifier, title, baseRef]);
        return super.ensure(identifier, title, baseRef);
      }
    }
    const remote = new FakeBbRemote({
      tickets: { 't-1': { identifier: 'BB-1', title: 'One', state: 'todo' } },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'todo',
      handler: 'code',
    });
    const conductor = await startedConductor(
      makeConfig(),
      remote,
      new RecordingExecutor(),
      new RecordingWorkspace(),
    );

    await conductor.tick();

    expect(ensureArgs[0]?.[2]).toBeUndefined();
  });

  it('marks the run running with its worktree after dispatch', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'todo' },
      },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'todo',
      handler: 'code',
    });
    const conductor = await startedConductor(
      makeConfig(),
      remote,
      new RecordingExecutor(),
    );

    await conductor.tick();

    // FakeWorkspace.ensure('BB-1') → path '/fake/BB-1'.
    expect(remote.calls.markRunning).toHaveLength(1);
    expect(remote.calls.markRunning[0]).toMatchObject({
      runUuid: expect.any(String),
      attrs: { worktree_path: expect.any(String) },
    });
  });

  it('dispatch omits TICKET_URL when the ticket has no issueUrl', async () => {
    const remote = new FakeBbRemote({
      tickets: { 't-1': { identifier: 'BB-1', title: 'One', state: 'todo' } },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'todo',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    const conductor = await startedConductor(makeConfig(), remote, executor);

    await conductor.tick();

    expect(executor.started[0]?.env).not.toHaveProperty('TICKET_URL');
  });

  it('dispatch: unclassified ticket (state="") with WORKFLOW.md → qualification prompt + release instruction', async () => {
    const remote = new FakeBbRemote({
      tickets: { 't-1': { identifier: 'BB-1', title: 'One', state: '' } },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: '',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    // Workspace WITH instructions (simulates WORKFLOW.md present).
    const workspace = new FakeWorkspace();
    workspace.ensure = async (identifier: string) => ({
      path: `/fake/${identifier}`,
      instructions: 'WORKFLOW content',
    });
    const conductor = await startedConductor(
      makeConfig(),
      remote,
      executor,
      workspace,
    );

    await conductor.tick();

    expect(executor.started).toHaveLength(1);
    const command = executor.started[0]?.command ?? '';
    expect(command).toContain('current state: qualification');
    expect(command).toContain('./WORKFLOW.md');
    expect(command).toContain("that skill's qualification section");
    expect(command).not.toContain('ticket:run');
    expect(command).toContain('Do not start or prepare a later state');
    expect(command).not.toContain('bakers run release');
  });

  it('logs a start event with the conductor id', async () => {
    const remote = new FakeBbRemote();
    const { log, calls } = spyLogger();
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      new FakeExecutor({ outcome: 'exited' }),
      new FakeWorkspace(),
      resolved(fakeAgent),
      log,
      CHECKOUT,
    );
    await conductor.start();
    const started = calls.find((c) => c.msg === 'conductor started');
    expect(started).toBeDefined();
    expect(started?.level).toBe('info');
  });

  it('logs a dispatch event per claimed run', async () => {
    const seed: FakeRemoteSeed = {
      tickets: { 't-1': { identifier: 'BB-1', title: 'One', state: 'todo' } },
    };
    const remote = new FakeBbRemote(seed);
    const { log, calls } = spyLogger();
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      new FakeExecutor({ outcome: 'exited' }),
      new FakeWorkspace(),
      resolved({
        ...fakeAgent,
        launchCommand: (p: string) =>
          `claude ${shellQuote(p)} --dangerously-skip-permissions`,
      }),
      log,
      CHECKOUT,
    );
    await conductor.start();
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'todo',
      handler: 'code',
    });
    await conductor.tick();
    const dispatched = calls.find((c) => c.msg === 'dispatched run');
    expect(dispatched?.obj).toMatchObject({
      harness: 'claude',
      launch: "claude '<prompt>' --dangerously-skip-permissions",
    });
  });

  it('dispatch: classified ticket (state="plan") with WORKFLOW.md → state prompt + release instruction', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'plan' },
      },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'plan',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    // Workspace WITH instructions (simulates WORKFLOW.md present).
    const workspace = new FakeWorkspace();
    workspace.ensure = async (identifier: string) => ({
      path: `/fake/${identifier}`,
      instructions: 'WORKFLOW content',
    });
    const conductor = await startedConductor(
      makeConfig(),
      remote,
      executor,
      workspace,
    );

    await conductor.tick();

    expect(executor.started).toHaveLength(1);
    const command = executor.started[0]?.command ?? '';
    expect(command).toContain('current state: plan');
    expect(command).toContain('./WORKFLOW.md');
    expect(command).toContain("that skill's plan section");
    expect(command).not.toContain('ticket:run');
    expect(command).toContain('Do not start or prepare a later state');
    expect(command).not.toContain('bakers run release');
  });

  it('dispatch renders the configured prompt template with ticket, state, and run values', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'plan' },
      },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'plan',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    const workspace = new FakeWorkspace();
    workspace.ensure = async (identifier: string) => ({
      path: `/fake/${identifier}`,
      instructions: {
        path: `/fake/${identifier}/WORKFLOW.md`,
        sha256: 'abc',
        text: 'WORKFLOW content',
      },
    });
    const conductor = await startedConductor(
      makeConfig({
        prompt: 'Custom {identifier} {state} {run_uuid}',
      }),
      remote,
      executor,
      workspace,
    );

    await conductor.tick();

    const command = executor.started[0]?.command ?? '';
    expect(command).toContain('Custom BB-1 plan r-1');
  });

  it('dispatch uses the embed-free default prompt: step-0 read command, no ticket body/comments (BB-112)', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'working' },
      },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'working',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    const workspace = new FakeWorkspace();
    workspace.ensure = async (identifier: string) => ({
      path: `/fake/${identifier}`,
      instructions: 'WORKFLOW content',
    });
    const conductor = await startedConductor(
      makeConfig(),
      remote,
      executor,
      workspace,
    );

    await conductor.tick();

    const command = executor.started[0]?.command ?? '';
    // The agent self-reads the ticket + comments at step 0 — the dispatch line
    // embeds neither the ticket body nor any comment text, and stays bounded.
    expect(command).toContain(
      `bakers tools bakers_ticket_read --data '{"ticket":"t-1"}'`,
    );
    expect(command).not.toContain('--- Ticket comments ---');
    expect(command).not.toContain('{comments}');
  });

  it('dispatch failure: logs, marks the run failed with the error, and keeps claiming (BB-149)', async () => {
    // BB-149: a failed dispatch terminalises the run to `failed` with the
    // error captured in error_log, instead of leaving it `claimed` to expire
    // after the ~300s lease (the old silent stall). This is NOT the BB-41
    // runaway: `failed` is a terminal sibling of `expired` and does not reopen
    // the ticket the way a fabricated `done` did (no finalizeRun client-side).
    // The circuit breaker (server-side, TicketClaimService) then parks a
    // hot-looping ticket after the retry cap.
    const seed: FakeRemoteSeed = {
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'todo' },
        't-2': { identifier: 'BB-2', title: 'Two', state: 'todo' },
      },
    };
    const remote = new FakeBbRemote(seed);
    // Two claimable runs; dispatch throws for both.
    for (const i of [1, 2]) {
      remote.queue.push({
        runUuid: `r-${i}`,
        runId: i,
        ticketUuid: `t-${i}`,
        stateAtStart: 'todo',
        handler: 'code',
      });
    }
    const boom: BbExecutor = {
      id: 'boom',
      capabilities: () => ({ persistent: false }),
      startRun: async () => {
        throw new Error('startRun exploded');
      },
      stopRun: async () => {},
      cleanupRun: async () => {},
    };
    const { log, calls } = spyLogger();
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      boom,
      new FakeWorkspace(),
      resolved(fakeAgent),
      log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    // Both dispatch failures are logged — the loop keeps claiming past a failure.
    expect(
      calls.filter((c) => c.level === 'error' && c.msg === 'dispatch failed'),
    ).toHaveLength(2);
    // Each failed dispatch terminalises its run to `failed`, capturing the
    // dispatch exception message in error_log.
    expect(remote.calls.markFailed).toEqual([
      {
        runUuid: 'r-1',
        errorLog: expect.stringContaining('startRun exploded'),
      },
      {
        runUuid: 'r-2',
        errorLog: expect.stringContaining('startRun exploded'),
      },
    ]);
    // `failed` is terminal but NOT the BB-41 runaway: the conductor never
    // fabricates a `done` run.
    expect(remote.calls.finalizeRun).toEqual([]);
  });

  it('a startRun launch-watch failure marks the run failed with the exit reason', async () => {
    const seed: FakeRemoteSeed = {
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'todo' },
      },
    };
    const remote = new FakeBbRemote(seed);
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'todo',
      handler: 'code',
    });
    const boom: BbExecutor = {
      id: 'boom',
      capabilities: () => ({ persistent: false }),
      startRun: async () => {
        throw new Error(
          'Launch failed: exit 1\nError: Invalid session ID. Must be a valid UUID.',
        );
      },
      stopRun: async () => {},
      cleanupRun: async () => {},
    };
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      boom,
      new FakeWorkspace(),
      resolved(fakeAgent),
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();
    await conductor.tick();
    expect(remote.calls.markFailed).toEqual([
      {
        runUuid: 'r-1',
        errorLog: expect.stringContaining('Launch failed: exit 1'),
      },
    ]);
  });

  // --- finalisation into tick -----------------------------------------------

  function agentReturning(log: string): BbAgent {
    return { ...fakeAgent, getRunLog: async () => log };
  }

  it('tick finalises a done+unclosed run: reads transcript, writes log + closed', async () => {
    const remote = new FakeBbRemote({
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: '/wt/r-1',
          runLogStorageAllowed: true,
        },
      ],
    });
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      new RecordingExecutor(),
      new FakeWorkspace(),
      resolved(agentReturning('FINAL TRANSCRIPT')),
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    // An unparseable transcript yields an all-zero footprint (never throws);
    // no timestamped entries → duration_s 0 (BB-151).
    expect(remote.calls.finalizeRun).toEqual([
      {
        runUuid: 'r-1',
        log: 'FINAL TRANSCRIPT',
        metrics: {
          tokens: 0,
          duration_s: 0,
          agent_turns: 0,
          tool_calls: 0,
          user_prompts: 0,
          user_prompt_words: 0,
          active_s: 0,
          harness: 'claude',
        },
      },
    ]);
  });

  it('tick writes the parsed footprint metrics + transcript-derived duration_s at close', async () => {
    const remote = new FakeBbRemote({
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: '/wt/r-1',
        },
      ],
    });
    // A minimal Claude JSONL transcript: 1 user prompt (2 words), 1 assistant
    // turn with a tool_use and a 30-token usage breakdown. The first→last
    // entry timestamps span 100s → duration_s = 100 (BB-151, derived from the
    // log, not a re-read started_at).
    const transcript = [
      JSON.stringify({
        type: 'user',
        timestamp: '2026-07-16T15:29:48.000Z',
        message: { role: 'user', content: 'do it' },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-07-16T15:31:28.000Z',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-8',
          content: [
            { type: 'text', text: 'ok' },
            { type: 'tool_use', id: 't1', name: 'Read', input: {} },
          ],
          usage: { input_tokens: 10, output_tokens: 20 },
        },
      }),
    ].join('\n');
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      new RecordingExecutor(),
      new FakeWorkspace(),
      resolved(agentReturning(transcript)),
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    expect(remote.calls.finalizeRun).toHaveLength(1);
    const call = remote.calls.finalizeRun[0];
    expect(call.runUuid).toBe('r-1');
    expect(call.metrics).toMatchObject({
      tokens: 30,
      agent_turns: 1,
      tool_calls: 1,
      user_prompts: 1,
      user_prompt_words: 2,
    });
    // duration_s = transcript span (last − first timestamp) = 100s exactly.
    expect(call.metrics?.duration_s).toBe(100);
    // No human wait in the transcript: active time equals the span.
    expect(call.metrics?.active_s).toBe(100);
  });

  it('records the runtime that produced the footprint in the close write', async () => {
    const remote = new FakeBbRemote({
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: '/wt/r-1',
        },
      ],
    });
    // A candidate pinning a model, whose transcript names the exact version.
    const transcript = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-07-16T15:31:28.000Z',
      message: {
        role: 'assistant',
        model: 'claude-opus-4-5-20251101',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 10, output_tokens: 20 },
      },
    });
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      new RecordingExecutor(),
      new FakeWorkspace(),
      [
        {
          id: 'claude',
          model: 'claude-opus-5',
          agent: agentReturning(transcript),
        },
      ],
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    const call = remote.calls.finalizeRun[0];
    expect(call?.metrics).toMatchObject({
      harness: 'claude',
      model: 'claude-opus-5',
      model_version: 'claude-opus-4-5-20251101',
    });
  });

  it('uses the configured pin for both fields when the transcript names no model', async () => {
    const remote = new FakeBbRemote({
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: '/wt/r-1',
        },
      ],
    });
    // Both fields pinned, but the transcript names nothing to fall back to.
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      new RecordingExecutor(),
      new FakeWorkspace(),
      [
        {
          id: 'claude',
          model: 'claude-opus-5',
          modelVersion: 'claude-opus-4-5-20251101',
          agent: agentReturning(''),
        },
      ],
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    const call = remote.calls.finalizeRun[0];
    expect(call?.metrics).toMatchObject({
      harness: 'claude',
      model: 'claude-opus-5',
      model_version: 'claude-opus-4-5-20251101',
    });
  });

  it('omits a runtime attribute it cannot resolve rather than sending a placeholder', async () => {
    const remote = new FakeBbRemote({
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: '/wt/r-1',
        },
      ],
    });
    // No configured pin, and a transcript that names no model.
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      new RecordingExecutor(),
      new FakeWorkspace(),
      [{ id: 'codex', agent: agentReturning('') }],
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    const call = remote.calls.finalizeRun[0];
    // harness always resolves, so it is always sent.
    expect(call?.metrics).toMatchObject({ harness: 'codex' });
    // Neither can resolve to anything, real or placeholder: the transcript is
    // empty, so there is nothing to fall back to either.
    expect(call?.metrics).not.toHaveProperty('model');
    expect(call?.metrics).not.toHaveProperty('model_version');
  });

  it('falls back to the raw transcript model when the candidate pins none', async () => {
    const remote = new FakeBbRemote({
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: '/wt/r-1',
        },
      ],
    });
    // No configured pin, but the transcript names a model — the real model
    // that ran is a better answer than an empty column.
    const transcript = JSON.stringify({
      timestamp: '2026-07-16T15:31:28.000Z',
      type: 'turn_context',
      payload: { type: 'turn_context', model: 'gpt-5.6-sol' },
    });
    const codex: BbAgent = {
      id: 'codex',
      launchCommand: () => 'codex',
      getRunLog: async () => transcript,
      parseFootprint: parseCodexTranscript,
    };
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      new RecordingExecutor(),
      new FakeWorkspace(),
      [{ id: 'codex', agent: codex }],
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    const call = remote.calls.finalizeRun[0];
    // Raw and unsplit: the fallback never abbreviates or reshapes the id, which
    // is what keeps the column comparable across harnesses.
    expect(call?.metrics).toMatchObject({
      harness: 'codex',
      model: 'gpt-5.6-sol',
      model_version: 'gpt-5.6-sol',
    });
  });

  it('finalizes a Codex run with its transcript and non-zero footprint', async () => {
    const remote = new FakeBbRemote({
      runs: [
        {
          runUuid: 'codex-r-1',
          ticketUuid: 't-1',
          stateAtStart: 'working',
          state: 'done',
          worktreePath: '/wt/codex-r-1',
          agent: 'codex',
          runLogStorageAllowed: true,
        },
      ],
    });
    const transcript = [
      JSON.stringify({
        timestamp: '2026-07-18T10:00:00.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'implement the ticket' },
      }),
      JSON.stringify({
        timestamp: '2026-07-18T10:00:01.000Z',
        type: 'response_item',
        payload: { type: 'message', role: 'assistant' },
      }),
      JSON.stringify({
        timestamp: '2026-07-18T10:00:02.000Z',
        type: 'response_item',
        payload: { type: 'custom_tool_call', name: 'exec' },
      }),
      JSON.stringify({
        timestamp: '2026-07-18T10:00:03.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { total_token_usage: { total_tokens: 123 } },
        },
      }),
    ].join('\n');
    // Foreign transcript with a DIFFERENT footprint, newest by nothing in
    // particular — R3 (BB-473): the fake agent selects by the run's own
    // identity, not by returning whatever it is asked for unconditionally,
    // so this test would fail against code that dropped the sessionId on the
    // floor and asked for "the" transcript rather than "this run's".
    const foreignTranscript = [
      JSON.stringify({
        timestamp: '2026-07-18T09:00:00.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'unrelated' },
      }),
      JSON.stringify({
        timestamp: '2026-07-18T09:00:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { total_token_usage: { total_tokens: 999 } },
        },
      }),
    ].join('\n');
    const codex: BbAgent = {
      id: 'codex',
      launchCommand: () => 'codex',
      getRunLog: async (_worktreePath, run) =>
        run?.sessionId === 'codex-r-1' ? transcript : foreignTranscript,
      parseFootprint: parseCodexTranscript,
    };
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      new RecordingExecutor(),
      new FakeWorkspace(),
      resolved(codex),
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    expect(remote.calls.finalizeRun).toEqual([
      {
        runUuid: 'codex-r-1',
        log: transcript,
        metrics: {
          tokens: 123,
          duration_s: 3,
          agent_turns: 1,
          tool_calls: 1,
          user_prompts: 1,
          user_prompt_words: 3,
          active_s: 0,
          harness: 'codex',
        },
      },
    ]);
  });

  it('tick stops a cancelled run, keeps it cancelled and logs its state', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'working',
          branchName: 'bakers/bb-1-one',
        },
      },
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'working',
          state: 'cancelled',
          worktreePath: '/wt/r-1',
        },
      ],
    });
    const executor = new RecordingExecutor();
    executor.persistent = true;
    const { log, calls } = spyLogger();
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      new FakeWorkspace(),
      resolved(agentReturning('X')),
      log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    expect(executor.calls).toContainEqual({
      kind: 'cleanupRun',
      branch: 'bakers/bb-1-one',
      runId: 1,
    });
    expect(calls).toContainEqual(
      expect.objectContaining({
        level: 'info',
        msg: 'run finalised',
        obj: expect.objectContaining({ run: 'r-1', state: 'cancelled' }),
      }),
    );
    expect(remote.calls.markFailed).toEqual([]);
    expect(await remote.fetchFinalizableRuns('any')).toEqual([]);
  });

  it('tick signals stopRun then closes the run tab (cleanupRun) around finalising — persistent executor', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'done',
          branchName: 'bakers/bb-1-one',
        },
      },
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: '/wt/r-1',
          runLogStorageAllowed: true,
        },
      ],
    });
    const executor = new RecordingExecutor();
    executor.persistent = true;
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      new FakeWorkspace(),
      resolved(agentReturning('X')),
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    // stopRun (pre-capture) and cleanupRun (last step) both carry the run branch.
    expect(executor.calls).toContainEqual({
      kind: 'stopRun',
      branch: 'bakers/bb-1-one',
    });
    // Run-scoped (BB-183): cleanupRun carries the done run's own id (the
    // seeded 'r-1' is the first unseeded run → id 1), scoping the tab-close to
    // its `#<runId>` tab and sparing any sibling run tab.
    expect(executor.calls).toContainEqual({
      kind: 'cleanupRun',
      branch: 'bakers/bb-1-one',
      runId: 1,
    });
    // stopRun is issued before cleanupRun (BB-171 AC-3 — no /exit/C-c between).
    const stopIdx = executor.calls.findIndex((c) => c.kind === 'stopRun');
    const cleanupIdx = executor.calls.findIndex((c) => c.kind === 'cleanupRun');
    expect(stopIdx).toBeGreaterThanOrEqual(0);
    expect(cleanupIdx).toBeGreaterThan(stopIdx);
    expect(remote.calls.finalizeRun).toEqual([
      {
        runUuid: 'r-1',
        log: 'X',
        metrics: {
          tokens: 0,
          duration_s: 0,
          agent_turns: 0,
          tool_calls: 0,
          user_prompts: 0,
          user_prompt_words: 0,
          active_s: 0,
          harness: 'claude',
        },
      },
    ]);
  });

  it.runIf(process.platform === 'linux')(
    'ends processes left by the finalised run, and only those',
    async () => {
      const runUuid = randomUUID();
      const start = (uuid: string) => {
        const child = spawn('sleep', ['60'], {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, BAKERS_RUN_UUID: uuid },
        });
        child.unref();
        return child.pid as number;
      };
      const ours = start(runUuid);
      const theirs = start(randomUUID());
      try {
        const remote = new FakeBbRemote({
          tickets: {
            't-1': {
              identifier: 'BB-1',
              title: 'One',
              state: 'done',
              branchName: 'bakers/bb-1-one',
            },
          },
          runs: [
            {
              runUuid,
              ticketUuid: 't-1',
              stateAtStart: 'review',
              state: 'done',
              worktreePath: '/wt/r-1',
            },
          ],
        });
        const executor = new RecordingExecutor();
        executor.persistent = true;
        const conductor = new TestConductor(
          makeConfig(),
          remote,
          executor,
          new FakeWorkspace(),
          resolved(agentReturning('X')),
          spyLogger().log,
          CHECKOUT,
        );
        await conductor.start();
        await conductor.tick();
        await new Promise((r) => setTimeout(r, 200));
        expect(existsSync(`/proc/${ours}`)).toBe(false);
        expect(existsSync(`/proc/${theirs}`)).toBe(true);
      } finally {
        for (const pid of [ours, theirs]) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {}
        }
      }
    },
  );

  it('captures the run log before closing the tab (BB-171 AC-2)', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'done',
          branchName: 'bakers/bb-1-one',
        },
      },
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: '/wt/r-1',
        },
      ],
    });
    const executor = new RecordingExecutor();
    executor.persistent = true;
    // Snapshot at the FIRST tab close (the finalise one; the seeded run is
    // re-dispatched later in the same tick and closes its tab again): the
    // transcript must already be read before cleanupRun kills the PTY. The
    // durable close write follows the close, after `after_run` (BB-599).
    let transcriptRead = false;
    let capturedBeforeClose: boolean | undefined;
    executor.onCleanupRun = () => {
      capturedBeforeClose ??= transcriptRead;
    };
    const agent: BbAgent = {
      ...fakeAgent,
      getRunLog: async () => {
        transcriptRead = true;
        return 'X';
      },
    };
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      new FakeWorkspace(),
      resolved(agent),
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    expect(capturedBeforeClose).toBe(true);
    expect(remote.calls.finalizeRun.map((c) => c.runUuid)).toEqual(['r-1']);
  });

  it('finalises the run even when the tab cleanup throws (BB-171 AC-4)', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'done',
          branchName: 'bakers/bb-1-one',
        },
      },
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: '/wt/r-1',
        },
      ],
    });
    const executor = new RecordingExecutor();
    executor.persistent = true;
    executor.cleanupRunError = new Error('tab close boom');
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      new FakeWorkspace(),
      resolved(agentReturning('X')),
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    // The throwing cleanupRun must not abort finalisation.
    await expect(conductor.tick()).resolves.toBeUndefined();
    expect(remote.calls.finalizeRun.map((c) => c.runUuid)).toContain('r-1');
  });

  it('tick does not signal stopRun on the finalise path for a non-persistent executor, but still finalises', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'done',
          branchName: 'bakers/bb-1-one',
        },
      },
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: '/wt/r-1',
          runLogStorageAllowed: true,
        },
      ],
    });
    const executor = new RecordingExecutor(); // persistent = false
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      new FakeWorkspace(),
      resolved(agentReturning('X')),
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    // The finalise-path stop is persistent-gated → never issued here. (dispatch
    // may still call cleanupRun ungated, but that is a no-op for this executor.)
    expect(executor.calls.some((c) => c.kind === 'stopRun')).toBe(false);
    expect(remote.calls.finalizeRun).toEqual([
      {
        runUuid: 'r-1',
        log: 'X',
        metrics: {
          tokens: 0,
          duration_s: 0,
          agent_turns: 0,
          tool_calls: 0,
          user_prompts: 0,
          user_prompt_words: 0,
          active_s: 0,
          harness: 'claude',
        },
      },
    ]);
  });

  it('tick skips already-closed runs (one-shot)', async () => {
    const remote = new FakeBbRemote({
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: '/wt/r-1',
          closed: true,
        },
      ],
    });
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      new RecordingExecutor(),
      new FakeWorkspace(),
      resolved(agentReturning('X')),
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    expect(remote.calls.finalizeRun).toHaveLength(0);
  });

  it('after a successful omission-close the same run is not finalised again and another run still proceeds', async () => {
    const remote = new FakeBbRemote({
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: '/wt/r-1',
        },
        {
          runUuid: 'r-2',
          ticketUuid: 't-2',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: '/wt/r-2',
        },
      ],
    });
    // DrupalBbRemote swallows a recognized size rejection behind a
    // successful omission close; the conductor only sees finalizeRun success.
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      new RecordingExecutor(),
      new FakeWorkspace(),
      resolved(agentReturning('X')),
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();
    expect(remote.calls.finalizeRun.map((c) => c.runUuid)).toEqual([
      'r-1',
      'r-2',
    ]);

    await conductor.tick();
    expect(remote.calls.finalizeRun.map((c) => c.runUuid)).toEqual([
      'r-1',
      'r-2',
    ]);
  });

  // --- heartbeat keeps the conductor online (server-side self-heal) ---------

  it('tick heartbeats: an offline conductor is brought back online, never drains', async () => {
    const remote = new FakeBbRemote();
    remote.queue.length = 0;
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      new RecordingExecutor(),
      new FakeWorkspace(),
      resolved(fakeAgent),
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    // Even after being marked offline, a tick's heartbeat brings it back online
    // — status is binary and the tick has no drain-exit branch.
    await remote.setConductorStatus(conductor.id, 'offline');
    await expect(conductor.tick()).resolves.toBeUndefined();
    expect(await remote.getConductorStatus(conductor.id)).toBe('online');
  });

  it('dispatch retires stale tabs before opening the new one', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': { identifier: 'BB-123', title: 'One', state: 'todo' },
      },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'todo',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    const conductor = await startedConductor(makeConfig(), remote, executor);

    await conductor.tick();

    // cleanupRun clears a leftover tab for THIS run id (run-scoped, BB-183)
    // before startRun opens the dispatched run's tab.
    expect(executor.calls).toEqual([
      { kind: 'cleanupRun', branch: 'bakers/bb-123', runId: 1 },
      { kind: 'startRun', identifier: 'BB-123' },
    ]);
  });

  // --- ticket cleanup into tick ---------------------------------------------

  /** after_done invocations recorded on the executor (cwd), in call order. */
  function afterDoneCwds(executor: RecordingExecutor): string[] {
    return executor.hookCalls
      .filter((h) => h.name === 'after_done')
      .map((h) => h.cwd);
  }

  /** A conductor wired for the ticket-cleanup tests. */
  async function cleanupConductor(
    remote: FakeBbRemote,
    executor: RecordingExecutor,
    workspace: FakeWorkspace = new FakeWorkspace(),
    logger?: ConductorLogger,
  ): Promise<Conductor> {
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      workspace,
      resolved(fakeAgent),
      logger ?? spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();
    return conductor;
  }

  /**
   * A closed, not-yet-cleaned ticket seed with a run carrying its worktree
   * path.
   *
   * `closed: true` models what the server does on its own now (BB-451):
   * `BbTicket::preSave()` closes a terminal ticket on its own save, so the
   * conductor never sees an unclosed done/cancelled ticket — the reap work
   * list is closed-but-not-cleaned, full stop. The path defaults to a
   * directory that really exists ({@link PRESENT_WORKTREE}), because that is
   * what "a closed ticket whose worktree is still there" means on disk; pass
   * {@link ABSENT_WORKTREE} for the cases that model a worktree already gone.
   */
  function doneTicketSeed(
    worktreePath: string = PRESENT_WORKTREE,
  ): FakeRemoteSeed {
    return {
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'done',
          branchName: 'bakers/bb-1',
          closed: true,
        },
      },
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath,
          closed: true,
        },
      ],
    };
  }

  // Scenario 1 — a closed ticket removes the WHOLE workspace (not just the
  // tab) and marks the ticket cleaned_up. Closing itself is the server's
  // doing (BB-451); the conductor only ever reasons about `closed` and
  // `cleaned_up`.
  it('tick tears down a done ticket: after_done → removeWorktree → marks cleaned_up', async () => {
    const remote = new FakeBbRemote(doneTicketSeed());
    const executor = new RecordingExecutor();
    executor.persistent = true;
    const conductor = await cleanupConductor(remote, executor);

    await conductor.tick();

    // after_done runs THROUGH the executor (BB-84), in the worktree, before
    // the workspace teardown.
    expect(afterDoneCwds(executor)).toEqual([PRESENT_WORKTREE]);
    expect(
      executor.hookCalls.find((h) => h.name === 'after_done')?.ticket,
    ).toBe('t-1');
    // The whole workspace is torn down (removeWorktree), resolved by the
    // stable worktree path, not just the mutable branch.
    expect(executor.removeArgs).toEqual([
      { branch: 'bakers/bb-1', worktreePath: PRESENT_WORKTREE },
    ]);
    // Verified teardown → cleaned_up set (drops the ticket off the work list).
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
  });

  it('stops a done ticket’s provisioning before after_done, and all provisioning at stopTools', async () => {
    const remote = new FakeBbRemote(doneTicketSeed());
    const executor = new RecordingExecutor();
    const events: string[] = [];
    const runHook = executor.runHook.bind(executor);
    executor.runHook = async (name, ...rest) => {
      events.push(name);
      return runHook(name, ...rest);
    };
    const conductor = new TestConductor(
      makeConfig({
        provisioning: {
          stop: async (path) => {
            events.push(`stop ${path ?? 'all'}`);
          },
        },
      }),
      remote,
      executor,
      new FakeWorkspace(),
      resolved(fakeAgent),
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();
    await conductor.tick();
    expect(events.slice(0, 2)).toEqual([
      `stop ${PRESENT_WORKTREE}`,
      'after_done',
    ]);
    events.length = 0;
    await conductor.stopTools();
    expect(events).toEqual(['stop all']);
  });

  it('tick does not mark cleaned_up when teardown fails on a closed ticket (no withholding of anything else)', async () => {
    const remote = new FakeBbRemote(doneTicketSeed());
    const executor = new RecordingExecutor();
    executor.persistent = true;
    executor.removeWorktreeError = new Error('herdr hiccup');
    const conductor = await cleanupConductor(remote, executor);

    await conductor.tick();

    // cleaned_up is NOT set while the workspace still exists.
    expect(remote.calls.markCleanedUp).toEqual([]);
  });

  // Scenario 6 — a teardown miss is logged loudly and leaves cleaned_up unset,
  // so the ticket stays on the reconciliation work list for a retry (Scenario
  // 2: no permanent orphan).
  it('a teardown miss is logged loudly (ticket/branch/path) and does NOT mark cleaned_up', async () => {
    const remote = new FakeBbRemote(doneTicketSeed());
    const executor = new RecordingExecutor();
    executor.persistent = true;
    executor.removeWorktreeError = new Error(
      'herdr worktree remove failed for branch=bakers/bb-1 path=/wt/t-1',
    );
    const { log, calls } = spyLogger();
    const conductor = await cleanupConductor(
      remote,
      executor,
      new FakeWorkspace(),
      log,
    );

    await expect(conductor.tick()).resolves.toBeUndefined();

    const warn = calls.find(
      (c) => c.level === 'warn' && c.msg === 'worktree teardown failed',
    );
    expect(warn).toBeDefined();
    expect(warn?.obj).toMatchObject({
      ticket: 't-1',
      branch: 'bakers/bb-1',
      worktreePath: PRESENT_WORKTREE,
    });
    expect(remote.calls.markCleanedUp).toEqual([]);
    // It therefore stays on the reconciliation work list for a later retry.
    expect(
      (await remote.fetchUncleanedTickets(conductor.id)).map(
        (t) => t.ticketUuid,
      ),
    ).toEqual(['t-1']);
  });

  // Scenario 2 — a later reconciliation retries the removal until the workspace
  // is gone, only then marking cleaned_up.
  it('a later tick retries teardown and marks cleaned_up once the workspace is gone', async () => {
    const remote = new FakeBbRemote(doneTicketSeed());
    const executor = new RecordingExecutor();
    executor.persistent = true;
    executor.removeWorktreeError = new Error('transient herdr failure');
    const conductor = await cleanupConductor(remote, executor);

    // First tick: teardown fails → not cleaned.
    await conductor.tick();
    expect(remote.calls.markCleanedUp).toEqual([]);

    // The hiccup clears; the next tick retries and succeeds.
    executor.removeWorktreeError = null;
    await conductor.tick();

    expect(executor.removed).toEqual(['bakers/bb-1']);
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
  });

  it('tick marks cleaned_up only AFTER a successful teardown (order)', async () => {
    const remote = new FakeBbRemote(doneTicketSeed());
    const executor = new RecordingExecutor();
    executor.persistent = true;
    const conductor = await cleanupConductor(remote, executor);

    await conductor.tick();

    // removeWorktree must be recorded before cleaned_up is written.
    const removeIdx = executor.calls.findIndex(
      (c) => c.kind === 'removeWorktree',
    );
    expect(removeIdx).toBeGreaterThanOrEqual(0);
    expect(executor.removed).toEqual(['bakers/bb-1']);
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
  });

  it('tick skips after_done when the ticket has no worktree, but still tears down + marks cleaned_up', async () => {
    // A closed ticket with no run → no resolved worktree path.
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'done',
          branchName: 'bakers/bb-1',
          closed: true,
        },
      },
    });
    const executor = new RecordingExecutor();
    executor.persistent = true;
    const conductor = await cleanupConductor(remote, executor);

    await conductor.tick();

    expect(afterDoneCwds(executor)).toEqual([]);
    expect(executor.removed).toEqual(['bakers/bb-1']);
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
  });

  it('tick: a failing after_done hook is swallowed by the executor; teardown + cleaned_up still happen; core holds no per-call-site try/catch', async () => {
    const remote = new FakeBbRemote(doneTicketSeed());
    const executor = new RecordingExecutor();
    executor.persistent = true;
    // The real executor logs+swallows a failing hook; runHook never throws
    // (contract). The core awaits it with NO try/catch of its own — so even a
    // (here already-swallowed) hook failure never blocks teardown or cleanup.
    const conductor = await cleanupConductor(remote, executor);

    await expect(conductor.tick()).resolves.toBeUndefined();

    expect(afterDoneCwds(executor)).toEqual([PRESENT_WORKTREE]);
    expect(executor.removed).toEqual(['bakers/bb-1']);
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
  });

  it('tick tears down the worktree for a non-persistent executor too, then marks cleaned_up', async () => {
    const remote = new FakeBbRemote(doneTicketSeed());
    const executor = new RecordingExecutor(); // persistent = false
    const conductor = await cleanupConductor(remote, executor);

    await conductor.tick();

    // The workspace owns the worktree, whatever the executor: a non-persistent
    // executor on a git workspace still leaves one on disk, and it is removed.
    expect(afterDoneCwds(executor)).toEqual([PRESENT_WORKTREE]);
    expect(executor.removed).toEqual(['bakers/bb-1']);
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
  });

  // Scenario 5 — teardown is idempotent: an already-cleaned ticket is off the
  // work list, so a re-run does nothing (no re-teardown).
  it('tick skips an already-cleaned ticket (idempotent no-op)', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'done',
          branchName: 'bakers/bb-1',
          closed: true,
          cleanedUp: true,
        },
      },
    });
    const executor = new RecordingExecutor();
    executor.persistent = true;
    const conductor = await cleanupConductor(remote, executor);

    await conductor.tick();

    expect(afterDoneCwds(executor)).toEqual([]);
    expect(executor.removed).toEqual([]);
    expect(remote.calls.markCleanedUp).toEqual([]);
  });

  // --- reaper: standalone reconciliation (bakers oven clean) --------------
  // reap() is the SAME reconciliation the tick runs; called directly it recovers
  // this conductor's orphans a live tick never processed (conductor down at done
  // / restarted). DB-driven off the cleaned_up flag, scoped to this conductor
  // (BB-121) — no host scan.

  // Scenario 3 — a reaper (not necessarily mid-tick) tears down a closed
  // ticket the tick never processed.
  it('reap tears down a closed ticket the tick never processed, marks it cleaned_up', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'done',
          branchName: 'bakers/bb-1',
          closed: true,
        },
      },
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: PRESENT_WORKTREE,
          closed: true,
        },
      ],
    });
    const executor = new RecordingExecutor();
    executor.persistent = true;
    const conductor = await cleanupConductor(remote, executor);

    await conductor.reap();

    expect(executor.removeArgs).toEqual([
      { branch: 'bakers/bb-1', worktreePath: PRESENT_WORKTREE },
    ]);
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
  });

  it('reap tears down an already-closed ticket', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'done',
          branchName: 'bakers/bb-1',
          closed: true,
        },
      },
    });
    const executor = new RecordingExecutor();
    executor.persistent = true;
    const conductor = await cleanupConductor(remote, executor);

    await conductor.reap();

    expect(executor.removed).toEqual(['bakers/bb-1']);
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
  });

  // Scenario 4 — the reaper only ever acts on finished bakers tickets from the
  // DB; a foreign worktree (no bakers ticket) is never even enumerated, and an
  // active ticket is left alone.
  it('reap only touches closed bakers tickets; open tickets (and foreign worktrees, which have no ticket) are untouched', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'done',
          branchName: 'bakers/bb-1',
          closed: true,
        },
        't-2': {
          identifier: 'BB-2',
          title: 'Two',
          state: 'working',
          branchName: 'bakers/bb-2',
        },
      },
    });
    const executor = new RecordingExecutor();
    executor.persistent = true;
    const conductor = await cleanupConductor(remote, executor);

    await conductor.reap();

    // Only the closed ticket's worktree is torn down; the open one is left
    // alone, and a foreign worktree (no bakers ticket at all) is never listed —
    // the reaper is DB-driven, it never enumerates the host.
    expect(executor.removeArgs.map((a) => a.branch)).toEqual(['bakers/bb-1']);
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
  });

  it('reap winds up a closed ticket on a non-persistent executor: tears down the worktree, marks cleaned_up', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'done',
          branchName: 'bakers/bb-1',
          closed: true,
        },
      },
    });
    const executor = new RecordingExecutor(); // persistent = false
    const conductor = await cleanupConductor(remote, executor);

    await conductor.reap();

    expect(executor.removed).toEqual(['bakers/bb-1']);
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
  });

  it('reap does not mark cleaned_up when teardown fails (retried next reap)', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'done',
          branchName: 'bakers/bb-1',
          closed: true,
        },
      },
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: PRESENT_WORKTREE,
          closed: true,
        },
      ],
    });
    const executor = new RecordingExecutor();
    executor.persistent = true;
    executor.removeWorktreeError = new Error('transient herdr failure');
    const { log, calls } = spyLogger();
    const conductor = await cleanupConductor(
      remote,
      executor,
      new FakeWorkspace(),
      log,
    );

    await expect(conductor.reap()).resolves.toBeUndefined();

    expect(
      calls.some(
        (c) => c.level === 'warn' && c.msg === 'worktree teardown failed',
      ),
    ).toBe(true);
    expect(remote.calls.markCleanedUp).toEqual([]);
  });

  // BB-141 RC-2 — the reaper only flags cleaned_up on a VERIFIED teardown.
  // removeWorktree returning `true` means the worktree is gone on this host
  // (removed by us, or confirmed already absent): teardown verified → clean it.
  it('reap marks cleaned_up when teardown is verified (removeWorktree → true)', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'done',
          branchName: 'bakers/bb-1',
          closed: true,
        },
      },
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: PRESENT_WORKTREE,
          closed: true,
        },
      ],
    });
    const executor = new RecordingExecutor();
    executor.persistent = true;
    // Gone on this host (removed, or already absent) → verified teardown → true.
    executor.removeWorktreePresent = true;
    const conductor = await cleanupConductor(remote, executor);

    await conductor.reap();

    expect(executor.removeArgs).toEqual([
      { branch: 'bakers/bb-1', worktreePath: PRESENT_WORKTREE },
    ]);
    // Verified teardown → cleaned_up set (drops off the work list).
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
  });

  // BB-141 RC-2 — removeWorktree returning `false` means teardown was NOT
  // verified: the worktree could not be resolved and may still be on disk (e.g.
  // worktree_path was never persisted → the ~28 never-touched leftovers). The
  // reaper must NOT flag cleaned_up on an unverified teardown — else the ticket
  // drops off fetchUncleanedTickets and the orphan is never retried. It stays on
  // the work list for the next reconciliation; the close stays decoupled.
  it('reap does NOT mark cleaned_up when teardown is unverified (removeWorktree → false); ticket stays on the work list', async () => {
    const remote = new FakeBbRemote(doneTicketSeed());
    const executor = new RecordingExecutor();
    executor.persistent = true;
    executor.removeWorktreePresent = false; // unresolved — nothing verifiably torn down
    const { log, calls } = spyLogger();
    const conductor = await cleanupConductor(
      remote,
      executor,
      new FakeWorkspace(),
      log,
    );

    await conductor.reap();

    expect(executor.removeArgs).toEqual([
      { branch: 'bakers/bb-1', worktreePath: PRESENT_WORKTREE },
    ]);
    // Cleanup is withheld until teardown is verified.
    expect(remote.calls.markCleanedUp).toEqual([]);
    // So it stays on the reconciliation work list for a later retry.
    expect(
      (await remote.fetchUncleanedTickets(conductor.id)).map(
        (t) => t.ticketUuid,
      ),
    ).toEqual(['t-1']);
    // And the unverified teardown is logged loudly.
    expect(
      calls.some(
        (c) =>
          c.level === 'warn' &&
          c.msg === 'worktree teardown unverified — retrying next reap',
      ),
    ).toBe(true);
  });

  // BB-293 — an ALREADY-ABSENT worktree is a finished teardown, not a failure
  // to retry. It used to end as a swallowed catch plus a thrown EACCES, leaving
  // cleaned_up=0 so every later reap repeated the same failing teardown.
  it('an absent worktree is recorded on the run and marked cleaned_up (BB-293)', async () => {
    const remote = new FakeBbRemote(doneTicketSeed(ABSENT_WORKTREE));
    const executor = new RecordingExecutor();
    executor.persistent = true;
    executor.removeWorktreeOutcome = 'already_absent';
    const { log, calls: logCalls } = spyLogger();
    const conductor = await cleanupConductor(
      remote,
      executor,
      new FakeWorkspace(),
      log,
    );

    await conductor.reap();

    // AC 3 — recorded, in the conductor log...
    expect(
      logCalls.some(
        (c) =>
          c.level === 'info' &&
          c.msg === 'worktree already absent — teardown complete',
      ),
    ).toBe(true);
    // ...and on the run record itself, keyed on the run the path came from.
    expect(remote.calls.appendRunNote.map((c) => c.runUuid)).toEqual(['r-1']);
    expect(remote.runLog('r-1')).toContain('already absent');
    expect(remote.runLog('r-1')).toContain(ABSENT_WORKTREE);
    // AC 4 — the run is closed out: the ticket is flagged and drops off, so the
    // next reap does not retry it.
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
    expect(await remote.fetchUncleanedTickets(conductor.id)).toEqual([]);
    // The absence is NOT reported as an unverified teardown.
    expect(
      logCalls.some(
        (c) =>
          c.level === 'warn' &&
          c.msg === 'worktree teardown unverified — retrying next reap',
      ),
    ).toBe(false);
  });

  it('a failed run note never blocks the cleaned-up flag (BB-293)', async () => {
    const remote = new FakeBbRemote(doneTicketSeed(ABSENT_WORKTREE));
    remote.appendRunNote = async () => {
      throw new Error('control plane unreachable');
    };
    const executor = new RecordingExecutor();
    executor.persistent = true;
    executor.removeWorktreeOutcome = 'already_absent';
    const { log, calls: logCalls } = spyLogger();
    const conductor = await cleanupConductor(
      remote,
      executor,
      new FakeWorkspace(),
      log,
    );

    await conductor.reap();

    // Best-effort: an unreachable control plane must not keep a FINISHED
    // teardown from being flagged, or the ticket is retried forever over a
    // diagnostic note.
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
    expect(await remote.fetchUncleanedTickets(conductor.id)).toEqual([]);
    expect(
      logCalls.some(
        (c) => c.level === 'warn' && c.msg === 'run note write failed',
      ),
    ).toBe(true);
  });

  it('a ticket with no run is flagged without a note write (BB-293)', async () => {
    // No run means no record to note anything on; the teardown still completes.
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'done',
          branchName: 'bakers/bb-1',
          closed: true,
        },
      },
    });
    const executor = new RecordingExecutor();
    executor.persistent = true;
    executor.removeWorktreeOutcome = 'already_absent';
    const conductor = await cleanupConductor(remote, executor);

    await conductor.reap();

    expect(remote.calls.appendRunNote).toEqual([]);
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
  });

  // BB-293 AC 2, third clause — "no `exec failed` ERROR is logged for that
  // absence". The executor half of the criterion was already covered, but the
  // reaper reached the hook FIRST: `after_done` ran under `if (t.worktreePath)`
  // alone, and a hook is a shell spawned with the worktree as its `cwd`. Against
  // an absent directory that spawn fails with ENOENT before the probe is ever
  // consulted, and the shared exec helper logs it at ERROR — so a configured
  // hook (a project's engine config may delete its runtime project in `after_done`)
  // produced exactly the ERROR the criterion forbids.
  it('reap runs no after_done hook for a worktree that is absent on disk (BB-293)', async () => {
    const remote = new FakeBbRemote(doneTicketSeed(ABSENT_WORKTREE));
    const executor = new RecordingExecutor();
    executor.persistent = true;
    executor.removeWorktreeOutcome = 'already_absent';
    const { log, calls: logCalls } = spyLogger();
    const conductor = await cleanupConductor(
      remote,
      executor,
      new FakeWorkspace(),
      log,
    );

    await conductor.reap();

    // The hook is not invoked at all — no spawn, so nothing to fail.
    expect(afterDoneCwds(executor)).toEqual([]);
    // The absence is stated rather than passed over, because an `after_done`
    // can reach beyond the directory it runs in (deleting a container runtime's
    // project also drops its registration and database) and that leftover is then an
    // operator's to clear by hand.
    //
    // The exact wording is pinned deliberately. An `after_done` may be a
    // listener, a shell command or nothing at all — a message claiming one
    // was "skipped" is false wherever none is configured, which is the majority case and includes the generated
    // playground config this ticket's own runtime evidence ran against. Every
    // clause here must hold in BOTH configurations, so it reports the condition
    // (the directory is gone) and the consequence (no after_done ran), never a
    // decision about a hook the core cannot know about.
    const line = logCalls.find(
      (c) => c.msg === 'worktree directory absent — after_done not run',
    );
    expect(line?.level).toBe('info');
    expect(line?.obj).toMatchObject({
      ticket: 't-1',
      hook: 'after_done',
      worktreePath: ABSENT_WORKTREE,
    });
    // Nothing anywhere in the reap claims a hook was skipped.
    expect(logCalls.some((c) => /skipped/.test(c.msg ?? ''))).toBe(false);
    // ...and none of this holds the teardown back: the absence is still a
    // FINISHED teardown, recorded and flagged.
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
  });

  // The guard must be an existence check, not a blanket removal of the hook
  // call: a worktree that IS on disk still gets its after_done hook, in it.
  it('reap still runs after_done in a worktree that is present on disk (BB-293)', async () => {
    const remote = new FakeBbRemote(doneTicketSeed(PRESENT_WORKTREE));
    const executor = new RecordingExecutor();
    executor.persistent = true;
    const conductor = await cleanupConductor(remote, executor);

    await conductor.reap();

    expect(afterDoneCwds(executor)).toEqual([PRESENT_WORKTREE]);
    // ...and the teardown that follows is exactly the one a hookless reap does.
    expect(executor.removeArgs).toEqual([
      { branch: 'bakers/bb-1', worktreePath: PRESENT_WORKTREE },
    ]);
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
  });

  // BB-243 — a CANCELLED ticket is wound up like a done one. `cancel` reaches
  // every non-terminal state of every workflow, `working` and `review` included,
  // so a worktree certainly exists; before this it was never on the work list at
  // all and — unlike the unverified-teardown case — never retried either,
  // because a retry only happens for tickets that ARE on the list.
  //
  // Since BB-451 the reap needs no cancelled-specific branch at all: it
  // reasons about `closed`/`cleaned_up` alone, and the server closes a
  // cancelled ticket exactly like a done one on its own save
  // (BbTicket::preSave()). The conductor has no code path that writes
  // `state` here — it never had one for this flow — so a cancelled ticket
  // stays cancelled through teardown.

  /** A cancelled, closed ticket seed with a run carrying its worktree path. */
  function cancelledTicketSeed(): FakeRemoteSeed {
    return {
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'cancelled',
          branchName: 'bakers/bb-1',
          closed: true,
        },
      },
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          // Cancelled out of working — the realistic case, worktree present.
          stateAtStart: 'working',
          state: 'done',
          worktreePath: PRESENT_WORKTREE,
          closed: true,
        },
      ],
    };
  }

  describe('mr_changes', () => {
    const measure = vi.mocked(measureMrChanges);
    beforeEach(() => {
      measure.mockReset();
      measure.mockResolvedValue({
        score: 71,
        files_changed: 4,
        additions: 69,
        deletions: 2,
      });
    });

    /** A done ticket with an MR, a foreign metric row and a stale measurement. */
    function mrSeed(state = 'done', hasMr = true): FakeRemoteSeed {
      const seed = doneTicketSeed();
      Object.assign(seed.tickets?.['t-1'] ?? {}, {
        state,
        hasMr,
        baseBranch: 'develop',
        metrics: [
          {
            name: 'job_rating.score',
            value: '4.0000',
            unit: null,
            recorded: 1,
          },
          {
            name: 'mr_changes.score',
            value: '9.0000',
            unit: 'lines',
            recorded: 1,
          },
        ],
      });
      return seed;
    }

    it('reap records the merge request size of a done ticket before after_done', async () => {
      const seed = mrSeed();
      const remote = new FakeBbRemote(seed);
      const executor = new RecordingExecutor();
      executor.persistent = true;
      let hooksBefore = -1;
      measure.mockImplementation(async () => {
        hooksBefore = afterDoneCwds(executor).length;
        return { score: 71, files_changed: 4, additions: 69, deletions: 2 };
      });
      const conductor = await cleanupConductor(remote, executor);

      await conductor.reap();

      expect(measure).toHaveBeenCalledWith(PRESENT_WORKTREE, 'develop');
      expect(hooksBefore).toBe(0);
      const metrics = seed.tickets?.['t-1']?.metrics ?? [];
      expect(metrics.map((m) => [m.name, m.value])).toEqual([
        ['job_rating.score', '4.0000'],
        ['mr_changes.score', '71.0000'],
        ['mr_changes.files_changed', '4.0000'],
        ['mr_changes.additions', '69.0000'],
        ['mr_changes.deletions', '2.0000'],
      ]);
      expect(new Set(metrics.slice(1).map((m) => m.recorded)).size).toBe(1);
      expect(remote.calls.markCleanedUp).toEqual(['t-1']);
    });

    it('the measurement fetch shares the git lock with workspace.ensure', async () => {
      const seed = mrSeed();
      Object.assign(seed.tickets ?? {}, {
        't-2': { identifier: 'BB-2', title: 'Two', state: 'todo' },
      });
      const remote = new FakeBbRemote(seed);
      remote.queue.push({
        runUuid: 'r-2',
        runId: 2,
        ticketUuid: 't-2',
        stateAtStart: 'todo',
        handler: 'code',
      });
      let inFlight = 0;
      let max = 0;
      const track = async <T>(fn: () => Promise<T>): Promise<T> => {
        inFlight++;
        max = Math.max(max, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        try {
          return await fn();
        } finally {
          inFlight--;
        }
      };
      measure.mockImplementation(() =>
        track(async () => ({
          score: 71,
          files_changed: 4,
          additions: 69,
          deletions: 2,
        })),
      );
      const workspace = new FakeWorkspace();
      const ensure = workspace.ensure.bind(workspace);
      let ensured = 0;
      workspace.ensure = (...a) => {
        ensured++;
        return track(() => ensure(...a));
      };
      const conductor = await startedConductor(
        makeConfig(),
        remote,
        new RecordingExecutor(),
        workspace,
      );

      await conductor.tick();

      expect(ensured).toBeGreaterThan(0);
      expect(measure).toHaveBeenCalledOnce();
      expect(max).toBe(1);
    });

    it('reap measures nothing for a ticket without a merge request', async () => {
      const seed = mrSeed('done', false);
      const conductor = await cleanupConductor(
        new FakeBbRemote(seed),
        new RecordingExecutor(),
      );

      await conductor.reap();

      expect(measure).not.toHaveBeenCalled();
      expect(seed.tickets?.['t-1']?.metrics).toHaveLength(2);
    });

    it('reap logs why a done ticket with a merge request but no base branch is not measured', async () => {
      const seed = mrSeed();
      Object.assign(seed.tickets?.['t-1'] ?? {}, { baseBranch: '' });
      const spy = spyLogger();
      const conductor = await cleanupConductor(
        new FakeBbRemote(seed),
        new RecordingExecutor(),
        undefined,
        spy.log,
      );

      await conductor.reap();

      expect(measure).not.toHaveBeenCalled();
      expect(
        spy.calls.some(
          (c) => c.level === 'warn' && c.msg === 'mr_changes not recorded',
        ),
      ).toBe(true);
    });

    it('reap measures nothing for a cancelled ticket', async () => {
      const conductor = await cleanupConductor(
        new FakeBbRemote(mrSeed('cancelled')),
        new RecordingExecutor(),
      );

      await conductor.reap();

      expect(measure).not.toHaveBeenCalled();
    });

    it('a failed measurement is logged and the teardown still marks cleaned_up', async () => {
      measure.mockRejectedValue(new Error('fetch failed'));
      const seed = mrSeed();
      const remote = new FakeBbRemote(seed);
      const executor = new RecordingExecutor();
      executor.persistent = true;
      const spy = spyLogger();
      const conductor = await cleanupConductor(
        remote,
        executor,
        undefined,
        spy.log,
      );

      await conductor.reap();

      expect(
        spy.calls.some(
          (c) => c.level === 'warn' && c.msg === 'mr_changes not recorded',
        ),
      ).toBe(true);
      expect(seed.tickets?.['t-1']?.metrics?.[1]?.value).toBe('9.0000');
      expect(afterDoneCwds(executor)).toEqual([PRESENT_WORKTREE]);
      expect(remote.calls.markCleanedUp).toEqual(['t-1']);
    });
  });

  it('reap tears down a cancelled ticket and marks it cleaned_up', async () => {
    const remote = new FakeBbRemote(cancelledTicketSeed());
    const executor = new RecordingExecutor();
    executor.persistent = true;
    executor.removeWorktreePresent = true; // verified teardown
    const conductor = await cleanupConductor(remote, executor);

    await conductor.reap();

    expect(afterDoneCwds(executor)).toEqual([PRESENT_WORKTREE]);
    expect(executor.removeArgs).toEqual([
      { branch: 'bakers/bb-1', worktreePath: PRESENT_WORKTREE },
    ]);
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
  });

  it("reap does not touch a cancelled ticket's state", async () => {
    const remote = new FakeBbRemote(cancelledTicketSeed());
    const executor = new RecordingExecutor();
    executor.persistent = true;
    const conductor = await cleanupConductor(remote, executor);

    await conductor.reap();

    expect((await remote.getTicket('t-1')).state).toBe('cancelled');
  });

  it('reap does not dispatch a follow-on run for a cancelled ticket', async () => {
    const remote = new FakeBbRemote(cancelledTicketSeed());
    const executor = new RecordingExecutor();
    executor.persistent = true;
    const conductor = await cleanupConductor(remote, executor);

    await conductor.reap();

    // Reaping is wind-up, not work: no session is opened for the dead ticket.
    expect(executor.started).toEqual([]);
    expect(executor.calls.filter((c) => c.kind === 'startRun')).toEqual([]);
  });

  it('reap does NOT mark a cancelled ticket cleaned_up on an unverified teardown', async () => {
    const remote = new FakeBbRemote(cancelledTicketSeed());
    const executor = new RecordingExecutor();
    executor.persistent = true;
    executor.removeWorktreePresent = false; // unresolved — nothing verifiably gone
    const { log, calls } = spyLogger();
    const conductor = await cleanupConductor(
      remote,
      executor,
      new FakeWorkspace(),
      log,
    );

    await conductor.reap();

    // BB-141 RC-2 inherited unchanged: cleanup is withheld until verified...
    expect(remote.calls.markCleanedUp).toEqual([]);
    // ...and the ticket genuinely stays on the work list, so the next reap
    // retries it. This is the half that was impossible before: a cancelled
    // ticket was never on the list, so it was never retried.
    expect(
      (await remote.fetchUncleanedTickets(conductor.id)).map(
        (t) => t.ticketUuid,
      ),
    ).toEqual(['t-1']);
    expect(
      calls.some(
        (c) =>
          c.level === 'warn' &&
          c.msg === 'worktree teardown unverified — retrying next reap',
      ),
    ).toBe(true);
  });

  // BB-468 — a terminal ticket that NEVER had a run. `latestRun()` yields
  // `{runUuid: '', worktreePath: ''}`, so the reaper enters teardown with no
  // path; the executor can resolve nothing (no branch was ever created either)
  // and reports `unverified` by its own contract; the reaper then withholds
  // `cleaned_up` "so a later reap can finish the job". Neither precondition for
  // that later reap can ever become true — no run will appear on a terminal
  // ticket, and no branch will appear for work that never started — so the
  // retry is unreachable and the warning renews forever.
  function neverRanTicketSeed(): FakeRemoteSeed {
    return {
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'cancelled',
          branchName: 'bakers/bb-1',
          closed: true,
        },
      },
      runs: [], // never claimed → no run was ever created
    };
  }

  it('reap converges on a terminal ticket that never had a run (BB-468)', async () => {
    const remote = new FakeBbRemote(neverRanTicketSeed());
    const executor = new RecordingExecutor();
    executor.persistent = true;
    executor.removeWorktreePresent = false; // nothing resolvable — there never was one
    const { log, calls } = spyLogger();
    const conductor = await cleanupConductor(
      remote,
      executor,
      new FakeWorkspace(),
      log,
    );

    await conductor.reap();
    await conductor.reap(); // a second pass, exactly as a second tick would

    // AC-2: two consecutive passes produce at most ONE log line for the ticket.
    expect(
      calls.filter(
        (c) => c.msg === 'worktree teardown unverified — retrying next reap',
      ).length,
    ).toBeLessThanOrEqual(1);
    // The teardown is accounted for, so the ticket leaves the work list.
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
    expect(
      (await remote.fetchUncleanedTickets(conductor.id)).map(
        (t) => t.ticketUuid,
      ),
    ).toEqual([]);
  });

  it('reap does NOT mark a cancelled ticket cleaned_up when teardown throws', async () => {
    const remote = new FakeBbRemote(cancelledTicketSeed());
    const executor = new RecordingExecutor();
    executor.persistent = true;
    executor.removeWorktreeError = new Error('transient herdr failure');
    const { log, calls } = spyLogger();
    const conductor = await cleanupConductor(
      remote,
      executor,
      new FakeWorkspace(),
      log,
    );

    await expect(conductor.reap()).resolves.toBeUndefined();

    expect(
      calls.some(
        (c) => c.level === 'warn' && c.msg === 'worktree teardown failed',
      ),
    ).toBe(true);
    expect(remote.calls.markCleanedUp).toEqual([]);
    expect(
      (await remote.fetchUncleanedTickets(conductor.id)).map(
        (t) => t.ticketUuid,
      ),
    ).toEqual(['t-1']);
  });

  it('an already cleaned cancelled ticket is absent from the work list (reap is a no-op)', async () => {
    const seed = cancelledTicketSeed();
    const tickets = seed.tickets ?? {};
    const ticket = tickets['t-1'];
    if (ticket) ticket.cleanedUp = true;
    const remote = new FakeBbRemote(seed);
    const executor = new RecordingExecutor();
    executor.persistent = true;
    const conductor = await cleanupConductor(remote, executor);

    expect(await remote.fetchUncleanedTickets(conductor.id)).toEqual([]);

    await conductor.reap();

    // Idempotent: nothing torn down, nothing re-flagged.
    expect(executor.hookCalls).toEqual([]);
    expect(executor.removeArgs).toEqual([]);
    expect(remote.calls.markCleanedUp).toEqual([]);
  });

  it('a cancelled ticket of a FOREIGN conductor is never reaped', async () => {
    const seed = cancelledTicketSeed();
    const tickets = seed.tickets ?? {};
    const ticket = tickets['t-1'];
    if (ticket) ticket.conductorId = 'someone-else';
    const remote = new FakeBbRemote(seed);
    const executor = new RecordingExecutor();
    executor.persistent = true;
    const conductor = await cleanupConductor(remote, executor);

    // BB-121 scoping is unchanged by the widening: another conductor's
    // cancelled ticket is none of this reaper's business, and reaping it would
    // tear down a worktree on a host that does not own it.
    expect(await remote.fetchUncleanedTickets(conductor.id)).toEqual([]);

    await conductor.reap();

    expect(executor.removeArgs).toEqual([]);
    expect(remote.calls.markCleanedUp).toEqual([]);
    expect((await remote.getTicket('t-1')).state).toBe('cancelled');
  });

  // BB-121 — AC-1: the uncleaned-ticket work list is scoped to this conductor.
  // Tickets assigned to another conductor, or unassigned, are never loaded.
  it('fetchUncleanedTickets returns only tickets assigned to the querying conductor', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'done',
          branchName: 'bakers/bb-1',
          closed: true,
          conductorId: 'conductor-A',
        },
        't-2': {
          identifier: 'BB-2',
          title: 'Two',
          state: 'done',
          branchName: 'bakers/bb-2',
          closed: true,
          conductorId: 'conductor-B',
        },
        't-3': {
          identifier: 'BB-3',
          title: 'Three',
          state: 'done',
          branchName: 'bakers/bb-3',
          closed: true,
          conductorId: '', // unassigned
        },
      },
    });

    const list = await remote.fetchUncleanedTickets('conductor-A');

    expect(list.map((t) => t.ticketUuid)).toEqual(['t-1']);
  });

  // --- dispatch routes hooks through the executor (BB-84) -----------------

  it('dispatch runs after_create (fresh worktree) then before_run through the executor, then startRun', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'working' },
      },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'working',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    // FakeWorkspace returns created=true (fresh) + instructions=null.
    const conductor = await startedConductor(makeConfig(), remote, executor);

    await conductor.tick();

    // Both lifecycle hooks ran through the executor, in the worktree, with the
    // ticket identifier as context — after_create before before_run.
    expect(executor.hookCalls).toEqual([
      { name: 'after_create', cwd: '/fake/BB-1', ticket: 'BB-1' },
      { name: 'before_run', cwd: '/fake/BB-1', ticket: 'BB-1' },
    ]);
    // ...and the run still started (a hook cannot wedge dispatch).
    expect(executor.started.map((s) => s.run.uuid)).toEqual(['r-1']);
  });

  // BB-237 resolved the contradiction that diagnose left standing here: the
  // former case 'dispatch skips after_create when the worktree is reused
  // (created=false)' pinned the creation-gated policy that IS defect 2, so it
  // was deleted rather than narrowed. It cannot be narrowed to "an
  // already-provisioned worktree is not re-provisioned", because the conductor
  // deliberately does not know what "provisioned" means for a project (that
  // would mean teaching core the bakers-specific sentinel path). Cheapness of the
  // repeat is owned by the hook's own sentinel and pinned in
  // `worktree-bootstrap.test.ts` ("a cheap no-op on a second run").

  // --- BB-237: provisioning is convergent, not creation-gated -------------

  it('dispatch runs after_create on an EXISTING but unprovisioned worktree (created=false)', async () => {
    // BB-237 AC-5. `created` answers "was this worktree born just now?", which
    // is NOT the question dispatch needs answered: a worktree whose bootstrap
    // aborted (the BB-237 bootstrap-hook abort), an aborted earlier
    // run, or a manual `git worktree add` all exist WITHOUT being provisioned,
    // and the creation gate means they never get another chance. Provisioning
    // must be driven by whether the worktree IS provisioned; the bootstrap
    // hook's own sentinel keeps the repeat cheap (AC-3), so re-running it is the
    // convergent — and safe — behaviour.
    const remote = new FakeBbRemote({
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'working' },
      },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'working',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    const workspace = new FakeWorkspace();
    workspace.ensure = async (identifier: string) => ({
      path: `/fake/${identifier}`,
      instructions: null,
      created: false, // exists, but nothing says it is provisioned
    });
    const conductor = await startedConductor(
      makeConfig(),
      remote,
      executor,
      workspace,
    );

    await conductor.tick();

    expect(executor.hookCalls).toEqual([
      { name: 'after_create', cwd: '/fake/BB-1', ticket: 'BB-1' },
      { name: 'before_run', cwd: '/fake/BB-1', ticket: 'BB-1' },
    ]);
    expect(executor.started).toHaveLength(1);
  });

  it('dispatch records a failing provisioning hook against the run and still starts it', async () => {
    // BB-237 AC-6. An agent must never be dispatched into a worktree whose
    // bootstrap failed WITHOUT that being visible. Dispatch is not withheld —
    // `runHook`'s never-throw contract exists precisely so a hook cannot wedge a
    // run, and withholding would re-introduce that wedge. Instead the conductor
    // records the failure against the run (ticket + run + hook + worktree +
    // err), so it is visible and — since BB-237 also made the TTY sink tee to
    // log.txt — durable. Boundedness stays with the existing circuit breaker.
    const remote = new FakeBbRemote({
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'working' },
      },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'working',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    executor.failingHooks.add('after_create');
    const { log, calls } = spyLogger();
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      new FakeWorkspace(),
      resolved(fakeAgent),
      log,
      CHECKOUT,
    );
    await conductor.start();

    await expect(conductor.tick()).resolves.toBeUndefined();

    const recorded = calls.filter(
      (c) => c.level === 'error' && c.msg === 'lifecycle hook failed',
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.obj).toMatchObject({
      hook: 'after_create',
      ticket: 'BB-1',
      run: 'r-1',
      workspace: '/fake/BB-1',
    });
    expect(
      String((recorded[0]?.obj as { err?: unknown } | undefined)?.err),
    ).toContain('after_create boom');
    // ...and the run still started: a hook cannot wedge dispatch.
    expect(executor.started.map((s) => s.run.uuid)).toEqual(['r-1']);
  });

  // --- BB-237: the open layout is applied AFTER after_create -------------

  /**
   * Drives dispatch with one shared ordering log across the hooks and the
   * executor, so the cross-object sequence can be asserted as one list.
   */
  async function dispatchRecordingOrder(created: boolean): Promise<string[]> {
    const order: string[] = [];
    const remote = new FakeBbRemote({
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'working' },
      },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'working',
      handler: 'code',
    });
    class OrderedExecutor extends RecordingExecutor {
      override async runHook(
        name: HookName,
        cwd: string,
        ctx: HookContext,
      ): Promise<HookResult> {
        order.push(name);
        return super.runHook(name, cwd, ctx);
      }
      override async cleanupRun(branch: string, runId: number): Promise<void> {
        order.push('cleanupRun');
        return super.cleanupRun(branch, runId);
      }
      override async startRun(input: SpawnRunInput) {
        order.push('startRun');
        return super.startRun(input);
      }
      async openWorkspace(): Promise<void> {
        order.push('openWorkspace');
      }
    }
    const workspace = new FakeWorkspace();
    workspace.ensure = async (identifier: string) => ({
      path: `/fake/${identifier}`,
      instructions: null,
      created,
    });
    const conductor = await startedConductor(
      makeConfig(),
      remote,
      new OrderedExecutor(),
      workspace,
    );

    await conductor.tick();
    return order;
  }

  it('dispatch opens the workspace in the executor AFTER after_create and BEFORE before_run', async () => {
    // BB-237. The `bakers ui` pane command names a binary that the
    // `after_create` hook builds. While the layout was applied inside
    // `workspace.ensure()` it necessarily fired BEFORE that hook — two
    // processes with no shared ordering — and the only remedy available was a
    // sentinel wait loop inside the pane command itself. Fixing the ordering
    // removes the need for any cross-process handshake, so this exact sequence
    // is the contract and must stay pinned.
    expect(await dispatchRecordingOrder(true)).toEqual([
      'after_create',
      'openWorkspace',
      'before_run',
      'cleanupRun',
      'startRun',
    ]);
  });

  it('dispatch skips openWorkspace on a reused worktree but STILL runs after_create', async () => {
    // BB-237: the two gates deliberately DIFFER, and the difference is load
    // bearing — do not "simplify" them back into one.
    //   after_create   → convergent, runs always (AC-5): a worktree can exist
    //                    without ever having been provisioned.
    //   openWorkspace  → creation-gated: only a FRESH create has a root pane
    //                    to lay out, and re-applying on reuse would start a
    //                    duplicate editor process on every reattach.
    expect(await dispatchRecordingOrder(false)).toEqual([
      'after_create',
      'before_run',
      'cleanupRun',
      'startRun',
    ]);
  });

  // --- after_create runs until it has succeeded once per worktree ----------
  // Every workflow step is a new dispatch. Re-running a bootstrap that already
  // succeeded is not convergence but repetition; only a worktree with no
  // recorded successful after_create (fresh, aborted, or hand-made) gets it.

  /** Dispatches one run of BB-1 into `path` on a NEW conductor process. */
  async function dispatchOnce(
    path: string,
    runUuid: string,
    created: boolean,
    executor: RecordingExecutor,
  ): Promise<void> {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'working' },
      },
    });
    remote.queue.push({
      runUuid,
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'working',
      handler: 'code',
    });
    const workspace = new FakeWorkspace();
    workspace.ensure = async () => ({ path, instructions: null, created });
    const conductor = await startedConductor(
      makeConfig(),
      remote,
      executor,
      workspace,
    );
    await conductor.tick();
  }

  it('a later dispatch into a worktree whose after_create succeeded does not run it again', async () => {
    const path = mkdtempSync(join(tmpdir(), 'bakers-bootstrapped-'));
    const executor = new RecordingExecutor();
    try {
      await dispatchOnce(path, 'r-diagnose', true, executor);
      await dispatchOnce(path, 'r-coding', false, executor);

      expect(
        executor.hookCalls.filter((h) => h.name === 'after_create'),
      ).toHaveLength(1);
      expect(executor.started).toHaveLength(2);
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it('a later dispatch re-runs after_create when the previous one failed', async () => {
    const path = mkdtempSync(join(tmpdir(), 'bakers-bootstrap-failed-'));
    const executor = new RecordingExecutor();
    executor.failingHooks.add('after_create');
    try {
      await dispatchOnce(path, 'r-diagnose', true, executor);
      executor.failingHooks.delete('after_create');
      await dispatchOnce(path, 'r-coding', false, executor);

      expect(
        executor.hookCalls.filter((h) => h.name === 'after_create'),
      ).toHaveLength(2);
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it('a worktree recreated at the same path re-runs after_create despite an existing record', async () => {
    const path = mkdtempSync(join(tmpdir(), 'bakers-bootstrap-recreated-'));
    const executor = new RecordingExecutor();
    try {
      await dispatchOnce(path, 'r-diagnose', true, executor);
      // `created=true` again: a stale record never wins over a fresh create.
      await dispatchOnce(path, 'r-coding', true, executor);

      expect(
        executor.hookCalls.filter((h) => h.name === 'after_create'),
      ).toHaveLength(2);
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it('a worktree reopened after reap tears down its after_done hook re-runs after_create (review F2)', async () => {
    // The worktree directory itself survives teardown (non-persistent
    // executor, exactly like 'reap winds up a closed ticket on a
    // non-persistent executor' above) — only its bootstrap record must not.
    const path = mkdtempSync(join(tmpdir(), 'bakers-bootstrap-reaped-'));
    const executor = new RecordingExecutor();
    try {
      await dispatchOnce(path, 'r-diagnose', true, executor);
      expect(
        executor.hookCalls.filter((h) => h.name === 'after_create'),
      ).toHaveLength(1);

      const remote = new FakeBbRemote({
        tickets: {
          't-1': {
            identifier: 'BB-1',
            title: 'One',
            state: 'done',
            branchName: 'bakers/bb-1',
            closed: true,
          },
        },
        runs: [
          {
            runUuid: 'r-diagnose',
            ticketUuid: 't-1',
            stateAtStart: 'review',
            state: 'done',
            worktreePath: path,
            closed: true,
          },
        ],
      });
      const conductor = new TestConductor(
        makeConfig(),
        remote,
        executor,
        new FakeWorkspace(),
        resolved(fakeAgent),
        spyLogger().log,
        CHECKOUT,
      );
      await conductor.start();
      await conductor.reap();

      // The ticket is reopened (e.g. back to `working`) and dispatched into
      // the SAME surviving worktree, which `after_done` tore down.
      await dispatchOnce(path, 'r-reopened', false, executor);

      expect(
        executor.hookCalls.filter((h) => h.name === 'after_create'),
      ).toHaveLength(2);
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });

  // --- missing WORKFLOW.md warns and proceeds (BB-84) ---------------------

  it('dispatch warns (naming ticket + workspace) when WORKFLOW.md is missing, but still starts the run', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'working' },
      },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'working',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    // FakeWorkspace → instructions=null → no WORKFLOW.md.
    const { log, calls } = spyLogger();
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      new FakeWorkspace(),
      resolved(fakeAgent),
      log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    const warn = calls.find(
      (c) => c.level === 'warn' && String(c.msg).includes('WORKFLOW.md'),
    );
    expect(warn).toBeDefined();
    expect(warn?.obj).toMatchObject({
      ticket: 'BB-1',
      workspace: '/fake/BB-1',
    });
    expect(warn?.msg).toContain(
      'WORKFLOW.md missing — no project instructions dispatched',
    );
    // Nothing is blocked — the run still starts without project instructions.
    expect(executor.started).toHaveLength(1);
  });

  it('dispatch does not warn about WORKFLOW.md when it is present', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'working' },
      },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'working',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    const workspace = new FakeWorkspace();
    workspace.ensure = async (identifier: string) => ({
      path: `/fake/${identifier}`,
      instructions: {
        path: `/fake/${identifier}/WORKFLOW.md`,
        sha256: 'abc',
        text: 'WORKFLOW content',
      },
      created: true,
    });
    const { log, calls } = spyLogger();
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      workspace,
      resolved(fakeAgent),
      log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();

    expect(
      calls.some(
        (c) => c.level === 'warn' && String(c.msg).includes('WORKFLOW.md'),
      ),
    ).toBe(false);
  });
});

// BB-204 (supersedes BB-182's routing-ownership contract; preserves BB-196's
// qualification-guard Scenarios): everything is a skill and WORKFLOW.md is a pure
// loader. Ordering + stop/continue routing now live in each step-owning skill, so the
// guard's Scenarios are asserted against those skills, and WORKFLOW.md is asserted to
// be a pure loader (no state sections).
describe('Conductor — addon lifecycle hook listeners', () => {
  const SECRET = 'SECRET-SENTINEL-599';

  /** Records shell hooks, launches and worker cleanup into one event list. */
  class EventExecutor extends RecordingExecutor {
    readonly shellEnv: Partial<
      Record<HookName, Record<string, string> | undefined>
    > = {};
    readonly shellTicket: Partial<Record<HookName, string>> = {};
    startError: Error | null = null;
    constructor(readonly events: string[]) {
      super();
    }
    override async runHook(
      name: HookName,
      cwd: string,
      ctx: HookContext,
      env?: Record<string, string>,
    ): Promise<HookResult> {
      this.events.push(`shell:${name}`);
      this.shellEnv[name] = env ? { ...env } : undefined;
      this.shellTicket[name] = ctx.ticket;
      return super.runHook(name, cwd, ctx);
    }
    override async startRun(input: SpawnRunInput) {
      this.events.push('start');
      if (this.startError) throw this.startError;
      return super.startRun(input);
    }
    override async stopRun(branch: string) {
      this.events.push('stop');
      return super.stopRun(branch);
    }
    override async cleanupRun(branch: string, runId: number) {
      this.events.push(`tab:${runId}`);
      return super.cleanupRun(branch, runId);
    }
  }

  /** A listener that records every slot it sees as `<id>:<slot>`. */
  function recorder(
    id: string,
    events: string[],
    seen: Array<{ id: string; slot: HookName; ctx: HookListenerContext }> = [],
  ): HookListener {
    const on =
      (slot: HookName) =>
      async (ctx: HookListenerContext): Promise<void> => {
        events.push(`${id}:${slot}`);
        seen.push({ id, slot, ctx: { ...ctx, env: { ...ctx.env } } });
      };
    return {
      id,
      after_create: on('after_create'),
      before_run: on('before_run'),
      after_run: on('after_run'),
      after_done: on('after_done'),
    };
  }

  function dispatchRemote(): FakeBbRemote {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'working',
          effectiveEnvVars: `DB_PASSWORD=${SECRET}`,
        },
        't-2': { identifier: 'BB-2', title: 'Two', state: 'working' },
      },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'working',
      handler: 'code',
    });
    return remote;
  }

  async function conductorWith(
    listeners: HookListener[],
    remote: FakeBbRemote,
    executor: BbExecutor,
    log: ConductorLogger = spyLogger().log,
  ): Promise<Conductor> {
    const conductor = new TestConductor(
      makeConfig({ hookListeners: listeners }),
      remote,
      executor,
      new FakeWorkspace(),
      resolved(fakeAgent),
      log,
      CHECKOUT,
    );
    await conductor.start();
    return conductor;
  }

  it('runs addon listeners in order before each shell hook, and the added env reaches startRun', async () => {
    const events: string[] = [];
    const seen: Array<{
      id: string;
      slot: HookName;
      ctx: HookListenerContext;
    }> = [];
    const adder: HookListener = {
      id: 'adder',
      before_run: async (ctx) => {
        await Promise.resolve();
        events.push('adder:before_run');
        ctx.env.HOOK_TEST_VALUE = 'ready';
      },
    };
    const executor = new EventExecutor(events);
    const conductor = await conductorWith(
      [recorder('A', events, seen), adder, recorder('B', events, seen)],
      dispatchRemote(),
      executor,
    );

    await conductor.tick();

    expect(events).toEqual([
      'A:after_create',
      'B:after_create',
      'shell:after_create',
      'A:before_run',
      'adder:before_run',
      'B:before_run',
      'shell:before_run',
      'tab:1',
      'start',
    ]);
    // The listener after the adder, the shell hook and the launch all see it.
    const bBefore = seen.find((s) => s.id === 'B' && s.slot === 'before_run');
    expect(bBefore?.ctx.env.HOOK_TEST_VALUE).toBe('ready');
    expect(executor.shellEnv.before_run?.HOOK_TEST_VALUE).toBe('ready');
    expect(executor.started[0]?.env?.HOOK_TEST_VALUE).toBe('ready');
    // Run-scoped context: the claimed run, its start state, the resolved ticket.
    expect(bBefore?.ctx).toMatchObject({
      worktreePath: '/fake/BB-1',
      state: 'working',
      run: { uuid: 'r-1', id: 1 },
      ticket: { uuid: 't-1', identifier: 'BB-1' },
    });
    expect(bBefore?.ctx.env.BAKERS_RUN_UUID).toBe('r-1');
  });

  it('keeps conductor-owned env keys and drops invalid mutations, logging key names only', async () => {
    const executor = new EventExecutor([]);
    const { log, calls } = spyLogger();
    const vandal: HookListener = {
      id: 'vandal',
      before_run: (ctx) => {
        ctx.env.BAKERS_ID = 'hijacked';
        ctx.env.BB_EXTRA = 'reserved';
        delete ctx.env.WORKSPACE_ROOT;
        ctx.env['bad-key'] = 'x';
        (ctx.env as Record<string, unknown>).NUMERIC = 5;
        ctx.env.OK_KEY = 'fine';
      },
    };
    const conductor = await conductorWith(
      [vandal],
      dispatchRemote(),
      executor,
      log,
    );

    await conductor.tick();

    const env = executor.started[0]?.env ?? {};
    expect(env.BAKERS_ID).toBe('t-1');
    expect(env.WORKSPACE_ROOT).toBe(CHECKOUT);
    expect(env.OK_KEY).toBe('fine');
    expect(env.DB_PASSWORD).toBe(SECRET);
    for (const key of ['BB_EXTRA', 'bad-key', 'NUMERIC'])
      expect(env).not.toHaveProperty(key);
    const rejected = calls.find(
      (c) => c.msg === 'hook listener env change rejected',
    );
    expect(rejected?.obj).toMatchObject({
      hook: 'before_run',
      listener: 'vandal',
    });
    expect(
      [
        ...((rejected?.obj as { keys?: string[] } | undefined)?.keys ?? []),
      ].sort(),
    ).toEqual(
      ['BB_EXTRA', 'BAKERS_ID', 'NUMERIC', 'WORKSPACE_ROOT', 'bad-key'].sort(),
    );
    expect(JSON.stringify(calls)).not.toContain(SECRET);
  });

  it('gives every dispatch its own env, so a key added for one run never leaks into the next', async () => {
    const remote = dispatchRemote();
    remote.queue.push({
      runUuid: 'r-2',
      runId: 2,
      ticketUuid: 't-2',
      stateAtStart: 'working',
      handler: 'code',
    });
    const executor = new EventExecutor([]);
    const conductor = await conductorWith(
      [
        {
          before_run: (ctx) => {
            if (ctx.run?.uuid === 'r-1') ctx.env.ONLY_R1 = '1';
          },
        },
      ],
      remote,
      executor,
    );

    await conductor.tick();

    expect(executor.started.map((s) => s.env?.ONLY_R1)).toEqual([
      '1',
      undefined,
    ]);
  });

  it('logs a throwing or rejecting listener safely and continues with the next listener, the shell hook and the launch', async () => {
    const events: string[] = [];
    const executor = new EventExecutor(events);
    const { log, calls } = spyLogger();
    const conductor = await conductorWith(
      [
        {
          id: 'sync-throw',
          before_run: () => {
            throw new Error(`leaked ${SECRET}`);
          },
        },
        {
          before_run: async () => {
            throw new TypeError(SECRET);
          },
        },
        recorder('C', events),
      ],
      dispatchRemote(),
      executor,
      log,
    );
    const remote = (conductor as unknown as { remote: FakeBbRemote }).remote;

    await conductor.tick();

    expect(events).toContain('C:before_run');
    expect(events.indexOf('shell:before_run')).toBeGreaterThan(
      events.indexOf('C:before_run'),
    );
    expect(executor.started).toHaveLength(1);
    expect(remote.calls.markFailed).toEqual([]);
    expect(
      calls.filter((c) => c.msg === 'hook listener failed').map((c) => c.obj),
    ).toEqual([
      {
        hook: 'before_run',
        listener: 'sync-throw',
        ticket: 'BB-1',
        run: 'r-1',
        err: 'Error',
      },
      {
        hook: 'before_run',
        listener: '#1',
        ticket: 'BB-1',
        run: 'r-1',
        err: 'TypeError',
      },
    ]);
    expect(JSON.stringify(calls)).not.toContain(SECRET);
  });

  it('records a failing after_create listener like a failing provisioning hook, and still launches', async () => {
    const executor = new EventExecutor([]);
    const { log, calls } = spyLogger();
    const conductor = await conductorWith(
      [
        {
          id: 'prov',
          after_create: () => {
            throw new Error('nope');
          },
        },
      ],
      dispatchRemote(),
      executor,
      log,
    );

    await conductor.tick();

    expect(
      calls.find((c) => c.msg === 'lifecycle hook failed')?.obj,
    ).toMatchObject({
      hook: 'after_create',
      run: 'r-1',
      err: 'hook listener failed: prov',
    });
    expect(executor.started).toHaveLength(1);
  });

  it('does not fire after_run when the launch succeeds — the sidecar outlives the launch', async () => {
    const events: string[] = [];
    const conductor = await conductorWith(
      [recorder('A', events)],
      dispatchRemote(),
      new EventExecutor(events),
    );

    await conductor.tick();

    expect(events).not.toContain('A:after_run');
    expect(events).not.toContain('shell:after_run');
  });

  it('fires after_run immediately when startRun rejects, keeping the original error', async () => {
    const events: string[] = [];
    const executor = new EventExecutor(events);
    executor.persistent = true;
    executor.startError = new Error('startRun exploded');
    const remote = dispatchRemote();
    const conductor = await conductorWith(
      [
        recorder('A', events),
        {
          after_run: () => {
            throw new Error('cleanup boom');
          },
        },
      ],
      remote,
      executor,
    );

    await conductor.tick();

    // Not launched → no worker to stop; the sidecars still stop.
    expect(events.slice(events.indexOf('start'))).toEqual([
      'start',
      'A:after_run',
      'shell:after_run',
    ]);
    expect(remote.calls.markFailed).toEqual([
      {
        runUuid: 'r-1',
        errorLog: expect.stringContaining('startRun exploded'),
      },
    ]);
  });

  it('stops the launched worker before after_run when a post-launch write fails', async () => {
    const events: string[] = [];
    const executor = new EventExecutor(events);
    executor.persistent = true;
    const remote = dispatchRemote();
    remote.markRunning = async () => {
      throw new Error('markRunning 503');
    };
    const conductor = await conductorWith(
      [recorder('A', events)],
      remote,
      executor,
    );

    await conductor.tick();

    expect(events.slice(events.indexOf('start'))).toEqual([
      'start',
      'stop',
      'tab:1',
      'A:after_run',
      'shell:after_run',
    ]);
    expect(remote.calls.markFailed[0]?.errorLog).toContain('markRunning 503');
  });

  /** Ended, unclosed runs seeded straight into the remote — no dispatch. */
  function endedRunsRemote(): FakeBbRemote {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'review' },
        't-2': { identifier: 'BB-2', title: 'Two', state: 'cancelled' },
      },
      runs: [
        {
          runUuid: 'r-1',
          id: 11,
          ticketUuid: 't-1',
          stateAtStart: 'working',
          state: 'done',
          worktreePath: PRESENT_WORKTREE,
        },
        {
          runUuid: 'r-2',
          id: 12,
          ticketUuid: 't-2',
          stateAtStart: 'review',
          state: 'cancelled',
          worktreePath: PRESENT_WORKTREE,
        },
      ],
    });
    remote.queue.length = 0; // finalise only — nothing to dispatch.
    return remote;
  }

  it('a fresh conductor fires after_run at run end for done and cancelled runs, after the worker stops and before the close write', async () => {
    const events: string[] = [];
    const seen: Array<{
      id: string;
      slot: HookName;
      ctx: HookListenerContext;
    }> = [];
    const remote = endedRunsRemote();
    const executor = new EventExecutor(events);
    executor.persistent = true;
    const conductor = await conductorWith(
      [recorder('A', events, seen)],
      remote,
      executor,
    );

    // Runs of different tickets finalise in parallel (BB-651), so the
    // order is asserted per run: each event is tagged with the run it names.
    const runOf: Record<string, string> = {
      'bakers/bb-1': 'r-1',
      'bakers/bb-2': 'r-2',
      'BB-1': 'r-1',
      'BB-2': 'r-2',
      '11': 'r-1',
      '12': 'r-2',
    };
    const byRun: Record<string, string[]> = { 'r-1': [], 'r-2': [] };
    const tag = (key: string, event: string) =>
      byRun[runOf[key] ?? key]?.push(event);
    const stop = executor.stopRun.bind(executor);
    executor.stopRun = async (branch) => {
      tag(branch, 'stop');
      return stop(branch);
    };
    const cleanup = executor.cleanupRun.bind(executor);
    executor.cleanupRun = async (branch, runId) => {
      tag(String(runId), 'tab');
      return cleanup(branch, runId);
    };
    const hook = executor.runHook.bind(executor);
    executor.runHook = async (name, cwd, ctx, env) => {
      tag(ctx.ticket, `shell:${name}`);
      return hook(name, cwd, ctx, env);
    };
    const push = seen.push.bind(seen);
    seen.push = (...items) => {
      for (const s of items) tag(s.ctx.ticket.identifier, `${s.id}:${s.slot}`);
      return push(...items);
    };
    const close = remote.finalizeRun.bind(remote);
    remote.finalizeRun = async (...args) => {
      tag(args[0], 'close');
      return close(...args);
    };

    await conductor.tick();

    expect(byRun).toEqual({
      'r-1': ['stop', 'tab', 'A:after_run', 'shell:after_run', 'close'],
      'r-2': ['stop', 'tab', 'A:after_run', 'shell:after_run', 'close'],
    });
    // Rebuilt from the durable run record and the CURRENT ticket.
    expect(
      seen.map((s) => ({
        run: s.ctx.run,
        state: s.ctx.state,
        ticket: s.ctx.ticket.identifier,
        envRun: s.ctx.env.BAKERS_RUN_UUID,
      })),
    ).toEqual([
      {
        run: { uuid: 'r-1', id: 11 },
        state: 'working',
        ticket: 'BB-1',
        envRun: 'r-1',
      },
      {
        run: { uuid: 'r-2', id: 12 },
        state: 'review',
        ticket: 'BB-2',
        envRun: 'r-2',
      },
    ]);
    expect(executor.shellEnv.after_run?.BAKERS_RUN_UUID).toBe('r-2');
  });

  it('gives a shell-only after_run the rebuilt run env and the ticket identifier at run end', async () => {
    const executor = new EventExecutor([]);
    const conductor = await conductorWith([], endedRunsRemote(), executor);

    await conductor.tick();

    expect(executor.shellEnv.after_run?.BAKERS_RUN_UUID).toBe('r-2');
    expect(executor.shellTicket.after_run).toBe('BB-2');
  });

  it('logs the run uuid as the after_run ticket ref when the run names no ticket', async () => {
    const remote = endedRunsRemote();
    const fetch = remote.fetchFinalizableRuns.bind(remote);
    remote.fetchFinalizableRuns = async (id) =>
      (await fetch(id)).map((r) => ({ ...r, ticketUuid: '' }));
    const executor = new EventExecutor([]);
    const conductor = await conductorWith([], remote, executor);

    await conductor.tick();

    expect(executor.shellTicket.after_run).toBe('r-2');
  });

  it('still fires after_run when the transcript cannot be read, and repeats it on the retry that closes the run', async () => {
    const events: string[] = [];
    const remote = endedRunsRemote();
    let readable = false;
    const agent: BbAgent = {
      ...fakeAgent,
      getRunLog: async () => {
        if (!readable) throw new Error('transcript unreadable');
        return '';
      },
    };
    const conductor = new TestConductor(
      makeConfig({ hookListeners: [recorder('A', events)] }),
      remote,
      new EventExecutor(events),
      new FakeWorkspace(),
      resolved(agent),
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();

    await conductor.tick();
    expect(events.filter((e) => e === 'A:after_run')).toHaveLength(2);
    expect(remote.calls.finalizeRun).toEqual([]);

    readable = true;
    await conductor.tick();
    expect(events.filter((e) => e === 'A:after_run')).toHaveLength(4);
    expect(remote.calls.finalizeRun.map((c) => c.runUuid)).toEqual([
      'r-1',
      'r-2',
    ]);
  });

  it('repeats after_run when the close write fails, then stops once the run is closed', async () => {
    const events: string[] = [];
    const remote = endedRunsRemote();
    const finalize = remote.finalizeRun.bind(remote);
    let failClose = true;
    remote.finalizeRun = async (...args) => {
      if (failClose) throw new Error('close 503');
      return finalize(...args);
    };
    const conductor = await conductorWith(
      [recorder('A', events)],
      remote,
      new EventExecutor(events),
    );

    await conductor.tick();
    failClose = false;
    await conductor.tick();
    await conductor.tick();

    expect(events.filter((e) => e === 'A:after_run')).toHaveLength(4);
  });

  function closedTicketRemote(worktreePath: string): FakeBbRemote {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'done',
          closed: true,
          effectiveEnvVars: 'TICKET_ONLY=1',
        },
      },
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          closed: true,
          worktreePath,
        },
      ],
    });
    remote.queue.length = 0;
    return remote;
  }

  it('after_done runs listeners with the current ticket context before the shell hook, whose env stays inherited', async () => {
    const events: string[] = [];
    const seen: Array<{
      id: string;
      slot: HookName;
      ctx: HookListenerContext;
    }> = [];
    const remote = closedTicketRemote(PRESENT_WORKTREE);
    const executor = new EventExecutor(events);
    const conductor = await conductorWith(
      [recorder('A', events, seen), recorder('B', events, seen)],
      remote,
      executor,
    );

    await conductor.reap();

    expect(events).toEqual([
      'A:after_done',
      'B:after_done',
      'shell:after_done',
    ]);
    expect(seen[0]?.ctx).toMatchObject({
      worktreePath: PRESENT_WORKTREE,
      state: 'done',
      run: { uuid: 'r-1' },
      ticket: { identifier: 'BB-1' },
    });
    expect(seen[0]?.ctx.env.TICKET_ONLY).toBe('1');
    expect(executor.shellEnv.after_done).toBeUndefined();
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
  });

  it('after_done keeps the absent-directory skip for listeners and shell alike', async () => {
    const events: string[] = [];
    const remote = closedTicketRemote(ABSENT_WORKTREE);
    const conductor = await conductorWith(
      [recorder('A', events)],
      remote,
      new EventExecutor(events),
    );

    await conductor.reap();

    expect(events).toEqual([]);
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
  });

  it('an unreadable ticket skips the after_done listeners but not the shell hook or the teardown', async () => {
    const events: string[] = [];
    const remote = closedTicketRemote(PRESENT_WORKTREE);
    remote.getTicket = async () => {
      throw new Error('ticket 503');
    };
    const { log, calls } = spyLogger();
    const conductor = await conductorWith(
      [recorder('A', events)],
      remote,
      new EventExecutor(events),
      log,
    );

    await conductor.reap();

    expect(events).toEqual(['shell:after_done']);
    expect(
      calls.some(
        (c) =>
          c.msg === 'hook listener context unavailable — listeners not run',
      ),
    ).toBe(true);
    expect(remote.calls.markCleanedUp).toEqual(['t-1']);
  });
});

describe('qualification gate orchestration (the frame)', () => {
  const wf = readProjectWorkflow();
  const guardLink = '[ensure qualification](ensure-qualification.md)';

  it('unqualified path: plan and working invoke the guard in their read phase', () => {
    for (const state of ['plan.md', 'working.md']) {
      const read = mdSection(readReference(state), 'read');
      expect(read, `${state} read phase missing guard`).toContain(guardLink);
    }
    // Recovery and its stop condition belong to the shared guard, not the state files.
    const guard = readReference('ensure-qualification.md');
    expect(guard).toContain('returned_to_qualification');
    expect(guard).toMatch(/then stop/);
    expect(guard).toMatch(
      /\[transition ticket\]\(transition-ticket\.md\).*destination `qualification`/,
    );
  });

  it('qualified path: the state continues after the guard', () => {
    for (const state of ['plan.md', 'working.md']) {
      const read = mdSection(readReference(state), 'read');
      const continuation = /[Cc]ontinu\w*\s+only\s+on\s+`qualified`/.exec(read);
      expect(continuation).not.toBeNull();
      expect(continuation?.index).toBeGreaterThan(read.indexOf(guardLink));
    }
  });

  it('guard exclusion: review and the recipe do not invoke the guard', () => {
    expect(mdSection(readSkill('bb-recipe-matt'), 'bb-state-review')).not.toBe(
      '',
    );
    expect(readSkill('bb-recipe-matt')).not.toContain('ensure-qualification');
    expect(readReference('review.md')).not.toContain('ensure-qualification');
  });

  it('WORKFLOW.md is the entry line plus phase hints — no loader, no state sections', () => {
    expect(wf).toContain('Invoke `bakers:bb-workflow`');
    expect(wf).not.toContain('## Loaded skills');
    expect(wf).not.toContain('## State:');
  });
});

describe('Conductor poll loop — reaped checkout', () => {
  it('stops instead of claiming when its own checkout is gone', async () => {
    const remote = new FakeBbRemote({
      runs: [{ runUuid: 'r-1', ticketUuid: 't-1', stateAtStart: 'working' }],
    });
    const { log, calls } = spyLogger();
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      new FakeExecutor({ outcome: 'exited' }),
      new FakeWorkspace(),
      resolved(fakeAgent),
      log,
      '/tmp/bakers-conductor-definitely-not-on-disk',
    );
    await conductor.start();

    // No AbortSignal: a conductor that kept polling here would never return.
    await conductor.serve();

    const gone = calls.find((c) => c.msg?.includes('checkout is gone'));
    expect(gone?.level).toBe('error');
    // It must not have claimed anything — claiming a run it cannot dispatch is
    // what burned the circuit breaker. The seeded run is still queued.
    expect(
      await remote.claimNext({ leaseSeconds: 60, conductorId: 'x' }),
    ).toMatchObject({ runUuid: 'r-1' });
  });

  it('ticks normally while the checkout exists', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bakers-conductor-live-'));
    try {
      const remote = new FakeBbRemote();
      const { log, calls } = spyLogger();
      const conductor = new TestConductor(
        makeConfig({ poll_interval_ms: 1 }),
        remote,
        new FakeExecutor({ outcome: 'exited' }),
        new FakeWorkspace(),
        resolved(fakeAgent),
        log,
        root,
      );
      await conductor.start();

      const ac = new AbortController();
      const served = conductor.serve(ac.signal);
      setTimeout(() => ac.abort(), 25);
      await served;

      expect(calls.some((c) => c.msg === 'conductor tick')).toBe(true);
      expect(calls.some((c) => c.msg?.includes('checkout is gone'))).toBe(
        false,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Conductor — freeze hooks', () => {
  /** Two open tickets of this conductor, each with a run in a real worktree. */
  function freezeSeed(): FakeRemoteSeed & {
    tickets: Record<string, FakeSeedTicket>;
  } {
    return {
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'working' },
        't-2': { identifier: 'BB-2', title: 'Two', state: 'working' },
      },
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'working',
          state: 'done',
          worktreePath: PRESENT_WORKTREE,
          closed: true,
        },
        {
          runUuid: 'r-2',
          ticketUuid: 't-2',
          stateAtStart: 'working',
          state: 'done',
          worktreePath: PRESENT_WORKTREE,
          closed: true,
        },
      ],
    };
  }

  async function freezeConductor(
    remote: FakeBbRemote,
    executor: RecordingExecutor,
    listeners: HookListener[] = [],
    log: ConductorLogger = spyLogger().log,
    frozenStateFile?: string,
  ): Promise<Conductor> {
    // The seeded runs only carry the worktree path; nothing is dispatched.
    remote.queue.length = 0;
    const conductor = new TestConductor(
      makeConfig({ hookListeners: listeners }),
      remote,
      executor,
      new FakeWorkspace(),
      resolved(fakeAgent),
      log,
      CHECKOUT,
      frozenStateFile,
    );
    await conductor.start();
    return conductor;
  }

  const freezeCalls = (executor: RecordingExecutor) =>
    executor.hookCalls.filter(
      (h) => h.name === 'on_freeze' || h.name === 'on_resume',
    );

  it('runs on_freeze once in the worktree, and on_resume once after the unfreeze', async () => {
    const seed = freezeSeed();
    const remote = new FakeBbRemote(seed);
    const executor = new RecordingExecutor();
    const conductor = await freezeConductor(remote, executor);

    await conductor.tick();
    expect(freezeCalls(executor)).toEqual([]);

    seed.tickets['t-1'].frozen = true;
    await conductor.tick();
    await conductor.tick();
    expect(freezeCalls(executor)).toEqual([
      { name: 'on_freeze', cwd: PRESENT_WORKTREE, ticket: 'BB-1' },
    ]);

    seed.tickets['t-1'].frozen = false;
    await conductor.tick();
    await conductor.tick();
    expect(freezeCalls(executor)).toEqual([
      { name: 'on_freeze', cwd: PRESENT_WORKTREE, ticket: 'BB-1' },
      { name: 'on_resume', cwd: PRESENT_WORKTREE, ticket: 'BB-1' },
    ]);
  });

  it('an unfreeze while the conductor is down still runs on_resume once after the restart', async () => {
    const seed = freezeSeed();
    const remote = new FakeBbRemote(seed);
    const executor = new RecordingExecutor();
    const stateFile = join(
      mkdtempSync(join(tmpdir(), 'bakers-frozen-state-')),
      'frozen.json',
    );

    seed.tickets['t-1'].frozen = true;
    const before = await freezeConductor(
      remote,
      executor,
      [],
      undefined,
      stateFile,
    );
    await before.tick();

    seed.tickets['t-1'].frozen = false;
    const after = await freezeConductor(
      remote,
      executor,
      [],
      undefined,
      stateFile,
    );
    await after.tick();
    await after.tick();

    expect(freezeCalls(executor)).toEqual([
      { name: 'on_freeze', cwd: PRESENT_WORKTREE, ticket: 'BB-1' },
      { name: 'on_resume', cwd: PRESENT_WORKTREE, ticket: 'BB-1' },
    ]);
  });

  it('a restart does not repeat on_freeze for a ticket that stayed frozen', async () => {
    const seed = freezeSeed();
    seed.tickets['t-1'].frozen = true;
    const remote = new FakeBbRemote(seed);
    const executor = new RecordingExecutor();
    const stateFile = join(
      mkdtempSync(join(tmpdir(), 'bakers-frozen-state-')),
      'frozen.json',
    );

    for (let i = 0; i < 2; i++) {
      const conductor = await freezeConductor(
        remote,
        executor,
        [],
        undefined,
        stateFile,
      );
      await conductor.tick();
    }

    expect(freezeCalls(executor)).toEqual([
      { name: 'on_freeze', cwd: PRESENT_WORKTREE, ticket: 'BB-1' },
    ]);
  });

  it('an unreadable frozen list runs no hook and keeps the observation', async () => {
    const seed = freezeSeed();
    seed.tickets['t-1'].frozen = true;
    const remote = new FakeBbRemote(seed);
    const executor = new RecordingExecutor();
    const conductor = await freezeConductor(remote, executor);
    await conductor.tick();

    seed.tickets['t-1'].frozen = false;
    const read = remote.fetchFrozenTickets.bind(remote);
    remote.fetchFrozenTickets = async () => {
      throw new Error('control plane down');
    };
    await conductor.tick();
    expect(freezeCalls(executor)).toEqual([
      { name: 'on_freeze', cwd: PRESENT_WORKTREE, ticket: 'BB-1' },
    ]);

    remote.fetchFrozenTickets = read;
    await conductor.tick();
    expect(freezeCalls(executor)).toEqual([
      { name: 'on_freeze', cwd: PRESENT_WORKTREE, ticket: 'BB-1' },
      { name: 'on_resume', cwd: PRESENT_WORKTREE, ticket: 'BB-1' },
    ]);
  });

  it('runs no hook for a frozen ticket without a worktree on this machine', async () => {
    const seed = freezeSeed();
    seed.runs = [
      { ...(seed.runs?.[0] as FakeSeedRun), worktreePath: ABSENT_WORKTREE },
    ];
    seed.tickets['t-1'].frozen = true;
    const remote = new FakeBbRemote(seed);
    const executor = new RecordingExecutor();
    const conductor = await freezeConductor(remote, executor);

    await conductor.tick();
    seed.tickets['t-1'].frozen = false;
    await conductor.tick();

    expect(freezeCalls(executor)).toEqual([]);
  });

  it('ignores a frozen ticket assigned to another conductor', async () => {
    const seed = freezeSeed();
    seed.tickets['t-1'].frozen = true;
    seed.tickets['t-1'].conductorId = 'someone-else';
    const executor = new RecordingExecutor();
    const conductor = await freezeConductor(new FakeBbRemote(seed), executor);

    await conductor.tick();

    expect(freezeCalls(executor)).toEqual([]);
  });

  it('a failing hook is logged with the ticket identifier and the other ticket still gets its hook', async () => {
    const seed = freezeSeed();
    seed.tickets['t-1'].frozen = true;
    seed.tickets['t-2'].frozen = true;
    const executor = new RecordingExecutor();
    executor.failingHooks.add('on_freeze');
    const { log, calls } = spyLogger();
    const failing: HookListener = {
      id: 'boom',
      on_freeze: async () => {
        throw new Error('listener down');
      },
    };
    const conductor = await freezeConductor(
      new FakeBbRemote(seed),
      executor,
      [failing],
      log,
    );

    await expect(conductor.tick()).resolves.toBeUndefined();

    expect(freezeCalls(executor).map((h) => h.ticket)).toEqual([
      'BB-1',
      'BB-2',
    ]);
    expect(
      calls
        .filter(
          (c) =>
            c.msg === 'hook listener failed' &&
            (c.obj as { hook?: string }).hook === 'on_freeze',
        )
        .map((c) => (c.obj as { ticket?: string }).ticket),
    ).toEqual(['BB-1', 'BB-2']);
  });

  it('hands addon listeners the worktree and ticket of the freeze', async () => {
    const seed = freezeSeed();
    seed.tickets['t-1'].frozen = true;
    const seen: Array<{ slot: string; worktreePath: string; id: string }> = [];
    const listener: HookListener = {
      id: 'marker',
      on_freeze: (ctx) => {
        seen.push({
          slot: 'on_freeze',
          worktreePath: ctx.worktreePath,
          id: ctx.ticket.identifier,
        });
      },
      on_resume: (ctx) => {
        seen.push({
          slot: 'on_resume',
          worktreePath: ctx.worktreePath,
          id: ctx.ticket.identifier,
        });
      },
    };
    const conductor = await freezeConductor(
      new FakeBbRemote(seed),
      new RecordingExecutor(),
      [listener],
    );

    await conductor.tick();
    seed.tickets['t-1'].frozen = false;
    await conductor.tick();

    expect(seen).toEqual([
      { slot: 'on_freeze', worktreePath: PRESENT_WORKTREE, id: 'BB-1' },
      { slot: 'on_resume', worktreePath: PRESENT_WORKTREE, id: 'BB-1' },
    ]);
  });
});

describe('action queue', () => {
  function gate() {
    let open!: () => void;
    const opened = new Promise<void>((r) => {
      open = r;
    });
    return { opened, open };
  }

  async function hangingAddon(g: { opened: Promise<void> }) {
    return loadInbox({
      name: 'hang',
      version: '0.0.1',
      inbox: {
        contract: 2,
        label: 'Hang',
        messages: { status: { label: 'Status', access: 'view' } },
        handlers: async () => ({
          status: async () => {
            await g.opened;
            return { markdown: 'ok' };
          },
        }),
      },
    });
  }

  /** A pending inbox message naming `hang.status`, with a real worktree dir. */
  function hangMessage(id: string, ticketUuid: string) {
    return {
      id,
      messageId: 'hang.status',
      version: '0.0.1',
      ticketUuid,
      payload: {},
      worktreePath: mkdtempSync(join(tmpdir(), `bakers-queue-${id}-`)),
    };
  }

  const coding = (n: number) =>
    Object.fromEntries(
      Array.from({ length: n }, (_, k) => [
        `t-${k + 1}`,
        {
          identifier: `bakers.build-${k + 1}`,
          title: `T${k + 1}`,
          state: 'working',
        },
      ]),
    );

  it('never waits for hanging messages: heartbeat and claims run every tick', async () => {
    const g = gate();
    const remote = new FakeBbRemote({ tickets: coding(6) });
    for (let i = 1; i <= 6; i++)
      remote.enqueue(hangMessage(`m-${i}`, `t-${i}`));
    let heartbeats = 0;
    let claims = 0;
    const hb = remote.heartbeat.bind(remote);
    remote.heartbeat = async (...a) => {
      heartbeats++;
      return hb(...a);
    };
    remote.claimNext = async () => {
      claims++;
      return null;
    };
    const conductor = await startedConductor(
      makeConfig({ inboxAddons: [await hangingAddon(g)] }),
      remote,
      new RecordingExecutor(),
    );
    const before = heartbeats;
    await conductor.produce();
    await conductor.produce();
    expect(heartbeats - before).toBe(2);
    expect(claims).toBe(2);
    g.open();
    await conductor.tick();
  });

  it('answers a message for another ticket while others hang in independent lanes', async () => {
    const g = gate();
    const remote = new FakeBbRemote({ tickets: coding(7) });
    for (let i = 1; i <= 6; i++)
      remote.enqueue(hangMessage(`m-${i}`, `t-${i}`));
    remote.claimNext = async () => null;
    remote.enqueue({
      id: 'm-7',
      messageId: 'fake.echo',
      version: '0.0.1',
      ticketUuid: 't-7',
      payload: { text: 'hi' },
      worktreePath: mkdtempSync(join(tmpdir(), 'bakers-queue-7-')),
    });
    const fake = await loadInbox({
      name: 'fake',
      version: '0.0.1',
      inbox: fakeInbox,
    });
    const conductor = await startedConductor(
      makeConfig({ inboxAddons: [await hangingAddon(g), fake] }),
      remote,
      new RecordingExecutor(),
    );
    await conductor.produce();
    for (
      let i = 0;
      i < 50 &&
      !remote.results.some((r) => r.id === 'm-7' && r.status === 'done');
      i++
    ) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(
      remote.results.filter((r) => r.id === 'm-7').map((r) => r.status),
    ).toEqual(['running', 'done']);
    expect(
      remote.results.filter(
        (r) => r.id.startsWith('m-') && r.id !== 'm-7' && r.status === 'done',
      ),
    ).toEqual([]);
    g.open();
    await conductor.tick();
    const hungDone = remote.results.filter(
      (r) => r.id !== 'm-7' && r.status === 'done',
    );
    expect(hungDone).toHaveLength(6);
  });

  it('warns about an action that outlives the run lease', async () => {
    const g = gate();
    const remote = new FakeBbRemote({ tickets: coding(1) });
    remote.enqueue(hangMessage('m-1', 't-1'));
    remote.claimNext = async () => null;
    const { log, calls } = spyLogger();
    const conductor = new TestConductor(
      makeConfig({ lease_seconds: 0, inboxAddons: [await hangingAddon(g)] }),
      remote,
      new RecordingExecutor(),
      new FakeWorkspace(),
      resolved(fakeAgent),
      log,
      CHECKOUT,
    );
    await conductor.start();
    await conductor.produce();
    await new Promise((r) => setTimeout(r, 5));
    await conductor.produce();
    expect(
      calls.some(
        (c) =>
          c.level === 'warn' &&
          /^action message:m-1 running for \d+ms$/.test(c.msg ?? ''),
      ),
    ).toBe(true);
    g.open();
    await conductor.tick();
  });

  it('a failing query does not stop the other steps or the claims', async () => {
    const remote = new FakeBbRemote();
    remote.fetchFinalizableRuns = async () => {
      throw new Error('down');
    };
    let claims = 0;
    remote.claimNext = async () => {
      claims++;
      return null;
    };
    const { log, calls } = spyLogger();
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      new RecordingExecutor(),
      new FakeWorkspace(),
      resolved(fakeAgent),
      log,
      CHECKOUT,
    );
    await conductor.start();
    await conductor.tick();
    expect(claims).toBe(1);
    expect(
      calls.some(
        (c) => c.level === 'warn' && c.msg === 'finalize query failed',
      ),
    ).toBe(true);
  });

  it('runs the actions of one ticket in order: finalize before reap', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'done',
          branchName: 'bakers/bb-1',
          closed: true,
        },
      },
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: PRESENT_WORKTREE,
        },
      ],
    });
    remote.claimNext = async () => null;
    const order: string[] = [];
    const fin = remote.finalizeRun.bind(remote);
    remote.finalizeRun = async (...a) => {
      await new Promise((r) => setTimeout(r, 5));
      order.push('finalize');
      return fin(...a);
    };
    const executor = new RecordingExecutor();
    executor.persistent = true;
    const rm = executor.removeWorktree.bind(executor);
    executor.removeWorktree = async (...a) => {
      order.push('reap');
      return rm(...a);
    };
    const conductor = await startedConductor(makeConfig(), remote, executor);
    await conductor.tick();
    expect(order).toEqual(['finalize', 'reap']);
  });

  it('serializes git worktree calls across tickets', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'todo' },
        't-2': { identifier: 'BB-2', title: 'Two', state: 'todo' },
        't-3': {
          identifier: 'BB-3',
          title: 'Three',
          state: 'done',
          branchName: 'bakers/bb-3',
          closed: true,
        },
      },
    });
    for (const i of [1, 2]) {
      remote.queue.push({
        runUuid: `r-${i}`,
        runId: i,
        ticketUuid: `t-${i}`,
        stateAtStart: 'todo',
        handler: 'code',
      });
    }
    let inFlight = 0;
    let max = 0;
    const track = async <T>(fn: () => Promise<T>): Promise<T> => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      try {
        return await fn();
      } finally {
        inFlight--;
      }
    };
    const workspace = new FakeWorkspace();
    const ensure = workspace.ensure.bind(workspace);
    workspace.ensure = (...a) => track(() => ensure(...a));
    const executor = new RecordingExecutor();
    executor.persistent = true;
    const rm = executor.removeWorktree.bind(executor);
    executor.removeWorktree = (...a) => track(() => rm(...a));
    const conductor = await startedConductor(
      makeConfig(),
      remote,
      executor,
      workspace,
    );
    await conductor.tick();
    expect(executor.started).toHaveLength(2);
    expect(remote.calls.markCleanedUp).toEqual(['t-3']);
    expect(max).toBe(1);
  });

  it('serve stops producing on abort and returns once actions settle', async () => {
    const g = gate();
    const remote = new FakeBbRemote({ tickets: coding(6) });
    for (let i = 1; i <= 6; i++)
      remote.enqueue(hangMessage(`m-${i}`, `t-${i}`));
    remote.claimNext = async () => null;
    // A real checkout: a missing one ends serve() at once (checkoutGone).
    const conductor = new TestConductor(
      makeConfig({
        poll_interval_ms: 10,
        inboxAddons: [await hangingAddon(g)],
      }),
      remote,
      new RecordingExecutor(),
      new FakeWorkspace(),
      resolved(fakeAgent),
      spyLogger().log,
      mkdtempSync(join(tmpdir(), 'bakers-queue-serve-')),
    );
    await conductor.start();
    const controller = new AbortController();
    const served = conductor.serve(controller.signal);
    await new Promise((r) => setTimeout(r, 30));
    controller.abort();
    let done = false;
    void served.then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(done).toBe(false);
    g.open();
    await served;
    expect(done).toBe(true);
  });
});

// The conductor tells an open `bakers ui` its data changed by touching
// `.bakers/ui-refresh` in the checkout and in the run's worktree.
describe('Conductor — bakers ui refresh signal', () => {
  const OLD = 1_000;

  function project(): { checkout: string; worktree: string } {
    const root = mkdtempSync(join(tmpdir(), 'bakers-ui-signal-'));
    const checkout = join(root, 'checkout');
    const worktree = join(root, 'wt');
    mkdirSync(join(checkout, '.bakers'), { recursive: true });
    mkdirSync(join(worktree, '.bakers'), { recursive: true });
    return { checkout, worktree };
  }

  const signal = (dir: string) => join(dir, '.bakers', 'ui-refresh');
  const signalled = (dir: string) =>
    existsSync(signal(dir)) && statSync(signal(dir)).mtimeMs > OLD * 1000;
  const age = (dir: string) => utimesSync(signal(dir), OLD, OLD);

  function at(worktree: string): BbWorkspace {
    return {
      ensure: async () => ({
        path: worktree,
        instructions: null,
        created: false,
      }),
      remove: async () => 'removed',
    };
  }

  function queued(): FakeBbRemote {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'todo',
          projectId: 'p-1',
        },
      },
    });
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'todo',
      handler: 'code',
    });
    return remote;
  }

  function conductorOf(
    remote: BbRemote,
    executor: BbExecutor,
    p: { checkout: string; worktree: string },
  ): Conductor {
    return new TestConductor(
      makeConfig(),
      remote,
      executor,
      at(p.worktree),
      resolved(fakeAgent),
      spyLogger().log,
      p.checkout,
    );
  }

  it('signals the checkout and the run worktree when a run is claimed and running', async () => {
    const p = project();
    const remote = queued();
    const conductor = conductorOf(remote, new RecordingExecutor(), p);
    await conductor.start();
    await conductor.tick();
    expect(remote.calls.markRunning).toHaveLength(1);
    expect(signalled(p.checkout)).toBe(true);
    expect(signalled(p.worktree)).toBe(true);
  });

  it('signals the checkout and the worktree when a dispatch fails', async () => {
    const p = project();
    const remote = queued();
    // Seen at startRun: only the claim has signalled so far; asserting here
    // would be swallowed by the dispatch's catch.
    let atClaim = { checkout: false, worktree: false };
    const boom: BbExecutor = {
      id: 'boom',
      capabilities: () => ({ persistent: false }),
      startRun: async () => {
        atClaim = {
          checkout: signalled(p.checkout),
          worktree: signalled(p.worktree),
        };
        // Age the file after claim, so only the failure can advance it.
        age(p.checkout);
        throw new Error('startRun exploded');
      },
      stopRun: async () => {},
      cleanupRun: async () => {},
    };
    const conductor = conductorOf(remote, boom, p);
    await conductor.start();
    await conductor.tick();
    // The claim signals the checkout only: the run has no worktree yet.
    expect(atClaim).toEqual({ checkout: true, worktree: false });
    expect(remote.calls.markFailed).toHaveLength(1);
    expect(signalled(p.checkout)).toBe(true);
    expect(signalled(p.worktree)).toBe(true);
  });

  it("signals the checkout and the run worktree after a run agent's ticket write", async () => {
    const p = project();
    const remote = queued();
    remote.siteTools = {
      list: async () => [
        {
          name: 'tool_api__bakers_ticket_update',
          inputSchema: { type: 'object' },
        },
      ],
      // Every ticket the run names belongs to its own project.
      call: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ project: 'p-1' }) }],
      }),
      close: async () => {},
    };
    const executor = new RecordingExecutor();
    const conductor = conductorOf(remote, executor, p);
    await conductor.startTools();
    await conductor.start();
    await conductor.tick();
    // Age both after the run started, so only the write can advance them.
    age(p.checkout);
    age(p.worktree);
    const env = executor.started[0]?.env ?? {};
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(env.BAKERS_CONDUCTOR_URL ?? ''),
        {
          requestInit: {
            headers: { authorization: `Bearer ${env.BAKERS_CONDUCTOR_TOKEN}` },
          },
        },
      ),
    );
    const result = await client.callTool({
      name: 'bakers_ticket_update',
      arguments: { ticket: 'BB-1' },
    });
    await client.close();
    await conductor.stopTools();
    expect(result.isError).toBeFalsy();
    expect(signalled(p.checkout)).toBe(true);
    expect(signalled(p.worktree)).toBe(true);
  });

  it('signals the checkout and the worktree when a run is finalised', async () => {
    const p = project();
    writeFileSync(signal(p.checkout), '');
    writeFileSync(signal(p.worktree), '');
    age(p.checkout);
    age(p.worktree);
    const remote = new FakeBbRemote({
      runs: [
        {
          runUuid: 'r-1',
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: p.worktree,
        },
      ],
    });
    const conductor = conductorOf(remote, new RecordingExecutor(), p);
    await conductor.start();
    await conductor.tick();
    expect(remote.calls.finalizeRun).toHaveLength(1);
    expect(signalled(p.checkout)).toBe(true);
    expect(signalled(p.worktree)).toBe(true);
  });

  it('still reaches running when the signal cannot be written', async () => {
    const p = project();
    // `.bakers` as a plain file: every write below it fails, even as root.
    for (const dir of [p.checkout, p.worktree]) {
      rmSync(join(dir, '.bakers'), { recursive: true });
      writeFileSync(join(dir, '.bakers'), '');
    }
    const remote = queued();
    const conductor = conductorOf(remote, new RecordingExecutor(), p);
    await conductor.start();
    await conductor.tick();
    expect(remote.calls.markRunning).toHaveLength(1);
  });

  it('git-excludes the signal file exactly once per repository', async () => {
    const p = project();
    execFileSync('git', ['init', '-q'], { cwd: p.worktree });
    // Seeded, not merely queued, so `markDone` has a run record to finalise.
    const remote = new FakeBbRemote({
      tickets: { 't-1': { identifier: 'BB-1', title: 'One', state: 'todo' } },
      runs: [{ runUuid: 'r-1', ticketUuid: 't-1', stateAtStart: 'todo' }],
    });
    const conductor = conductorOf(remote, new RecordingExecutor(), p);
    await conductor.start();
    await conductor.tick();
    remote.markDone('r-1');
    await conductor.tick();
    expect(remote.calls.finalizeRun).toHaveLength(1);
    const exclude = readFileSync(
      join(p.worktree, '.git', 'info', 'exclude'),
      'utf8',
    );
    expect(
      exclude.split('\n').filter((l) => l === '/.bakers/ui-refresh'),
    ).toHaveLength(1);
    expect(
      execFileSync('git', ['status', '--porcelain'], {
        cwd: p.worktree,
        encoding: 'utf8',
      }),
    ).not.toContain('ui-refresh');
  });
});
