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
import type { ConductorLogger } from '@bakers-build/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';
import { loadTools } from '../../src/plugins/tools.js';
import { TestConductor } from '../test-conductor.js';

const CHECKOUT = '/tmp/bakers-runtime-checkout';

class Workspace implements BbWorkspace {
  async ensure(): Promise<EnsuredWorkspace> {
    return { path: '/fake/BB-1', instructions: null, created: false };
  }
}

class Executor implements BbExecutor {
  readonly id = 'recording';
  readonly started: SpawnRunInput[] = [];
  constructor(private readonly order: string[]) {}
  capabilities() {
    return { persistent: false };
  }
  async runHook(name: HookName): Promise<HookResult> {
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
  seen: { tools?: string },
  extension: Record<string, unknown> = {},
): BbAgent => ({
  id: 'claude',
  ...extension,
  launchCommand: (_p, _run, _ws, tools) => {
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
        branchName: 'bakers/bb-1-one',
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
  const seen: { tools?: string } = {};
  const selectedAgent = agent(seen, extension);
  const conductor = new TestConductor(
    config,
    remote,
    executor,
    new Workspace(),
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
  const run = async () => {
    if (withTools) {
      (config as { tools?: unknown }).tools = await loadTools([]);
      await conductor.startTools();
    }
    await conductor.start();
    await conductor.tick();
    await conductor.stopTools();
  };
  return { order, remote, executor, logs, seen, run, selectedAgent };
}

describe('runtime slot — launch wrapping', () => {
  it('wraps the launch before startRun', async () => {
    const rec: Recorded = { wraps: [], cleanups: [] };
    const s = setup(recordingRuntime([], rec), true);
    await s.run();
    expect(rec.wraps).toHaveLength(1);
    const launch = rec.wraps[0] as RuntimeLaunch;
    expect(launch.command).toBe('claude --go');
    expect(launch.workspacePath).toBe('/fake/BB-1');
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
            workspacePath: '/fake/BB-1',
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
      readPaths: ['/shared/plugins'],
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
          branchName: 'bakers/bb-1-one',
        },
      },
      runs: [
        {
          runUuid: 'r-uuid',
          id: 7,
          ticketUuid: 't-1',
          stateAtStart: 'review',
          state: 'done',
          worktreePath: '/wt/r-uuid',
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
