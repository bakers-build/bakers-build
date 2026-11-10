import { claudeAgent } from '@bakers-build/addon-claude';
import {
  FakeBbRemote,
  type FakeRemoteSeed,
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
  HookContext,
  HookName,
  HookResult,
  SpawnRunInput,
  WorktreeTeardown,
} from '@bakers-build/conductor/contract';
import {
  DEFAULT_ENV_DENY,
  emptyAgentFootprint,
} from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';
import { resolveRunEnv } from '../../src/core/conductor.js';
import { loadTools } from '../../src/plugins/tools.js';
import { TestConductor } from '../test-conductor.js';

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

const fakeAgent: BbAgent = {
  id: 'claude',
  launchCommand: (p: string) => (p === '' ? 'claude' : `claude '${p}'`),
  getRunLog: async () => '',
  parseFootprint: () => emptyAgentFootprint(),
};

const CHECKOUT = '/tmp/bakers-conductor-env-checkout';

function makeConfig(
  overrides: Partial<ConductorFileConfig> = {},
): ConductorFileConfig {
  return {
    site: { base_url: 'http://web', jsonapi_prefix: '/jsonapi' },
    remote: fakeRemote(),
    executor: fakeExecutor(),
    agent: [{ agent: claudeAgent() }],
    workspace: fakeWorkspace(),
    label: 'test',
    conductor_id: 'bakers-test-conductor',
    project: 'bakers',
    states: ['todo', 'working'],
    prompt: DEFAULT_AGENT_PROMPT,
    // The budget lives on the fake machine row for this host (default 5).
    host_key: 'test-host',
    poll_interval_ms: 5000,
    lease_seconds: 300,
    config_path: `${CHECKOUT}/conductor.config.js`,
    ...overrides,
  };
}

/** Minimal fresh-worktree workspace (BB-84: no hooks — the executor owns them). */
class RecordingWorkspace implements BbWorkspace {
  async ensure(
    identifier: string,
    _branch?: string,
    _baseRef?: string,
  ): Promise<EnsuredWorkspace> {
    return { path: `/fake/${identifier}`, instructions: null, created: true };
  }
}

/** Records startRun inputs and every lifecycle-hook call's env (BB-84 sink). */
class RecordingExecutor implements BbExecutor {
  readonly id = 'recording';
  readonly started: SpawnRunInput[] = [];
  readonly hookCalls: Array<{ name: HookName; env?: Record<string, string> }> =
    [];
  capabilities() {
    return { persistent: false };
  }
  async runHook(
    name: HookName,
    _cwd: string,
    _ctx: HookContext,
    env?: Record<string, string>,
  ): Promise<HookResult> {
    this.hookCalls.push({ name, env });
    return { hook: name, ran: true, ok: true };
  }
  async startRun(input: SpawnRunInput) {
    this.started.push(input);
    return { sessionRef: input.ticket.branchName };
  }
  async stopRun(): Promise<void> {}
  async cleanupRun(): Promise<void> {}
  // Never called by these env tests, but the contract's return type is now
  // meaningful (BB-293): 'unverified' is the conservative answer — nothing
  // was torn down here.
  async removeWorktree(): Promise<WorktreeTeardown> {
    return 'unverified';
  }
}

describe('resolveRunEnv', () => {
  it('drops reserved keys, lets core vars win, never logs values', () => {
    const { log, calls } = spyLogger();
    const core = { BB_ID: 'real-uuid', WORKSPACE_ROOT: '/ws' };
    const env = resolveRunEnv(
      'APP_KEY=ok\nBB_ID=evil\nWORKSPACE_ROOT=/tmp',
      core,
      log,
    );
    expect(env).toEqual({
      APP_KEY: 'ok',
      BB_ID: 'real-uuid',
      WORKSPACE_ROOT: '/ws',
    });
    // A warning names the ignored reserved keys…
    const warned = calls.filter((c) => c.level === 'warn');
    const warnBlob = JSON.stringify(warned);
    expect(warnBlob).toContain('BB_ID');
    expect(warnBlob).toContain('WORKSPACE_ROOT');
    // …but no log line — at any level — contains a value.
    const allLogs = JSON.stringify(calls);
    expect(allLogs).not.toContain('evil');
    expect(allLogs).not.toContain('/tmp');
    expect(allLogs).not.toContain('ok');
  });

  it('returns just the core vars when there are no user env vars', () => {
    const { log } = spyLogger();
    expect(resolveRunEnv(undefined, { BB_ID: 'x' }, log)).toEqual({
      BB_ID: 'x',
    });
  });
});

describe('resolveRunEnv run-env policy', () => {
  const ticketVars =
    'ANTHROPIC_BASE_URL=http://evil\nNODE_OPTIONS=--require x\nGIT_CONFIG_COUNT=1\nHTTPS_PROXY=http://p\nFOO=bar';
  const core = { BB_ID: 'real-uuid' };
  const dangerous = [
    'ANTHROPIC_BASE_URL',
    'NODE_OPTIONS',
    'GIT_CONFIG_COUNT',
    'HTTPS_PROXY',
  ];

  it('drops names on the default deny list and names them, with the ticket, in one warning', () => {
    const { log, calls } = spyLogger();
    const env = resolveRunEnv(ticketVars, core, log, {
      ticket: 'BB-1',
      policy: { drop: true, deny: DEFAULT_ENV_DENY },
    });
    expect(env).toEqual({ FOO: 'bar', BB_ID: 'real-uuid' });
    const warned = calls.filter((c) => c.level === 'warn');
    expect(warned).toHaveLength(1);
    expect(warned[0]?.obj).toMatchObject({ ticket: 'BB-1', keys: dangerous });
    expect(JSON.stringify(calls)).not.toContain('evil');
  });

  it('keeps them when the policy does not drop (yolo), still warning', () => {
    const { log, calls } = spyLogger();
    const env = resolveRunEnv(ticketVars, core, log, {
      ticket: 'BB-1',
      policy: { drop: false, deny: DEFAULT_ENV_DENY },
    });
    expect(Object.keys(env)).toEqual([...dangerous, 'FOO', 'BB_ID']);
    const warned = calls.filter((c) => c.level === 'warn');
    expect(warned).toHaveLength(1);
    expect(warned[0]?.obj).toMatchObject({ ticket: 'BB-1', keys: dangerous });
  });

  it('passes everything without a warning for an empty deny list', () => {
    const { log, calls } = spyLogger();
    const env = resolveRunEnv(ticketVars, core, log, {
      ticket: 'BB-1',
      policy: { drop: true, deny: [] },
    });
    expect(Object.keys(env)).toEqual([...dangerous, 'FOO', 'BB_ID']);
    expect(calls.filter((c) => c.level === 'warn')).toHaveLength(0);
  });

  it('drops with the default list when no policy is given', () => {
    const { log } = spyLogger();
    expect(resolveRunEnv(ticketVars, core, log)).toEqual({
      FOO: 'bar',
      BB_ID: 'real-uuid',
    });
  });
});

describe('Conductor dispatch env injection', () => {
  it("hands the agent and its hooks the env filtered by the agent's policy", async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'working',
          effectiveEnvVars: 'LD_PRELOAD=/x.so\nAPP_KEY=ok',
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
    const executor = new RecordingExecutor();
    const { log } = spyLogger();
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      new RecordingWorkspace(),
      [{ id: fakeAgent.id, agent: fakeAgent }],
      log,
      CHECKOUT,
    );
    await conductor.start();
    await conductor.tick();
    const agentEnv = executor.started[0]?.env ?? {};
    expect(agentEnv.APP_KEY).toBe('ok');
    expect(agentEnv.LD_PRELOAD).toBeUndefined();
    const beforeRun = executor.hookCalls.find((c) => c.name === 'before_run');
    expect(beforeRun?.env?.LD_PRELOAD).toBeUndefined();
  });

  it('injects the resolved env into BOTH the agent run env and the lifecycle hooks', async () => {
    const seed: FakeRemoteSeed = {
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'working',
          effectiveEnvVars: 'APP_KEY=secretval\nBB_ID=evil',
        },
      },
    };
    const remote = new FakeBbRemote(seed);
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'working',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    const workspace = new RecordingWorkspace();
    const { log } = spyLogger();
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      workspace,
      [{ id: fakeAgent.id, agent: fakeAgent }],
      log,
      CHECKOUT,
    );
    await conductor.start();
    await conductor.tick();

    const agentEnv = executor.started[0]?.env ?? {};
    // Agent sink: user var present, reserved BB_ID is the real uuid (not 'evil').
    expect(agentEnv.APP_KEY).toBe('secretval');
    expect(agentEnv.BB_ID).toBe('t-1');
    // Hook sink (conductor-owned): after_create + before_run see the
    // SAME resolved env — reserved keys already stripped, core vars won.
    const afterCreate = executor.hookCalls.find(
      (c) => c.name === 'after_create',
    );
    const beforeRun = executor.hookCalls.find((c) => c.name === 'before_run');
    expect(afterCreate?.env?.APP_KEY).toBe('secretval');
    expect(afterCreate?.env?.BB_ID).toBe('t-1');
    expect(beforeRun?.env?.APP_KEY).toBe('secretval');
    expect(beforeRun?.env?.BB_ID).toBe('t-1');
  });

  // BB-495: the agent names the workspace on its own calls now, so it has
  // to know which one it is standing in and the full radius it may reach.
  it('exports project and workspace context to the run env', async () => {
    const seed: FakeRemoteSeed = {
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'working',
          projectId: 'project-uuid',
          projectName: 'Demo',
          workspaceId: 'ws-uuid',
          workspaceName: 'Acme',
        },
      },
    };
    const remote = new FakeBbRemote(seed);
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'working',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    const workspace = new RecordingWorkspace();
    const { log } = spyLogger();
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      workspace,
      [{ id: fakeAgent.id, agent: fakeAgent }],
      log,
      CHECKOUT,
    );
    await conductor.start();
    await conductor.tick();

    const env = executor.started[0]?.env ?? {};
    expect(env.BB_PROJECT).toBe('Demo');
    expect(env.BB_PROJECT_ID).toBe('project-uuid');
    expect(env.BB_WORKSPACE).toBe('Acme');
    expect(env.BB_WORKSPACE_ID).toBe('ws-uuid');
    expect(env.BB_WORKSPACE_IDS?.split(',')).toContain('ws-uuid');
  });

  it('exports BB_TUNNEL=1 when machine policy is true and ticket env cannot override it', async () => {
    const seed: FakeRemoteSeed = {
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'working',
          effectiveEnvVars: 'BB_TUNNEL=0',
        },
      },
    };
    const remote = new FakeBbRemote(seed);
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'working',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    const { log } = spyLogger();
    const conductor = new TestConductor(
      makeConfig({ tunnel: true }),
      remote,
      executor,
      new RecordingWorkspace(),
      [{ id: fakeAgent.id, agent: fakeAgent }],
      log,
      CHECKOUT,
    );
    await conductor.start();
    await conductor.tick();
    expect(executor.started[0]?.env?.BB_TUNNEL).toBe('1');
  });

  it('re-reads tunnel from the machine file for each run and keeps the last good value', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'working' },
        't-2': { identifier: 'BB-2', title: 'Two', state: 'working' },
        't-3': { identifier: 'BB-3', title: 'Three', state: 'working' },
      },
    });
    const executor = new RecordingExecutor();
    const { log, calls } = spyLogger();
    let machine: { machine_id?: string; tunnel?: boolean } = {
      machine_id: 'm-1',
    };
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      new RecordingWorkspace(),
      [{ id: fakeAgent.id, agent: fakeAgent }],
      log,
      CHECKOUT,
      undefined,
      undefined,
      async () => machine,
    );
    await conductor.start();
    const runFor = async (ticketUuid: string, n: number) => {
      remote.queue.push({
        runUuid: `r-${n}`,
        runId: n,
        ticketUuid,
        stateAtStart: 'working',
        handler: 'code',
      });
      await conductor.tick();
      return executor.started.at(-1)?.env?.BB_TUNNEL;
    };
    expect(await runFor('t-1', 1)).toBe('0');
    machine = { machine_id: 'm-1', tunnel: true };
    expect(await runFor('t-2', 2)).toBe('1');
    // A missing or broken file reads as {}: keep the last good value.
    machine = {};
    expect(await runFor('t-3', 3)).toBe('1');
    expect(
      calls.some((c) => c.level === 'warn' && /tunnel/.test(c.msg ?? '')),
    ).toBe(true);
  });

  it('exports BB_TUNNEL=0 when policy is absent and a parent 1 cannot leak in', async () => {
    const previous = process.env.BB_TUNNEL;
    process.env.BB_TUNNEL = '1';
    try {
      const seed: FakeRemoteSeed = {
        tickets: {
          't-1': {
            identifier: 'BB-1',
            title: 'One',
            state: 'working',
          },
        },
      };
      const remote = new FakeBbRemote(seed);
      remote.queue.push({
        runUuid: 'r-1',
        runId: 1,
        ticketUuid: 't-1',
        stateAtStart: 'working',
        handler: 'code',
      });
      const executor = new RecordingExecutor();
      const { log } = spyLogger();
      const conductor = new TestConductor(
        makeConfig(),
        remote,
        executor,
        new RecordingWorkspace(),
        [{ id: fakeAgent.id, agent: fakeAgent }],
        log,
        CHECKOUT,
      );
      await conductor.start();
      await conductor.tick();
      expect(executor.started[0]?.env?.BB_TUNNEL).toBe('0');
    } finally {
      if (previous === undefined) delete process.env.BB_TUNNEL;
      else process.env.BB_TUNNEL = previous;
    }
  });

  it('omits the workspace/project keys entirely when unresolved, rather than exporting them empty', async () => {
    const seed: FakeRemoteSeed = {
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'working' },
      },
    };
    const remote = new FakeBbRemote(seed);
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'working',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    const workspace = new RecordingWorkspace();
    const { log } = spyLogger();
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      workspace,
      [{ id: fakeAgent.id, agent: fakeAgent }],
      log,
      CHECKOUT,
    );
    await conductor.start();
    await conductor.tick();

    const env = executor.started[0]?.env ?? {};
    expect(env).not.toHaveProperty('BB_PROJECT');
    expect(env).not.toHaveProperty('BB_PROJECT_ID');
    expect(env).not.toHaveProperty('BB_WORKSPACE');
    expect(env).not.toHaveProperty('BB_WORKSPACE_ID');
  });
});

describe('Conductor workspace env', () => {
  it("adds the workspace backend's env to the agent and hook env, under the core vars", async () => {
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
    const workspace: BbWorkspace = {
      ensure: async (identifier) => ({
        path: `/fake/${identifier}`,
        instructions: null,
        created: true,
        env: { GIT_CONFIG_COUNT: '1', BB_ID: 'evil' },
      }),
    };
    const executor = new RecordingExecutor();
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      workspace,
      [{ id: fakeAgent.id, agent: fakeAgent }],
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();
    await conductor.tick();
    const env = executor.started[0]?.env ?? {};
    expect(env.GIT_CONFIG_COUNT).toBe('1');
    expect(env.BB_ID).toBe('t-1');
    const beforeRun = executor.hookCalls.find((c) => c.name === 'before_run');
    expect(beforeRun?.env?.GIT_CONFIG_COUNT).toBe('1');
  });

  it("hands the run guard the run's branch, worktree and log file", async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': {
          identifier: 'BB-1',
          title: 'One',
          state: 'working',
          branchName: 'feat/bb-1-one',
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
    const workspace: BbWorkspace = {
      ensure: async (identifier) => ({
        path: `/fake/${identifier}`,
        instructions: null,
        created: true,
        env: { BB_WORKTREE: '/evil', BB_BRANCH: 'main' },
      }),
    };
    const executor = new RecordingExecutor();
    const conductor = new TestConductor(
      makeConfig(),
      remote,
      executor,
      workspace,
      [{ id: fakeAgent.id, agent: fakeAgent }],
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.start();
    await conductor.tick();
    const env = executor.started[0]?.env ?? {};
    expect(env.BB_BRANCH).toBe('feat/bb-1-one');
    expect(env.BB_WORKTREE).toBe('/fake/BB-1');
    expect(env.BB_GUARD_LOG).toMatch(/runs\/r-1\.guard\.jsonl$/);
    expect(env.BB_GUARD_LOG?.startsWith('/fake/BB-1')).toBe(false);
  });
});

describe('Conductor agent tools', () => {
  async function dispatchOnce(
    withTools: boolean,
    agentWithholds = false,
    siteTools?: FakeBbRemote['siteTools'],
  ) {
    const remote = new FakeBbRemote({
      tickets: {
        't-1': { identifier: 'BB-1', title: 'One', state: 'working' },
      },
    });
    if (siteTools) remote.siteTools = siteTools;
    remote.queue.push({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'working',
      handler: 'code',
    });
    const executor = new RecordingExecutor();
    const launched: unknown[] = [];
    const agent: BbAgent = {
      ...fakeAgent,
      ...(agentWithholds ? { withoutConductorTools: true } : {}),
      launchCommand: (_p, _run, _ws, tools) => {
        launched.push(tools);
        return 'claude';
      },
    };
    const tools = await loadTools([
      {
        name: 'demo',
        version: '1.0.0',
        tools: {
          contract: 1,
          tools: { where: { description: 'Where am I' } },
          handlers: async () => ({
            where: async (req) => ({ text: req.worktreePath }),
          }),
        },
      },
    ]);
    const conductor = new TestConductor(
      makeConfig(withTools ? { tools } : {}),
      remote,
      executor,
      new RecordingWorkspace(),
      [{ id: agent.id, agent }],
      spyLogger().log,
      CHECKOUT,
    );
    await conductor.startTools();
    await conductor.start();
    await conductor.tick();
    return { conductor, env: executor.started[0]?.env ?? {}, launched };
  }

  it('hands each run the tool server URL and a token bound to its worktree', async () => {
    const { conductor, env, launched } = await dispatchOnce(true);
    const url = (launched[0] as { url: string }).url;
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(env.BB_CONDUCTOR_URL).toBe(url);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: {
          headers: { authorization: `Bearer ${env.BB_CONDUCTOR_TOKEN}` },
        },
      }),
    );
    const result = await client.callTool({ name: 'where', arguments: {} });
    expect(result.content).toEqual([{ type: 'text', text: '/fake/BB-1' }]);
    await client.close();
    await conductor.stopTools();
  });

  it('serves the site tools to a run even when no addon declares tools, and hands it no site credential', async () => {
    const siteTools = {
      list: async () => [
        { name: 'tool_api__bakers_user_read', inputSchema: { type: 'object' } },
      ],
      call: async () => ({ content: [] }),
      close: async () => {},
    };
    const { conductor, env, launched } = await dispatchOnce(
      false,
      false,
      siteTools,
    );
    const url = (launched[0] as { url: string }).url;
    expect(env.BB_CONDUCTOR_URL).toBe(url);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: {
          headers: { authorization: `Bearer ${env.BB_CONDUCTOR_TOKEN}` },
        },
      }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['bakers_user_read']);
    await client.close();
    // The run's only credential is its run token.
    expect(
      Object.keys(env).filter((k) => /TOKEN|SECRET|AUTH|PASSWORD/i.test(k)),
    ).toEqual(['BB_CONDUCTOR_TOKEN']);
    await conductor.stopTools();
  });

  it('offers no tools to a run when no addon declares any', async () => {
    const { conductor, env, launched } = await dispatchOnce(false);
    expect(launched).toEqual([undefined]);
    expect(env.BB_CONDUCTOR_TOKEN).toBeUndefined();
    expect(env.BB_CONDUCTOR_URL).toBeUndefined();
    await conductor.stopTools();
  });

  it('offers no tools to a run whose agent withholds them, like a measured claude run', async () => {
    const { conductor, env, launched } = await dispatchOnce(true, true);
    expect(launched).toEqual([undefined]);
    expect(env.BB_CONDUCTOR_TOKEN).toBeUndefined();
    expect(env.BB_CONDUCTOR_URL).toBeUndefined();
    await conductor.stopTools();
  });
});
