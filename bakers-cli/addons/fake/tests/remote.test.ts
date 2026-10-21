import { describe, expect, it } from 'vitest';
import { FakeBbRemote } from '../src/remote.js';

describe('FakeBbRemote', () => {
  it('claimNext drains the seeded queue then returns null', async () => {
    const remote = new FakeBbRemote({
      runs: [{ runUuid: 'r-1', ticketUuid: 't-1', stateAtStart: 'claimed' }],
    });
    const claimed = await remote.claimNext({
      leaseSeconds: 300,
      conductorId: 'c',
    });
    expect(claimed).toEqual({
      runUuid: 'r-1',
      runId: 1,
      ticketUuid: 't-1',
      stateAtStart: 'claimed',
      handler: 'code',
    });
    expect(
      await remote.claimNext({ leaseSeconds: 300, conductorId: 'c' }),
    ).toBeNull();
  });

  it('fetchActiveRuns and activeRunCount reflect non-terminal runs', async () => {
    const remote = new FakeBbRemote({
      runs: [
        { runUuid: 'r-1', ticketUuid: 't-1', stateAtStart: 'running' },
        { runUuid: 'r-2', ticketUuid: 't-2', stateAtStart: 'claimed' },
      ],
    });
    expect(await remote.activeRunCount('c')).toBe(2);
    const active = await remote.fetchActiveRuns('c');
    expect(active).toEqual([
      {
        runUuid: 'r-1',
        ticketUuid: 't-1',
        ticketIdentifier: '',
        branchName: '',
        state: 'running',
        stateAtStart: 'running',
        worktreePath: '',
      },
      {
        runUuid: 'r-2',
        ticketUuid: 't-2',
        ticketIdentifier: '',
        branchName: '',
        state: 'claimed',
        stateAtStart: 'claimed',
        worktreePath: '',
      },
    ]);
  });

  it('fetchActiveRuns includes branchName + stateAtStart from ticket seed', async () => {
    const remote = new FakeBbRemote({
      runs: [{ runUuid: 'r-3', ticketUuid: 't-3', stateAtStart: 'running' }],
      tickets: {
        't-3': {
          identifier: 'GL-3',
          title: 'T3',
          state: 'coding',
          branchName: 'bakers/gl-3',
        },
      },
    });
    const active = await remote.fetchActiveRuns('c');
    expect(active).toEqual([
      {
        runUuid: 'r-3',
        ticketUuid: 't-3',
        ticketIdentifier: 'GL-3',
        branchName: 'bakers/gl-3',
        state: 'running',
        stateAtStart: 'running',
        worktreePath: '',
      },
    ]);
  });

  it('fetchActiveRuns derives branchName from identifier when branchName not seeded', async () => {
    const remote = new FakeBbRemote({
      runs: [{ runUuid: 'r-4', ticketUuid: 't-4', stateAtStart: 'claimed' }],
      tickets: {
        't-4': { identifier: 'BB-42', title: 'T4', state: 'coding' },
      },
    });
    const active = await remote.fetchActiveRuns('c');
    expect(active[0]?.branchName).toBe('bakers/bb-42');
    expect(active[0]?.stateAtStart).toBe('claimed');
  });

  it('markRunning records the call and updates the run state', async () => {
    const remote = new FakeBbRemote({
      runs: [{ runUuid: 'r-1', ticketUuid: 't-1', stateAtStart: 'claimed' }],
    });
    await remote.markRunning('r-1', { worktree_path: '/ws/r-1' });
    expect(remote.calls.markRunning).toEqual([
      { runUuid: 'r-1', attrs: { worktree_path: '/ws/r-1' } },
    ]);
    const active = await remote.fetchActiveRuns('c');
    expect(active[0]?.state).toBe('running');
    expect(active[0]?.stateAtStart).toBe('claimed');
  });

  it('markFailed records the call and terminalises the run (failed + closed)', async () => {
    const remote = new FakeBbRemote({
      runs: [{ runUuid: 'r-1', ticketUuid: 't-1', stateAtStart: 'claimed' }],
    });
    await remote.markFailed('r-1', 'startRun boom');
    expect(remote.calls.markFailed).toEqual([
      { runUuid: 'r-1', errorLog: 'startRun boom' },
    ]);
    // failed is terminal: the run no longer counts as active.
    expect(await remote.activeRunCount('c')).toBe(0);
    // and it is closed, so it is not a finalisation candidate.
    expect(await remote.fetchFinalizableRuns('any')).toEqual([]);
  });

  it('setConductorStatus / getConductorStatus round-trip; default is online', async () => {
    const remote = new FakeBbRemote();
    expect(await remote.getConductorStatus('c')).toBe('online');
    await remote.setConductorStatus('c', 'offline');
    expect(await remote.getConductorStatus('c')).toBe('offline');
  });

  // BB-353 D5: shared host budget — machine load is the sum of per-conductor
  // contributions after heartbeat (peer seed + this process).
  it('machineCapacity sums peer seed + this conductor load after heartbeat (BB-353 D5)', async () => {
    const remote = new FakeBbRemote();
    remote.seedMachineLoad('dev-box', { currentLoad: 2, maxParallel: 3 });
    expect(await remote.machineCapacity('dev-box')).toEqual({
      maxParallel: 3,
      currentLoad: 2,
    });
    await remote.heartbeat(
      {
        id: 'cw-dev-box-bakers',
        host_key: 'dev-box',
        project: 'bakers',
        states: ['coding'],
        workspace: '/w',
        label: 'l',
        max_parallel: 3,
      },
      1,
    );
    expect(await remote.machineCapacity('dev-box')).toEqual({
      maxParallel: 3,
      currentLoad: 3,
    });
    expect(await remote.machineCapacity('unknown-host')).toBeNull();
  });

  it('registerConductor returns a fake uuid; getTicket reads the seed', async () => {
    const remote = new FakeBbRemote({
      tickets: { 't-1': { identifier: 'GL-1', title: 'T', state: 'coding' } },
    });
    expect(
      await remote.registerConductor({
        id: 'm',
        project: 'p',
        states: ['todo'],
        workspace: '/w',
        label: 'l',
        max_parallel: 1,
      }),
    ).toBe('fake-conductor-uuid');
    expect(await remote.getTicket('t-1')).toEqual({
      uuid: 't-1',
      identifier: 'GL-1',
      title: 'T',
      state: 'coding',
      branchName: 'bakers/gl-1',
      labels: [],
      environments: [],
    });
  });

  it('getTicket uses explicit branchName when seeded', async () => {
    const remote = new FakeBbRemote({
      tickets: {
        't-5': {
          identifier: 'GL-5',
          title: 'T5',
          state: 'coding',
          branchName: 'custom/branch',
        },
      },
    });
    const ticket = await remote.getTicket('t-5');
    expect(ticket.branchName).toBe('custom/branch');
  });

  it('getRunTicketBranchName resolves via runs→tickets', async () => {
    const remote = new FakeBbRemote({
      runs: [{ runUuid: 'r-10', ticketUuid: 't-10', stateAtStart: 'coding' }],
      tickets: {
        't-10': {
          identifier: 'GL-10',
          title: 'T10',
          state: 'coding',
          branchName: 'bakers/gl-10',
        },
      },
    });
    expect(await remote.getRunTicketBranchName('r-10')).toBe('bakers/gl-10');
  });

  it('getRunTicketBranchName derives branch from identifier when branchName unset', async () => {
    const remote = new FakeBbRemote({
      runs: [{ runUuid: 'r-11', ticketUuid: 't-11', stateAtStart: 'review' }],
      tickets: {
        't-11': { identifier: 'BB-99', title: 'T11', state: 'review' },
      },
    });
    expect(await remote.getRunTicketBranchName('r-11')).toBe('bakers/bb-99');
  });

  it('getRunTicketBranchName returns empty string for unknown run', async () => {
    const remote = new FakeBbRemote();
    expect(await remote.getRunTicketBranchName('no-such-run')).toBe('');
  });

  it('finalizeRun records closure and log; fetchFinalizableRuns returns done+unclosed', async () => {
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
    const finalizable = await remote.fetchFinalizableRuns('any');
    expect(finalizable).toEqual([
      {
        runUuid: 'r-1',
        runId: 1,
        ticketUuid: 't-1',
        stateAtStart: 'review',
        worktreePath: '/wt/r-1',
        agent: '',
      },
    ]);

    await remote.finalizeRun('r-1', 'TRANSCRIPT');
    expect(remote.calls.finalizeRun).toEqual([
      { runUuid: 'r-1', log: 'TRANSCRIPT' },
    ]);
    expect(await remote.fetchFinalizableRuns('any')).toEqual([]); // closed now
  });

  it('fetchFinalizableRuns returns cancelled+unclosed runs too', async () => {
    const remote = new FakeBbRemote({
      runs: [
        {
          runUuid: 'r-cancelled',
          ticketUuid: 't-cancelled',
          stateAtStart: 'running',
          state: 'cancelled',
          worktreePath: '/wt/cancelled',
        },
      ],
    });

    const finalizable = await remote.fetchFinalizableRuns('any');
    expect(finalizable.map((run) => run.runUuid)).toContain('r-cancelled');
  });
});
