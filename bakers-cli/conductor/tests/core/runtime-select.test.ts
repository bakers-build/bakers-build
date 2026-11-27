import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  BbWorkspace,
  ConductorFileConfig,
  EnsuredWorkspace,
  HookResult,
  RuntimePlugin,
  SpawnRunInput,
  WorktreeTeardown,
} from '@bakers-build/conductor/contract';
import { emptyAgentFootprint } from '@bakers-build/conductor/contract';
import { type ConductorLogger, createRunClone } from '@bakers-build/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';
import { hostRuntime } from '../../src/plugins/runtime.js';
import type { SlotCatalog } from '../../src/plugins/slot-catalog.js';
import { TestConductor } from '../test-conductor.js';

let root: string;
let cacheHome: string | undefined;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bakers-runtime-select-'));
  const parent = join(root, 'parent');
  mkdirSync(join(parent, '.bakers'), { recursive: true });
  git(parent, 'init', '-q', '-b', 'main');
  writeFileSync(join(parent, '.bakers/keep'), '');
  git(parent, 'add', '.');
  git(
    parent,
    ...['-c', 'user.name=t', '-c', 'user.email=t@t'],
    'commit',
    '-qm',
    'base',
  );
  cacheHome = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = join(root, 'cache');
});
afterEach(() => {
  if (cacheHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = cacheHome;
  rmSync(root, { recursive: true, force: true });
});

/** A run clone when the call asks for one, else a plain directory. */
class Workspace implements BbWorkspace {
  readonly clones: Record<string, boolean | undefined> = {};
  readonly shares: Record<string, boolean | undefined> = {};
  async ensure(
    identifier: string,
    branch: string,
    _baseRef?: string,
    options?: { clone?: boolean; shared?: boolean },
  ): Promise<EnsuredWorkspace> {
    this.clones[identifier] = options?.clone;
    this.shares[identifier] = options?.shared;
    const parent = join(root, 'parent');
    const workspace = join(root, identifier);
    if (!options?.clone) {
      mkdirSync(workspace, { recursive: true });
      return { path: workspace, instructions: null, created: false };
    }
    git(parent, 'branch', '-f', branch);
    const clone = createRunClone({ parent, workspace, branch });
    return { path: workspace, instructions: null, created: false, clone };
  }
}

/** A workspace whose ensure fails, after the runtime was chosen. */
class BrokenWorkspace extends Workspace {
  override async ensure(): Promise<EnsuredWorkspace> {
    throw new Error('ensure failed');
  }
}

class Executor implements BbExecutor {
  readonly id = 'recording';
  readonly started: SpawnRunInput[] = [];
  capabilities() {
    return { persistent: false };
  }
  async runHook(name: never): Promise<HookResult> {
    return { hook: name, ran: true, ok: true };
  }
  async startRun(input: SpawnRunInput) {
    this.started.push(input);
    return { sessionRef: input.ticket.branchName };
  }
  async stopRun(): Promise<void> {}
  async cleanupRun(): Promise<void> {}
  async removeWorktree(): Promise<WorktreeTeardown> {
    return 'unverified';
  }
}

/** An isolating runtime that counts its instances. */
function boxRuntime(built: string[], shared?: boolean): RuntimePlugin {
  return {
    ...(shared === undefined ? {} : { shared }),
    kind: 'runtime',
    id: 'box',
    isolates: true,
    requiredModules: [],
    createRuntime: async () => {
      built.push('box');
      return {
        id: 'box',
        wrap: async ({ command, env }) => ({ command, env }),
        cleanup: async () => {},
      };
    },
  };
}

const agent: BbAgent = {
  id: 'claude',
  prepareRun: () => ({ env: {}, readPaths: [], writePaths: [] }),
  launchCommand: () => 'claude --go',
  getRunLog: async () => '',
  parseFootprint: () => emptyAgentFootprint(),
};

type Seed = {
  identifier: string;
  state?: string;
  stateAtStart?: string;
  labels?: string[];
  conductorOwner?: string;
};

function setup(
  catalog: Partial<SlotCatalog<RuntimePlugin>>,
  tickets: Seed[],
  allowUnsandboxed?: boolean,
  agentSelect?: SlotCatalog<unknown>['select'],
  opts: {
    workspace?: Workspace;
    agent?: BbAgent;
    isolation?: Map<string, boolean>;
    boxShared?: boolean;
  } = {},
) {
  const built: string[] = [];
  const remote = new FakeBbRemote({
    tickets: Object.fromEntries(
      tickets.map((t) => [
        t.identifier,
        {
          identifier: t.identifier,
          title: t.identifier,
          state: t.state ?? 'working',
          branchName: `bakers/${t.identifier.toLowerCase()}`,
          labels: t.labels ?? [],
          ...(t.conductorOwner ? { conductorOwner: t.conductorOwner } : {}),
        },
      ]),
    ),
  });
  remote.queue.push(
    ...tickets.map((t, index) => ({
      runUuid: `run-${t.identifier}`,
      runId: index + 1,
      ticketUuid: t.identifier,
      stateAtStart: t.stateAtStart ?? t.state ?? 'working',
      handler: 'code' as const,
    })),
  );
  const comments: Array<Record<string, unknown>> = [];
  let failComment = false;
  remote.siteTools = {
    list: async () => [],
    call: async (name, args) => {
      if (failComment) throw new Error('comment down');
      comments.push({ name, ...args });
      return { content: [] };
    },
    close: async () => {},
  };
  const executor = new Executor();
  const logs: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
  const mk = (obj: object, msg?: string) =>
    logs.push({ obj: obj as Record<string, unknown>, msg });
  const log: ConductorLogger = { debug: mk, info: mk, warn: mk, error: mk };
  const box = boxRuntime(built, opts.boxShared);
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
    config_path: `${root}/conductor.config.js`,
    marketplaces: [],
    runtime: box,
    ...(opts.isolation ? { runtime_isolation: opts.isolation } : {}),
    ...(allowUnsandboxed !== undefined
      ? { allow_unsandboxed: allowUnsandboxed }
      : {}),
    catalogs: {
      ...(agentSelect
        ? {
            agent: {
              slot: 'agent',
              entries: { opus: {}, fast: {} },
              default: 'opus',
              routes: {},
              select: agentSelect,
            },
          }
        : {}),
      runtime: {
        slot: 'runtime',
        entries: { box, system: hostRuntime },
        default: 'box',
        routes: {},
        fallback: 'system',
        ...catalog,
      },
    },
  } as unknown as ConductorFileConfig;
  const workspace = opts.workspace ?? new Workspace();
  const a = opts.agent ?? agent;
  const conductor = new TestConductor(
    config,
    remote,
    executor,
    workspace,
    [
      { id: 'claude', alias: 'opus', permissions: 'sandbox', agent: a },
      { id: 'claude', alias: 'fast', permissions: 'sandbox', agent: a },
    ],
    log,
    root,
  );
  const run = async () => {
    await conductor.start();
    await conductor.tick();
  };
  const dispatched = (identifier: string) =>
    logs.find((l) => l.msg === 'dispatched run' && l.obj.ticket === identifier)
      ?.obj;
  const envOf = (identifier: string) =>
    executor.started.find((s) => s.ticket.identifier === identifier)?.env;
  const runRuntimes = () =>
    (conductor as unknown as { runRuntimes: Map<string, string> }).runRuntimes;
  return {
    run,
    remote,
    logs,
    built,
    dispatched,
    envOf,
    workspace,
    runRuntimes,
    conductor,
    comments,
    failComments: () => {
      failComment = true;
    },
  };
}

describe('runtime chosen per ticket', () => {
  it('follows the machine route for the ticket state', async () => {
    const s = setup(
      { preset: 'box', routes: { default: { review: 'system' } } },
      [
        { identifier: 'BB-1', state: 'review' },
        { identifier: 'BB-2', state: 'working' },
      ],
    );
    await s.run();
    expect(s.dispatched('BB-1')).toMatchObject({
      runtime: 'host',
      runtimeAlias: 'system',
      runtimeReason: 'route',
    });
    expect(s.envOf('BB-1')?.BAKERS_RUNTIME_ISOLATES).toBe('0');
    expect(s.dispatched('BB-2')).toMatchObject({
      runtime: 'box',
      runtimeAlias: 'box',
      runtimeReason: 'preset',
    });
    expect(s.envOf('BB-2')?.BAKERS_RUNTIME_ISOLATES).toBe('1');
  });

  it("routes by the run's stateAtStart, not a stale ticket state", async () => {
    const s = setup(
      { preset: 'box', routes: { default: { review: 'system' } } },
      [{ identifier: 'BB-1', state: 'working', stateAtStart: 'review' }],
    );
    await s.run();
    expect(s.dispatched('BB-1')).toMatchObject({
      state: 'review',
      runtimeAlias: 'system',
      runtimeReason: 'route',
    });
  });

  it('takes a runtime:<alias> label naming an isolating entry', async () => {
    const s = setup({ fallback: 'system', default: 'system' }, [
      { identifier: 'BB-1', labels: ['runtime:box'] },
    ]);
    await s.run();
    expect(s.dispatched('BB-1')).toMatchObject({
      runtimeAlias: 'box',
      runtimeReason: 'label',
    });
  });

  it('lets the machine select function choose', async () => {
    const s = setup(
      {
        preset: 'box',
        select: (candidates, ticket) => {
          expect(candidates.sort()).toEqual(['box', 'system']);
          return ticket.identifier === 'BB-1' ? 'system' : 'box';
        },
      },
      [{ identifier: 'BB-1' }, { identifier: 'BB-2' }],
    );
    await s.run();
    expect(s.dispatched('BB-1')).toMatchObject({
      runtimeAlias: 'system',
      runtimeReason: 'function',
    });
    expect(s.dispatched('BB-2')).toMatchObject({
      runtimeAlias: 'box',
      runtimeReason: 'function',
    });
  });

  it('ignores a label choosing a non-isolating entry without allow_unsandboxed and warns', async () => {
    const s = setup({ preset: 'box' }, [
      { identifier: 'BB-1', labels: ['runtime:system'] },
    ]);
    await s.run();
    expect(s.dispatched('BB-1')).toMatchObject({
      runtimeAlias: 'box',
      runtimeReason: 'preset',
    });
    const warning = s.logs.find(
      (l) => typeof l.msg === 'string' && l.msg.includes("'system'"),
    );
    expect(warning?.msg).toBe(
      "BB-1: runtime label 'system' chooses runtime 'system', which does not isolate runs; ignored (set allow_unsandboxed to allow it)",
    );
    expect(warning?.obj.ticket).toBe('BB-1');

    const allowed = setup(
      { preset: 'box' },
      [{ identifier: 'BB-1', labels: ['runtime:system'] }],
      true,
    );
    await allowed.run();
    expect(allowed.dispatched('BB-1')).toMatchObject({
      runtimeAlias: 'system',
      runtimeReason: 'label',
    });
  });

  it('fails the run on an unknown runtime label alias', async () => {
    const s = setup({ preset: 'box' }, [
      { identifier: 'BB-1', labels: ['runtime:nope'] },
      { identifier: 'BB-2', labels: ['runtime:'] },
    ]);
    await s.run();
    expect(s.dispatched('BB-1')).toBeUndefined();
    expect(s.remote.calls.markFailed).toEqual([
      expect.objectContaining({
        runUuid: 'run-BB-1',
        errorLog: expect.stringContaining("unknown alias 'nope'"),
      }),
      expect.objectContaining({
        runUuid: 'run-BB-2',
        errorLog: expect.stringContaining("malformed runtime label 'runtime:'"),
      }),
    ]);
  });

  it('builds one runtime instance per alias', async () => {
    const s = setup({ preset: 'box' }, [
      { identifier: 'BB-1' },
      { identifier: 'BB-2' },
      { identifier: 'BB-3' },
    ]);
    await s.run();
    expect(s.dispatched('BB-3')).toMatchObject({ runtimeAlias: 'box' });
    expect(s.built).toEqual(['box']);
  });

  it('picks the agent through the machine agents select', async () => {
    const s = setup(
      { preset: 'box' },
      [{ identifier: 'BB-1' }],
      undefined,
      () => 'fast',
    );
    await s.run();
    expect(s.dispatched('BB-1')).toMatchObject({ alias: 'fast' });
    const plain = setup({ preset: 'box' }, [{ identifier: 'BB-1' }]);
    await plain.run();
    expect(plain.dispatched('BB-1')).toMatchObject({ alias: 'opus' });
  });

  it('clones the workspace per run when the run runtime isolates', async () => {
    const hostDefault = setup({ default: 'system', fallback: 'system' }, [
      { identifier: 'BB-1', labels: ['runtime:box'] },
      { identifier: 'BB-2' },
    ]);
    await hostDefault.run();
    expect(hostDefault.dispatched('BB-1')).toMatchObject({
      runtimeAlias: 'box',
    });
    expect(hostDefault.workspace.clones).toEqual({
      'BB-1': true,
      'BB-2': false,
    });

    const boxDefault = setup(
      { preset: 'box' },
      [{ identifier: 'BB-1', labels: ['runtime:system'] }],
      true,
    );
    await boxDefault.run();
    expect(boxDefault.dispatched('BB-1')).toMatchObject({
      runtimeAlias: 'system',
    });
    expect(boxDefault.workspace.clones).toEqual({ 'BB-1': false });
  });

  it('shares the run clone objects per the run runtime', async () => {
    const s = setup(
      { default: 'system', fallback: 'system' },
      [{ identifier: 'BB-1', labels: ['runtime:box'] }, { identifier: 'BB-2' }],
      undefined,
      undefined,
      { boxShared: true },
    );
    await s.run();
    expect(s.workspace.shares).toEqual({ 'BB-1': true, 'BB-2': undefined });

    const plain = setup({ preset: 'box' }, [{ identifier: 'BB-1' }]);
    await plain.run();
    expect(plain.workspace.shares).toEqual({ 'BB-1': undefined });
  });

  it('drops the run runtime choice when dispatch fails before the launch', async () => {
    const s = setup(
      { preset: 'box' },
      [{ identifier: 'BB-1' }],
      undefined,
      undefined,
      {
        workspace: new BrokenWorkspace(),
      },
    );
    await s.run();
    expect(s.remote.calls.markFailed).toEqual([
      expect.objectContaining({
        errorLog: expect.stringContaining('ensure failed'),
      }),
    ]);
    expect(s.runRuntimes().size).toBe(0);
  });

  it('drops the worktree isolation entry when the dispatch fails', async () => {
    const isolation = new Map<string, boolean>();
    const { prepareRun: _, ...noPrepare } = agent;
    const s = setup(
      { preset: 'box' },
      [{ identifier: 'BB-1' }],
      undefined,
      undefined,
      {
        agent: noPrepare,
        isolation,
      },
    );
    await s.run();
    expect(s.remote.calls.markFailed).toEqual([
      expect.objectContaining({
        errorLog: expect.stringContaining('no prepareRun'),
      }),
    ]);
    expect(isolation.size).toBe(0);
  });
});

describe('after a conductor restart', () => {
  it('reads an in-flight run isolation from its run clone, not the default runtime', async () => {
    const s = setup(
      { preset: 'box' },
      [
        { identifier: 'BB-1', labels: ['runtime:system'] },
        { identifier: 'BB-2' },
      ],
      true,
    );
    await s.run();
    // A restarted process knows no run's runtime.
    s.runRuntimes().clear();
    const isolates = async (identifier: string) => {
      const ctx = await (
        s.conductor as unknown as {
          listenerContext(
            ticketUuid: string,
            worktreePath: string,
            opts: { hook: string; run: { uuid: string } },
          ): Promise<{ env: Record<string, string> } | undefined>;
        }
      ).listenerContext(
        identifier,
        String(s.envOf(identifier)?.BAKERS_WORKTREE_PATH),
        { hook: 'after_run', run: { uuid: `run-${identifier}` } },
      );
      return ctx?.env.BAKERS_RUNTIME_ISOLATES;
    };
    expect(await isolates('BB-1')).toBe('0');
    expect(await isolates('BB-2')).toBe('1');
  });
});

describe('run record and unsandboxed comment', () => {
  it('notes agent, runtime and owner on the run and the dispatch log', async () => {
    const s = setup(
      { preset: 'box' },
      [{ identifier: 'BB-1', conductorOwner: 'Ada' }],
      undefined,
      () => 'fast',
    );
    await s.run();
    expect(s.remote.calls.appendRunNote).toContainEqual({
      runUuid: 'run-BB-1',
      note: 'agent fast (function); runtime box (preset); conductor owner Ada',
    });
    expect(s.dispatched('BB-1')).toMatchObject({
      agentReason: 'function',
      conductorOwner: 'Ada',
    });
  });

  it('writes conductor owner unknown and derives the agent reason without a select', async () => {
    const s = setup({ preset: 'box' }, [
      { identifier: 'BB-1', labels: ['agent:fast'] },
    ]);
    await s.run();
    expect(s.remote.calls.appendRunNote[0]?.note).toBe(
      'agent fast (label); runtime box (preset); conductor owner unknown',
    );
  });

  it('comments once on a label-chosen unsandboxed run', async () => {
    const s = setup(
      { preset: 'box' },
      [
        {
          identifier: 'BB-1',
          labels: ['runtime:system'],
          conductorOwner: 'Ada',
        },
      ],
      true,
    );
    await s.run();
    expect(s.comments).toHaveLength(1);
    expect(s.comments[0]).toMatchObject({
      name: 'bakers_comment_create',
      ticket: 'BB-1',
      type: 'comment',
    });
    const body = String(s.comments[0]?.body);
    for (const part of ['system', 'unsandboxed', 'runtime:system', 'Ada'])
      expect(body).toContain(part);
  });

  it('names the route label that chose the unsandboxed runtime', async () => {
    const s = setup(
      { preset: 'box', routes: { host: { '*': 'system' } } },
      [{ identifier: 'BB-1', labels: ['runtime:host'] }],
      true,
    );
    await s.run();
    expect(String(s.comments[0]?.body)).toContain(
      "runtime 'system', chosen by the label runtime:host;",
    );
  });

  it('does not comment on a host-default run or a label-chosen isolating run', async () => {
    const s = setup({ fallback: 'system', default: 'system' }, [
      { identifier: 'BB-1' },
      { identifier: 'BB-2', labels: ['runtime:box'] },
    ]);
    await s.run();
    expect(s.comments).toEqual([]);
  });

  it('logs a failed comment and still dispatches the run', async () => {
    const s = setup(
      { preset: 'box' },
      [{ identifier: 'BB-1', labels: ['runtime:system'] }],
      true,
    );
    s.failComments();
    await s.run();
    expect(s.dispatched('BB-1')).toBeDefined();
    expect(s.logs.some((l) => l.msg === 'unsandboxed comment failed')).toBe(
      true,
    );
  });
});
