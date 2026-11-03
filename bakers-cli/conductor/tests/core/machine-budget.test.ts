/**
 * BB-464 — the shared host budget must be a CEILING, not a floor.
 *
 * BB-353 D5 gates claiming on `bb_machine.current_load`, but nothing that
 * admits a run ever observes the number it is meant to bound:
 *
 *  1. `current_load` is a sum of per-conductor `reported_load` snapshots, each
 *     written by a heartbeat that measured it BEFORE that tick's claims. A claim
 *     increments only the claiming process's local copy, so every run it
 *     dispatches is invisible to its peers for the rest of the tick plus the
 *     whole poll interval.
 *  2. The gate compares that machine-wide load against the CONDUCTOR's own
 *     `config.max_parallel`, discarding the `maxParallel` the machine row
 *     carries — and the machine row's budget is itself last-writer-wins,
 *     rewritten by every heartbeat.
 *
 * These tests are deliberately SEQUENTIAL: no timers, no interleaving, no
 * simultaneous requests. If the staleness window were merely an instant, a
 * strictly ordered "A ticks, then B ticks" would stay inside the budget. It does
 * not — which is the point. The window is a whole tick, so the overshoot needs
 * no race at all to reproduce, and the reported 7 + 3 = 10 against a budget of 7
 * is the ordinary behaviour of two restarted conductors rather than bad luck.
 */

import { claudeAgent, parseClaudeTranscript } from '@bakers-build/addon-claude';
import {
  FakeBbRemote,
  type FakeRemoteSeed,
  FakeWorkspace,
  fakeExecutor,
  fakeRemote,
  fakeWorkspace,
} from '@bakers-build/addon-fake';
import type {
  BbAgent,
  BbExecutor,
  ConductorFileConfig,
  ResolvedAgent,
  SpawnRunInput,
} from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';
import { Conductor } from '../../src/core/conductor.js';

const CHECKOUT = '/tmp/bakers-conductor-budget-checkout';
const HOST = '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30';

const fakeAgent: BbAgent = {
  id: 'claude',
  launchCommand: (p: string) =>
    p === '' ? 'claude' : `claude '${p}' --dangerously-skip-permissions`,
  getRunLog: async () => '',
  parseFootprint: (log: string) => parseClaudeTranscript(log),
};

const resolved = (a: BbAgent): ResolvedAgent[] => [{ id: a.id, agent: a }];

function silentLogger(): ConductorLogger {
  const noop = () => {};
  return { debug: noop, info: noop, warn: noop, error: noop };
}

function makeConfig(
  overrides: Partial<ConductorFileConfig> = {},
): ConductorFileConfig {
  return {
    site: { base_url: 'http://web', jsonapi_prefix: '/jsonapi' },
    remote: fakeRemote(),
    executor: fakeExecutor(),
    agent: [{ agent: claudeAgent() }],
    workspace: fakeWorkspace(),
    machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',
    machine_label: 'test-machine',
    variant: 'conductor',
    project: 'bakers',
    states: ['todo', 'working'],
    prompt: DEFAULT_AGENT_PROMPT,
    max_parallel: 2,
    poll_interval_ms: 5000,
    lease_seconds: 300,
    config_path: `${CHECKOUT}/conductor.config.js`,
    ...overrides,
  };
}

/** Records every run this executor was asked to start. */
class RecordingExecutor implements BbExecutor {
  readonly id = 'recording';
  readonly started: SpawnRunInput[] = [];

  capabilities() {
    return { persistent: false };
  }

  async runHook() {
    return { hook: 'after_worktree' as const, ran: false, ok: true };
  }

  async startRun(input: SpawnRunInput) {
    this.started.push(input);
    return { sessionId: `s-${this.started.length}` };
  }

  async stopRun() {}
  async cleanupRun() {}
  async removeWorktree() {
    return { present: true, outcome: 'removed' as const };
  }
  async listRuns() {
    return [];
  }
}

async function startedConductor(
  config: ConductorFileConfig,
  remote: FakeBbRemote,
  executor: BbExecutor,
  logger: ConductorLogger = silentLogger(),
): Promise<Conductor> {
  const conductor = new Conductor(
    config,
    remote,
    executor,
    new FakeWorkspace(),
    resolved(fakeAgent),
    logger,
    CHECKOUT,
  );
  await conductor.start();
  return conductor;
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

/** Seeds `count` claimable tickets and queues one claimable run for each. */
function seedQueue(remote: FakeBbRemote, count: number): void {
  for (let i = 1; i <= count; i++) {
    remote.queue.push({
      runUuid: `r-${i}`,
      runId: i,
      ticketUuid: `t-${i}`,
      stateAtStart: 'todo',
      handler: 'code',
    });
  }
}

function seedTickets(count: number): FakeRemoteSeed {
  const tickets: FakeRemoteSeed['tickets'] = {};
  for (let i = 1; i <= count; i++) {
    tickets[`t-${i}`] = {
      identifier: `bakers.build-${i}`,
      title: `Ticket ${i}`,
      state: 'todo',
    };
  }
  return { tickets };
}

describe('BB-464 — shared host budget is a ceiling', () => {
  it('two conductors on one machine never dispatch more than the host budget', async () => {
    // One machine row, one shared claim queue, budget 2 — the reported
    // scenario scaled down (there: budget 7, observed 10).
    const remote = new FakeBbRemote(seedTickets(4));
    seedQueue(remote, 4);

    const execA = new RecordingExecutor();
    const execB = new RecordingExecutor();
    const a = await startedConductor(
      makeConfig({
        max_parallel: 2,
        machine_id: HOST,
        project: 'shop',
      }),
      remote,
      execA,
    );
    const b = await startedConductor(
      makeConfig({
        max_parallel: 2,
        machine_id: HOST,
        project: 'bibb',
      }),
      remote,
      execB,
    );

    // Both restarted: each starts its tick with 0 active runs of its own.
    await a.tick();
    await b.tick();

    const dispatched = execA.started.length + execB.started.length;
    expect(dispatched).toBeLessThanOrEqual(2);
  });

  it('the machine reports a load that accounts for the claims already dispatched', async () => {
    const remote = new FakeBbRemote(seedTickets(4));
    seedQueue(remote, 4);

    const a = await startedConductor(
      makeConfig({
        max_parallel: 2,
        machine_id: HOST,
        project: 'shop',
      }),
      remote,
      new RecordingExecutor(),
    );

    await a.tick();

    // After a tick that dispatched 2 runs, the next reader of the machine row —
    // a peer conductor — must see those 2, not the 0 measured before the claims.
    const capacity = await remote.machineCapacity(HOST);
    expect(capacity?.currentLoad).toBe(2);
  });

  it('the host budget does not flip with whichever conductor heartbeat last', async () => {
    const remote = new FakeBbRemote(seedTickets(1));

    const a = await startedConductor(
      makeConfig({
        max_parallel: 1,
        machine_id: HOST,
        project: 'shop',
      }),
      remote,
      new RecordingExecutor(),
    );
    const b = await startedConductor(
      makeConfig({
        max_parallel: 3,
        machine_id: HOST,
        project: 'bibb',
      }),
      remote,
      new RecordingExecutor(),
    );

    await a.tick();
    const afterA = (await remote.machineCapacity(HOST))?.maxParallel;
    await b.tick();
    const afterB = (await remote.machineCapacity(HOST))?.maxParallel;

    // One host, one budget: it may not depend on who heartbeat most recently.
    expect(afterB).toBe(afterA);
  });

  it('claims up to the free budget in one tick when nothing is contended (AC 7)', async () => {
    // One conductor, an empty machine, budget 3, 3 queued runs: the new
    // server-side ceiling must not turn into per-claim latency or a
    // one-run-per-tick drip on an idle host.
    const remote = new FakeBbRemote(seedTickets(3));
    seedQueue(remote, 3);
    const executor = new RecordingExecutor();

    const a = await startedConductor(
      makeConfig({
        max_parallel: 3,
        machine_id: HOST,
        project: 'solo',
      }),
      remote,
      executor,
    );

    await a.tick();

    expect(executor.started.length).toBe(3);
  });

  it('logs a breach as a breach, distinct from "at capacity, nothing claimed" (AC 5)', async () => {
    // Seed the machine already over its budget (as a stale server row, or a
    // peer's overshoot elsewhere) and confirm the tick surfaces it as a
    // warning of its own rather than only the existing info-level line.
    const remote = new FakeBbRemote(seedTickets(1));
    remote.seedMachineLoad(HOST, { currentLoad: 5, maxParallel: 2 });
    const { log, calls } = spyLogger();

    const a = await startedConductor(
      makeConfig({
        max_parallel: 2,
        machine_id: HOST,
        project: 'breach',
      }),
      remote,
      new RecordingExecutor(),
      log,
    );

    await a.tick();

    expect(
      calls.some(
        (c) =>
          c.level === 'warn' && c.msg === 'machine over its shared host budget',
      ),
    ).toBe(true);
    expect(calls.some((c) => c.msg === 'at capacity, nothing claimed')).toBe(
      true,
    );
  });
});
