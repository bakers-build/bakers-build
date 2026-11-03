import { parseClaudeTranscript } from '@bakers-build/addon-claude';
import {
  FakeBbRemote,
  FakeExecutor,
  FakeWorkspace,
  fakeExecutor,
  fakeRemote,
  fakeWorkspace,
} from '@bakers-build/addon-fake';
import type {
  BbAgent,
  ConductorFileConfig,
  SandboxPreflight,
} from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';
import { Conductor } from '../../src/core/conductor.js';

const MISSING: SandboxPreflight = {
  ok: false,
  cause: 'socat not found',
  fix: 'install it with sudo apt-get install -y socat',
};

/** An agent whose preflight answers from `results`, one per call, the last repeating. */
function agentWith(results: SandboxPreflight[]) {
  let calls = 0;
  const agent: BbAgent = {
    id: 'claude',
    launchCommand: () => 'claude',
    getRunLog: async () => '',
    parseFootprint: parseClaudeTranscript,
    sandboxPreflight: async () =>
      results[Math.min(calls++, results.length - 1)] as SandboxPreflight,
  };
  return agent;
}

function setup(agent: BbAgent) {
  const logs: { level: string; msg?: string }[] = [];
  const mk = (level: string) => (_obj: object, msg?: string) => {
    logs.push({ level, msg });
  };
  const log: ConductorLogger = {
    debug: mk('debug'),
    info: mk('info'),
    warn: mk('warn'),
    error: mk('error'),
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
  const workspace = new FakeWorkspace();
  let ensured = 0;
  const ensure = workspace.ensure.bind(workspace);
  workspace.ensure = (...args) => {
    ensured += 1;
    return ensure(...args);
  };
  const executor = new FakeExecutor({ outcome: 'exited' });
  const config: ConductorFileConfig = {
    site: { base_url: 'http://web', jsonapi_prefix: '/jsonapi' },
    remote: fakeRemote(),
    executor: fakeExecutor(),
    agent: [],
    workspace: fakeWorkspace(),
    label: 'test',
    conductor_id: 'bakers-test-conductor',
    project: 'bakers',
    states: ['todo'],
    prompt: DEFAULT_AGENT_PROMPT,
    max_parallel: 1,
    host_key: 'test-box',
    poll_interval_ms: 5000,
    lease_seconds: 300,
    config_path: '/tmp/bakers-preflight-test/conductor.config.js',
  };
  const conductor = new Conductor(
    config,
    remote,
    executor,
    workspace,
    [{ id: 'claude', agent }],
    log,
    '/tmp/bakers-preflight-test',
  );
  return { conductor, remote, logs, ensured: () => ensured };
}

const SANDBOX_LINE =
  'sandbox unavailable: claude: socat not found — install it with sudo apt-get install -y socat (see https://bakers.build/docs/advanced/run-security#sandbox-prerequisites)';

describe('sandbox preflight gate', () => {
  it('start logs the unavailable sandbox at error', async () => {
    const { conductor, logs } = setup(agentWith([MISSING]));
    await conductor.start();
    expect(logs).toContainEqual({ level: 'error', msg: SANDBOX_LINE });
  });

  it('a tick withholds claims while the sandbox cannot start, then claims after the fix', async () => {
    const { conductor, remote, logs } = setup(
      agentWith([MISSING, MISSING, { ok: true }]),
    );
    await conductor.start();
    await remote.setConductorStatus(conductor.id, 'offline');
    await conductor.tick();
    expect(await remote.getConductorStatus(conductor.id)).toBe('online'); // heartbeat still sent
    expect(remote.queue).toHaveLength(1);
    expect(remote.calls.markRunning).toEqual([]);
    expect(remote.calls.markFailed).toEqual([]);
    expect(logs).toContainEqual({
      level: 'warn',
      msg: `claims withheld: ${SANDBOX_LINE}`,
    });

    await conductor.tick();
    expect(remote.queue).toHaveLength(0);
    expect(remote.calls.markRunning[0]).toMatchObject({ runUuid: 'r-1' });
  });

  it('a tick at capacity does not probe the sandbox', async () => {
    let probes = 0;
    const agent = agentWith([MISSING]);
    const probe = agent.sandboxPreflight!;
    agent.sandboxPreflight = () => {
      probes += 1;
      return probe();
    };
    const { conductor, remote, logs } = setup(agent);
    await conductor.start();
    remote.seedMachineLoad('test-box', { currentLoad: 1 }); // a peer fills the budget of 1
    probes = 0;
    await conductor.tick();
    expect(probes).toBe(0);
    expect(logs.some((l) => l.msg?.startsWith('claims withheld'))).toBe(false);
  });

  it('dispatch re-checks the resolved agent and fails the run without a worktree or launch', async () => {
    // ok at start and at the tick's gate, unavailable by dispatch.
    const { conductor, remote, ensured } = setup(
      agentWith([{ ok: true }, { ok: true }, MISSING]),
    );
    await conductor.start();
    await conductor.tick();
    expect(remote.calls.markFailed).toEqual([
      { runUuid: 'r-1', errorLog: `Error: ${SANDBOX_LINE}` },
    ]);
    expect(remote.calls.markRunning).toEqual([]);
    expect(ensured()).toBe(0);
  });

  it('agents without a preflight claim and launch as before', async () => {
    const { sandboxPreflight: _, ...plain } = agentWith([MISSING]);
    const { conductor, remote } = setup(plain as BbAgent);
    await conductor.start();
    await conductor.tick();
    expect(remote.calls.markRunning[0]).toMatchObject({ runUuid: 'r-1' });
  });
});
