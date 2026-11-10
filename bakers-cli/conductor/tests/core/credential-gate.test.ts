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
  AgentCredentialCheck,
  BbAgent,
  ConductorFileConfig,
} from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';
import { Conductor } from '../../src/core/conductor.js';

const LOGGED_OUT: AgentCredentialCheck = {
  ok: false,
  reason: 'claude: not logged in — run claude /login',
};

/** An agent whose credential check answers from `results`, the last repeating. */
function agentWith(id: string, results: AgentCredentialCheck[]): BbAgent {
  let calls = 0;
  return {
    id,
    launchCommand: () => id,
    getRunLog: async () => '',
    parseFootprint: parseClaudeTranscript,
    credentialCheck: async () =>
      results[Math.min(calls++, results.length - 1)] as AgentCredentialCheck,
  };
}

function setup(agents: BbAgent[], runs = 1, authFailure?: string) {
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
    tickets: {
      't-1': { identifier: 'BB-1', title: 'One', state: 'todo' },
      't-2': { identifier: 'BB-2', title: 'Two', state: 'todo' },
    },
  });
  for (let i = 1; i <= runs; i++) {
    remote.queue.push({
      runUuid: `r-${i}`,
      runId: i,
      ticketUuid: `t-${i}`,
      stateAtStart: 'todo',
      handler: 'code',
    });
  }
  const workspace = new FakeWorkspace();
  let ensured = 0;
  const ensure = workspace.ensure.bind(workspace);
  workspace.ensure = (...args) => {
    ensured += 1;
    return ensure(...args);
  };
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
    host_key: 'test-box',
    machine_label: 'north-box',
    poll_interval_ms: 5000,
    lease_seconds: 300,
    config_path: '/tmp/bakers-credential-test/conductor.config.js',
  };
  const executor = new FakeExecutor({
    outcome: 'exited',
    ...(authFailure ? { authFailure } : {}),
  });
  const conductor = new Conductor(
    config,
    remote,
    executor,
    workspace,
    agents.map((agent) => ({ id: agent.id, agent })),
    log,
    '/tmp/bakers-credential-test',
  );
  conductor.claimServeProcess();
  conductor.credentialSources = {
    readExpiry: async () => ({}),
    probes: [],
    intervalMs: 6 * 3600_000,
    now: () => new Date(),
  };
  return { conductor, remote, executor, logs, ensured: () => ensured };
}

const FAILED = 'claude: not logged in — run claude /login (on north-box)';

describe('agent credential gate', () => {
  it('fails a run whose agent is not logged in, naming the agent, before any worktree', async () => {
    // logged in at the start check, logged out by the dispatch
    const { conductor, remote, ensured } = setup([
      agentWith('claude', [{ ok: true }, LOGGED_OUT]),
    ]);
    await conductor.start();
    await conductor.tick();
    expect(remote.calls.markFailed).toEqual([
      { runUuid: 'r-1', errorLog: `Error: ${FAILED}` },
    ]);
    expect(remote.calls.markRunning).toEqual([]);
    expect(ensured()).toBe(0);
  });

  it('reports the failed agent as an error on the next heartbeat and withholds claims until it logs in again', async () => {
    const { conductor, remote, logs } = setup(
      [
        agentWith('claude', [
          { ok: true },
          LOGGED_OUT,
          LOGGED_OUT,
          { ok: true },
        ]),
      ],
      2,
    );
    await conductor.start();
    remote.seedMachineLoad('test-box', { currentLoad: 0, maxParallel: 1 });
    await conductor.tick(); // r-1 fails at dispatch
    await conductor.tick(); // re-check still fails: r-2 stays queued
    expect(remote.queue.map((r) => r.runUuid)).toEqual(['r-2']);
    expect(remote.lastCredentials).toContainEqual({
      name: 'claude',
      status: 'error',
      reason: LOGGED_OUT.reason,
    });
    expect(logs).toContainEqual({
      level: 'warn',
      msg: `claims withheld: ${LOGGED_OUT.reason}`,
    });

    await conductor.tick(); // logged in again
    expect(remote.queue).toHaveLength(0);
    expect(remote.calls.markRunning[0]).toMatchObject({ runUuid: 'r-2' });
    expect(remote.lastCredentials).toContainEqual({
      name: 'claude',
      status: 'ok',
      reason: 'accepted',
    });
  });

  it('keeps claiming while another agent is logged in', async () => {
    const { conductor, remote } = setup(
      [agentWith('claude', [LOGGED_OUT]), agentWith('codex', [{ ok: true }])],
      1,
    );
    await conductor.start();
    await conductor.tick();
    // the run resolves to the default (first) agent and fails fast with its reason
    expect(remote.queue).toHaveLength(0);
    expect(remote.calls.markFailed).toEqual([
      { runUuid: 'r-1', errorLog: `Error: ${FAILED}` },
    ]);
  });
});

describe('launch watch for login screens', () => {
  const PATTERNS = [
    {
      pattern: /Select login method/,
      reason:
        'claude: not logged in (stopped at its login screen) — run claude /login',
    },
  ];

  it('fails a running run whose pane shows a login screen, closes its tab and holds the agent', async () => {
    const agent = {
      ...agentWith('claude', [{ ok: true }]),
      authFailurePatterns: PATTERNS,
    };
    const { conductor, remote, executor } = setup(
      [agent],
      1,
      'claude: not logged in (stopped at its login screen) — run claude /login',
    );
    await conductor.start();
    await conductor.tick();
    expect(remote.calls.markRunning[0]).toMatchObject({ runUuid: 'r-1' });
    expect(remote.calls.markFailed).toEqual([
      {
        runUuid: 'r-1',
        errorLog:
          'claude: not logged in (stopped at its login screen) — run claude /login (on north-box)',
      },
    ]);
    expect(executor.cleanups).toEqual([1, 1]); // before the launch, then the tab
    await conductor.tick();
    expect(remote.lastCredentials).toContainEqual(
      expect.objectContaining({ name: 'claude', status: 'error' }),
    );
  });

  it('reports an over-long failure reason on the heartbeat within its 200-character limit', async () => {
    const long = `claude: API Error: 401 ${'x'.repeat(300)}`;
    const { conductor, remote } = setup([
      agentWith('claude', [{ ok: true }, { ok: false, reason: long }]),
    ]);
    await conductor.start();
    await conductor.tick(); // r-1 fails at dispatch
    await conductor.tick();
    const claude = remote.lastCredentials?.find((c) => c.name === 'claude');
    expect(claude?.status).toBe('error');
    expect(claude?.reason).toHaveLength(200);
  });

  it('leaves a run alone when the watch ends without a match', async () => {
    const agent = {
      ...agentWith('claude', [{ ok: true }]),
      authFailurePatterns: PATTERNS,
    };
    const { conductor, remote, executor } = setup([agent]);
    await conductor.start();
    await conductor.tick();
    expect(remote.calls.markFailed).toEqual([]);
    expect(executor.cleanups).toEqual([1]); // only the one before the launch
  });
});

describe('box credential checks', () => {
  it('checks at start and again once the interval passed, reporting warnings on the heartbeat', async () => {
    const { conductor, remote } = setup(
      [agentWith('claude', [{ ok: true }])],
      0,
    );
    let now = new Date('2026-11-10T12:00:00Z');
    let expiry = '2026-11-20';
    conductor.credentialSources = {
      readExpiry: async () => ({ 'pm-bot-registry-token': expiry }),
      probes: [],
      intervalMs: 6 * 3600_000,
      now: () => now,
    };
    await conductor.start();
    expect(remote.lastCredentials).toContainEqual({
      name: 'pm-bot-registry-token',
      status: 'warning',
      expires_at: '2026-11-20',
      reason: 'expires on 2026-11-20, in 10 days',
    });
    expiry = '2027-11-20'; // renewed
    now = new Date('2026-11-10T17:00:00Z');
    await conductor.tick();
    expect(remote.lastCredentials).toContainEqual(
      expect.objectContaining({
        name: 'pm-bot-registry-token',
        status: 'warning',
      }),
    );
    now = new Date('2026-11-10T18:00:00Z');
    await conductor.tick(); // re-checked after the tick's heartbeat
    await conductor.tick();
    expect(remote.lastCredentials).toContainEqual(
      expect.objectContaining({ name: 'pm-bot-registry-token', status: 'ok' }),
    );
  });
});
