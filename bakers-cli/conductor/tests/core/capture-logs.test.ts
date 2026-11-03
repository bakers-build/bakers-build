// BB-556 Task 6: `capture_logs` lets an operator keep this conductor's
// transcripts out of the log store while metrics keep flowing — the
// footprint is derived from the agent's own session files in this process,
// never from the uploaded log.
import { claudeAgent, parseClaudeTranscript } from '@bakers-build/addon-claude';
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
  ResolvedAgent,
} from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';
import { Conductor } from '../../src/core/conductor.js';

const CHECKOUT = '/tmp/bakers-conductor-capture-logs-test-checkout';

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
    conductor_id: 'bakers-test-conductor',
    project: 'bakers',
    states: ['todo', 'working'],
    prompt: DEFAULT_AGENT_PROMPT,
    max_parallel: 2,
    poll_interval_ms: 5000,
    lease_seconds: 300,
    config_path: `${CHECKOUT}/conductor.config.js`,
    ...overrides,
  } as ConductorFileConfig;
}

const fakeAgent: BbAgent = {
  id: 'claude',
  launchCommand: (p: string) =>
    p === '' ? 'claude' : `claude '${p}' --dangerously-skip-permissions`,
  getRunLog: async () => '',
  parseFootprint: (log: string) => parseClaudeTranscript(log),
};

function agentReturning(log: string): BbAgent {
  return { ...fakeAgent, getRunLog: async () => log };
}

const resolved = (a: BbAgent): ResolvedAgent[] => [{ id: a.id, agent: a }];

const spyLogger = (): ConductorLogger => ({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
});

/**
 * A transcript that yields a non-zero footprint (BB-556 test 4 must see a
 * real metric, not an unparseable-log zero).
 */
const NON_ZERO_TRANSCRIPT = JSON.stringify({
  type: 'assistant',
  timestamp: '2026-07-16T15:31:28.000Z',
  message: {
    role: 'assistant',
    model: 'claude-opus-4-5',
    content: [{ type: 'text', text: 'ok' }],
    usage: { input_tokens: 10, output_tokens: 20 },
  },
});

/** Runs one done+unclosed run to finalisation and returns the fake's remote. */
async function finalizeWith(
  captureLogs: boolean | undefined,
  transcript: string,
): Promise<FakeBbRemote> {
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
  const conductor = new Conductor(
    makeConfig({ capture_logs: captureLogs }),
    remote,
    new FakeExecutor(),
    new FakeWorkspace(),
    resolved(agentReturning(transcript)),
    spyLogger(),
    CHECKOUT,
  );
  await conductor.start();
  await conductor.tick();
  return remote;
}

describe('capture_logs', () => {
  it('uploads the transcript when unset (default on)', async () => {
    const remote = await finalizeWith(undefined, NON_ZERO_TRANSCRIPT);
    expect(remote.calls.finalizeRun[0]?.log).toBe(NON_ZERO_TRANSCRIPT);
  });

  it('uploads the transcript when explicitly true', async () => {
    const remote = await finalizeWith(true, NON_ZERO_TRANSCRIPT);
    expect(remote.calls.finalizeRun[0]?.log).toBe(NON_ZERO_TRANSCRIPT);
  });

  it('omits the transcript when false', async () => {
    const remote = await finalizeWith(false, NON_ZERO_TRANSCRIPT);
    expect(remote.calls.finalizeRun[0]?.log).toBe('');
  });

  it('still reports metrics when capture is off', async () => {
    const remote = await finalizeWith(false, NON_ZERO_TRANSCRIPT);
    // The footprint is derived from the agent's own session files in this
    // process, never from the uploaded log, so switching capture off must not
    // cost a single metric.
    expect(remote.calls.finalizeRun[0]?.metrics?.tokens).toBeGreaterThan(0);
  });

  it('still closes the run when capture is off', async () => {
    const remote = await finalizeWith(false, NON_ZERO_TRANSCRIPT);
    expect(remote.calls.finalizeRun).toHaveLength(1);
    expect(remote.runLog('r-1')).toBe('');
  });
});
