import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FakeBbRemote,
  fakeExecutor,
  fakeRemote,
  fakeWorkspace,
} from '@bakers-build/addon-fake';
import type {
  BbAgent,
  BbExecutor,
  BbRuntime,
  BbWorkspace,
  ConductorFileConfig,
  EnsuredWorkspace,
  HookName,
  HookResult,
  RuntimeLaunch,
  RuntimePlugin,
  RuntimeRun,
  SpawnRunInput,
  WorktreeTeardown,
} from '@bakers-build/conductor/contract';
import { emptyAgentFootprint } from '@bakers-build/conductor/contract';
import {
  type ConductorLogger,
  createRunClone,
  loadRunClone,
  runCloneGitDir,
} from '@bakers-build/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';
import { loadTools } from '../../src/plugins/tools.js';
import { TestConductor } from '../test-conductor.js';

const BRANCH = 'bakers/bb-1-one';
let CHECKOUT: string;
let parent: string;
let worktree: string;
let cacheHome: string | undefined;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const ident = ['-c', 'user.name=test', '-c', 'user.email=test@test'];
beforeEach(() => {
  CHECKOUT = mkdtempSync(join(tmpdir(), 'bakers-runtime-checkout-'));
  parent = join(CHECKOUT, 'parent');
  worktree = join(CHECKOUT, 'worktree');
  for (const dir of ['.bakers', '.ddev'])
    mkdirSync(join(parent, dir), { recursive: true });
  git(parent, 'init', '-q', '-b', 'main');
  writeFileSync(join(parent, '.bakers/keep'), '');
  writeFileSync(join(parent, '.ddev/keep'), '');
  git(parent, 'add', '.');
  git(parent, ...ident, 'commit', '-qm', 'base');
  git(parent, 'branch', BRANCH);
  // Run clones live in the conductor's cache: keep the operator's out of it.
  cacheHome = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = join(CHECKOUT, 'cache');
});
afterEach(() => {
  if (cacheHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = cacheHome;
  rmSync(CHECKOUT, { recursive: true, force: true });
});

/** A run clone under an isolating runtime, a plain directory otherwise. */
class Workspace implements BbWorkspace {
  constructor(
    private readonly instructions: string | null = null,
    private readonly clones = true,
  ) {}
  async ensure(): Promise<EnsuredWorkspace> {
    const base = { path: worktree, instructions: this.instructions };
    if (!this.clones) {
      mkdirSync(join(worktree, '.bakers'), { recursive: true });
      return { ...base, created: false };
    }
    const clone = createRunClone({
      parent,
      workspace: worktree,
      branch: BRANCH,
    });
    return { ...base, created: false, clone };
  }
}

class Executor implements BbExecutor {
  readonly id = 'recording';
  readonly started: SpawnRunInput[] = [];
  readonly hookEnv: Partial<Record<HookName, Record<string, string>>> = {};
  constructor(private readonly order: string[]) {}
  capabilities() {
    return { persistent: false };
  }
  async runHook(
    name: HookName,
    _cwd?: string,
    _ctx?: unknown,
    env?: Record<string, string>,
  ): Promise<HookResult> {
    if (env) this.hookEnv[name] = env;
    if (name === 'after_run') this.order.push('after_run');
    return { hook: name, ran: true, ok: true };
  }
  async startRun(input: SpawnRunInput) {
    this.order.push('startRun');
    this.started.push(input);
    return { sessionRef: input.ticket.branchName };
  }
  async stopRun(): Promise<void> {}
  async cleanupRun(): Promise<void> {
    this.order.push('cleanupRun');
  }
  async removeWorktree(): Promise<WorktreeTeardown> {
    return 'unverified';
  }
}

interface Recorded {
  wraps: RuntimeLaunch[];
  cleanups: RuntimeRun[];
}

function recordingRuntime(
  order: string[],
  rec: Recorded,
  over: Partial<BbRuntime> = {},
): RuntimePlugin {
  return {
    kind: 'runtime',
    id: 'recording',
    isolates: true,
    requiredModules: [],
    createRuntime: async () => ({
      id: 'recording',
      wrap: async (launch) => {
        order.push('wrap');
        rec.wraps.push(launch);
        return { command: 'WRAPPED', env: { ...launch.env, WRAPPED: '1' } };
      },
      cleanup: async (run) => {
        order.push('cleanup');
        rec.cleanups.push(run);
      },
      ...over,
    }),
  };
}

const agent = (
  seen: { tools?: string; prompt?: string },
  extension: Record<string, unknown> = {},
): BbAgent => ({
  id: 'claude',
  ...extension,
  launchCommand: (prompt, _run, _ws, tools) => {
    seen.prompt = prompt;
    if (tools) seen.tools = tools.url;
    return 'claude --go';
  },
  getRunLog: async () => '',
  parseFootprint: () => emptyAgentFootprint(),
});

function setup(
  runtimeOf?: RuntimePlugin | ((order: string[]) => RuntimePlugin),
  withTools = false,
  extension: Record<string, unknown> = {},
  instructions: string | null = null,
  clones = true,
) {
  const order: string[] = [];
  const runtime =
    typeof runtimeOf === 'function' ? runtimeOf(order) : runtimeOf;
  const remote = new FakeBbRemote({
    tickets: {
      't-1': {
        identifier: 'BB-1',
        title: 'One',
        state: 'working',
        branchName: BRANCH,
      },
    },
  });
  remote.queue.push({
    runUuid: 'r-uuid',
    runId: 7,
    ticketUuid: 't-1',
    stateAtStart: 'working',
    handler: 'code',
  });
  const executor = new Executor(order);
  const logs: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
  const mk = (obj: object, msg?: string) =>
    logs.push({ obj: obj as Record<string, unknown>, msg });
  const log: ConductorLogger = { debug: mk, info: mk, warn: mk, error: mk };
  const config = {
    site: { base_url: 'http://web', jsonapi_prefix: '/jsonapi' },
    remote: fakeRemote(),
    executor: fakeExecutor(),
    workspace: fakeWorkspace(),
    label: 'test',
    conductor_id: 'bakers-test-conductor',
    project: 'bakers',
    states: ['working'],
    prompt: DEFAULT_AGENT_PROMPT,
    host_key: 'test-host',
    poll_interval_ms: 5000,
    lease_seconds: 300,
    config_path: `${CHECKOUT}/conductor.config.js`,
    marketplaces: [],
    ...(runtime ? { runtime } : {}),
  } as unknown as ConductorFileConfig;
  const seen: { tools?: string; prompt?: string } = {};
  const selectedAgent = agent(seen, extension);
  const conductor = new TestConductor(
    config,
    remote,
    executor,
    new Workspace(instructions, clones && (runtime?.isolates ?? false)),
    [
      {
        id: 'claude',
        alias: 'opus',
        permissions: 'sandbox',
        agent: selectedAgent,
      },
    ],
    log,
    CHECKOUT,
  );
  const run = async (inspect?: () => Promise<void>, endpointFile?: string) => {
    if (withTools) {
      (config as { tools?: unknown }).tools = await loadTools([]);
      await conductor.startTools(endpointFile);
    }
    try {
      await conductor.start();
      await conductor.tick();
      await inspect?.();
    } finally {
      await conductor.stopTools();
    }
  };
  return {
    order,
    remote,
    executor,
    logs,
    seen,
    run,
    selectedAgent,
    config,
    conductor,
  };
}

describe('runtime slot — launch wrapping', () => {
  it('tells only a run in a clone how its commits travel and what is read-only', async () => {
    const runtime = recordingRuntime([], { wraps: [], cleanups: [] });
    const isolated = setup(runtime, false, {}, 'workflow');
    isolated.config.prompt = 'Project instructions.';
    isolated.config.readOnly = ['.ddev'];
    await isolated.run();
    expect(isolated.seen.prompt).toContain('Project instructions.');
    expect(isolated.seen.prompt).toContain('fresh clone of the ticket branch');
    expect(isolated.seen.prompt).toContain('Commit before you end');
    expect(isolated.seen.prompt).toContain(
      'forge_push transfers and pushes your commits',
    );
    expect(isolated.seen.prompt).toContain('Read-only here: .bakers, .ddev.');
    expect(isolated.seen.prompt).toContain(
      'a maintainer merges the target outside the run',
    );
    expect(isolated.seen.prompt).not.toContain('runtime_transfer_commit');

    const { hostRuntime } = await import('../../src/plugins/runtime.js');
    const host = setup(hostRuntime, false, {}, 'workflow');
    host.config.prompt = 'Project instructions.';
    await host.run();
    expect(host.seen.prompt).toBe('Project instructions.');

    const empty = setup(runtime);
    await empty.run();
    expect(empty.seen.prompt).toBe('');
  });

  it('wraps the launch before startRun', async () => {
    const rec: Recorded = { wraps: [], cleanups: [] };
    const s = setup(recordingRuntime([], rec), true);
    await s.run();
    expect(rec.wraps).toHaveLength(1);
    const launch = rec.wraps[0] as RuntimeLaunch;
    expect(launch.command).toBe('claude --go');
    expect(launch.workspacePath).toBe(worktree);
    expect(launch.gitDir).toBe(runCloneGitDir(worktree));
    expect(launch).not.toHaveProperty('sharedObjects');
    expect(existsSync(join(worktree, '.git'))).toBe(false);
    expect(launch.run).toEqual({ uuid: 'r-uuid', id: 7 });
    expect(launch.harness).toBe('claude');
    expect(launch.env.BAKERS_CONDUCTOR_TOKEN).toMatch(/.+/);
    const started = s.executor.started[0] as SpawnRunInput;
    expect(started.command).toBe('WRAPPED');
    expect(started.env.WRAPPED).toBe('1');
    const line = s.logs.find((l) => l.msg === 'dispatched run');
    expect(line?.obj.runtime).toBe('recording');
    expect(JSON.stringify(line?.obj)).not.toContain(
      launch.env.BAKERS_CONDUCTOR_TOKEN as string,
    );
  });

  it('prepares a neutral private home before building the launch', async () => {
    const rec: Recorded = { wraps: [], cleanups: [] };
    const s = setup(
      recordingRuntime([], rec, {
        prepareRun: async () => ({
          homePath: '/private/run',
          env: { MODEL_KEY: 'placeholder' },
        }),
      }),
      true,
      {
        installCommand: 'install-generic',
        prepareRun: (context: { homePath: string; workspacePath: string }) => {
          expect(context).toMatchObject({
            homePath: '/private/run',
            workspacePath: worktree,
          });
          return {
            env: { AGENT_HOME: context.homePath },
            readPaths: ['/shared/plugins'],
            writePaths: ['/shared/transcripts'],
          };
        },
      },
    );
    await s.run();
    expect(rec.wraps[0]).toMatchObject({
      homePath: '/private/run',
      readPaths: ['/shared/plugins', join(worktree, '.bakers')],
      writePaths: ['/shared/transcripts'],
      env: {
        AGENT_HOME: '/private/run',
        MODEL_KEY: 'placeholder',
        BAKERS_CONDUCTOR_TOKEN: expect.any(String),
      },
      installCommand: 'install-generic',
    });
    expect(rec.wraps[0]).not.toHaveProperty('agent');
  });

  it('passes the built-in and the project protected paths to an isolating runtime', async () => {
    const rec: Recorded = { wraps: [], cleanups: [] };
    const s = setup(recordingRuntime([], rec));
    s.config.readOnly = ['.ddev'];
    await s.run();
    expect(loadRunClone(worktree)?.protectedPaths).toEqual(['.ddev']);
    expect(rec.wraps[0]?.readPaths).toEqual([
      join(worktree, '.bakers'),
      join(worktree, '.ddev'),
    ]);
  });

  it.each([
    'missing',
    'escaping',
  ])('fails dispatch for a %s protected path', async (kind) => {
    const rec: Recorded = { wraps: [], cleanups: [] };
    if (kind === 'escaping') {
      symlinkSync(CHECKOUT, join(parent, 'host-script'));
      git(parent, 'add', 'host-script');
      git(parent, ...ident, 'commit', '-qm', 'link');
      git(parent, 'branch', '-f', BRANCH);
    }
    const s = setup(recordingRuntime([], rec));
    s.config.readOnly = ['host-script'];
    await s.run();
    expect(rec.wraps).toHaveLength(0);
    expect(s.executor.started).toHaveLength(0);
    expect(s.logs.some((line) => line.msg === 'dispatch failed')).toBe(true);
  });

  it('fails dispatch when the mandatory .bakers directory is missing', async () => {
    git(parent, 'rm', '-rq', '.bakers');
    git(parent, ...ident, 'commit', '-qm', 'no bakers');
    git(parent, 'branch', '-f', BRANCH);
    const rec: Recorded = { wraps: [], cleanups: [] };
    const s = setup(recordingRuntime([], rec));
    await s.run();
    expect(rec.wraps).toHaveLength(0);
    expect(s.executor.started).toHaveLength(0);
  });

  it('fails dispatch when an isolating runtime gets a workspace without a run clone', async () => {
    const rec: Recorded = { wraps: [], cleanups: [] };
    const s = setup(recordingRuntime([], rec), false, {}, null, false);
    await s.run();
    expect(rec.wraps).toHaveLength(0);
    expect(s.executor.started).toHaveLength(0);
    expect(
      s.logs.some((line) =>
        JSON.stringify(line.obj).includes('provides no run clone'),
      ),
    ).toBe(true);
  });

  it('tells hooks and the run the worktree path and that the runtime isolates', async () => {
    const rec: Recorded = { wraps: [], cleanups: [] };
    const s = setup(recordingRuntime([], rec));
    await s.run();
    expect(s.executor.hookEnv.before_run).toMatchObject({
      BAKERS_WORKTREE_PATH: worktree,
      BAKERS_RUNTIME_ISOLATES: '1',
    });
    expect(rec.wraps[0]?.env).toMatchObject({
      BAKERS_WORKTREE_PATH: worktree,
      BAKERS_RUNTIME_ISOLATES: '1',
    });
    const { hostRuntime } = await import('../../src/plugins/runtime.js');
    const host = setup(hostRuntime);
    await host.run();
    expect(
      (host.executor.started[0] as SpawnRunInput).env.BAKERS_RUNTIME_ISOLATES,
    ).toBe('0');
  });

  it('keeps protected filesystem mounts out of a host launch', async () => {
    const rec: Recorded = { wraps: [], cleanups: [] };
    const runtime: RuntimePlugin = {
      ...recordingRuntime([], rec),
      isolates: false,
    };
    await setup(runtime).run();
    expect(rec.wraps).toHaveLength(1);
    expect(rec.wraps[0]).not.toHaveProperty('readPaths');
  });

  it('cleans the allocated home when agent preparation fails', async () => {
    const rec: Recorded = { wraps: [], cleanups: [] };
    const s = setup(
      recordingRuntime([], rec, {
        prepareRun: async () => ({ homePath: '/private/run' }),
      }),
      false,
      {
        prepareRun: async () => {
          throw new Error('invalid settings');
        },
      },
    );
    await s.run();
    expect(s.executor.started).toHaveLength(0);
    expect(rec.wraps).toHaveLength(0);
    // One cleanup before dispatch, another after preparation fails.
    expect(rec.cleanups).toHaveLength(2);
  });

  it('uses toolsUrl for the agent and BAKERS_CONDUCTOR_URL', async () => {
    const rec: Recorded = { wraps: [], cleanups: [] };
    const s = setup(
      recordingRuntime([], rec, {
        toolsUrl: (url) => url.replace('127.0.0.1', 'proxy.invalid'),
      }),
      true,
    );
    await s.run();
    expect(s.seen.tools).toMatch(/^http:\/\/proxy\.invalid:\d+$/);
    expect(rec.wraps[0]?.env.BAKERS_CONDUCTOR_URL).toBe(s.seen.tools);
  });

  it('cleans up after cleanupRun at dispatch', async () => {
    const rec: Recorded = { wraps: [], cleanups: [] };
    const s = setup((order) => recordingRuntime(order, rec));
    await s.run();
    expect(s.order).toEqual(['cleanupRun', 'cleanup', 'wrap', 'startRun']);
    expect(rec.cleanups).toEqual([{ uuid: 'r-uuid', id: 7 }]);
  });

  it('fails the dispatch when wrap throws', async () => {
    const order: string[] = [];
    const s = setup(
      recordingRuntime(
        order,
        { wraps: [], cleanups: [] },
        {
          wrap: async () => {
            throw new Error('no docker');
          },
        },
      ),
    );
    await s.run();
    expect(s.executor.started).toHaveLength(0);
    expect(s.order).toContain('after_run');
  });

  it('host runtime passes the launch through unchanged', async () => {
    const plain = setup(undefined, true);
    await plain.run();
    const { hostRuntime } = await import('../../src/plugins/runtime.js');
    const host = setup(hostRuntime, true);
    await host.run();
    const strip = (i: SpawnRunInput) => ({
      ...i,
      env: {
        ...i.env,
        BAKERS_CONDUCTOR_TOKEN: '<t>',
        BAKERS_CONDUCTOR_URL: '<u>',
      },
    });
    expect(strip(host.executor.started[0] as SpawnRunInput)).toEqual(
      strip(plain.executor.started[0] as SpawnRunInput),
    );
    expect(host.logs.find((l) => l.msg === 'dispatched run')?.obj.runtime).toBe(
      'host',
    );
  });
});

describe('runtime slot — finalise cleanup', () => {
  function finalising(runtime: RuntimePlugin, order: string[]) {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'done',
          branchName: BRANCH,
        },
      },
      runs: [
        {
          runUuid: 'r-uuid',
          id: 7,
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: worktree,
          runLogStorageAllowed: true,
        },
      ],
    });
    const logs: string[] = [];
    const mk = (_obj: object, msg?: string) => logs.push(msg ?? '');
    const log: ConductorLogger = { debug: mk, info: mk, warn: mk, error: mk };
    const conductor = new TestConductor(
      {
        site: { base_url: 'http://web', jsonapi_prefix: '/jsonapi' },
        conductor_id: 'bakers-test-conductor',
        project: 'bakers',
        states: ['working'],
        prompt: DEFAULT_AGENT_PROMPT,
        host_key: 'test-host',
        config_path: `${CHECKOUT}/conductor.config.js`,
        marketplaces: [],
        runtime,
      } as unknown as ConductorFileConfig,
      remote,
      new Executor(order),
      new Workspace(),
      [
        {
          id: 'claude',
          alias: 'opus',
          permissions: 'sandbox',
          agent: agent({}),
        },
      ],
      log,
      CHECKOUT,
    );
    return { remote, logs, conductor };
  }

  it('cleans up after cleanupRun at finalise', async () => {
    const order: string[] = [];
    const rec: Recorded = { wraps: [], cleanups: [] };
    const f = finalising(recordingRuntime(order, rec), order);
    await f.conductor.start();
    await f.conductor.tick();
    const tail = order.filter((o) => o === 'cleanupRun' || o === 'cleanup');
    expect(tail).toEqual(['cleanupRun', 'cleanup']);
    expect(rec.cleanups).toEqual([{ uuid: 'r-uuid', id: 7 }]);
  });

  const commitInClone = (path = 'work.txt') => {
    const clone = createRunClone({
      parent,
      workspace: worktree,
      branch: BRANCH,
    });
    const run = (...args: string[]) =>
      git(
        worktree,
        `--git-dir=${clone.gitDir}`,
        `--work-tree=${worktree}`,
        ...args,
      );
    writeFileSync(join(worktree, path), 'run work');
    run('add', '-A');
    run(...ident, 'commit', '-qm', 'run work');
    return { clone, tip: run('rev-parse', 'HEAD') };
  };

  it('transfers the run commits to the ticket branch at finalise, without Git in the workspace', async () => {
    const { clone, tip } = commitInClone();
    const other = git(parent, 'rev-parse', 'main');
    const f = finalising(recordingRuntime([], { wraps: [], cleanups: [] }), []);
    await f.conductor.start();
    await f.conductor.tick();
    expect(git(parent, 'rev-parse', BRANCH)).toBe(tip);
    expect(git(parent, 'rev-parse', 'main')).toBe(other);
    expect(loadRunClone(worktree)?.expected).toBe(tip);
    expect(existsSync(join(worktree, '.git'))).toBe(false);
    expect(f.logs).not.toContain(
      'run commits not transferred to the ticket branch',
    );
    expect(clone.expected).not.toBe(tip);
  });

  it('logs a refused transfer and still finalises the run', async () => {
    const { clone } = commitInClone('.bakers/planted.sh');
    const f = finalising(recordingRuntime([], { wraps: [], cleanups: [] }), []);
    await f.conductor.start();
    await f.conductor.tick();
    expect(git(parent, 'rev-parse', BRANCH)).toBe(clone.expected);
    expect(f.logs).toContain(
      'run commits not transferred to the ticket branch',
    );
    expect(f.remote.calls.markFailed).toHaveLength(0);
  });

  it('a throwing cleanup is logged and does not fail finalise', async () => {
    const order: string[] = [];
    const f = finalising(
      recordingRuntime(
        order,
        { wraps: [], cleanups: [] },
        {
          cleanup: async () => {
            throw new Error('docker gone');
          },
        },
      ),
      order,
    );
    await f.conductor.start();
    await f.conductor.tick();
    expect(f.logs).toContain('runtime cleanup failed');
    expect(f.remote.calls.markFailed).toHaveLength(0);
  });
});
