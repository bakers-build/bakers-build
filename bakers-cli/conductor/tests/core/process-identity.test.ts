import {
  FakeExecutor,
  FakeBbRemote,
  FakeWorkspace,
} from '@bakers-build/addon-fake';
import type {
  ConductorRegistration,
  BbAgent,
  ResolvedAgent,
} from '@bakers-build/conductor/contract';
import { describe, expect, it } from 'vitest';
import { Conductor } from '../../src/core/conductor.js';

/**
 * The conductor reports its own process identity — but only when it *is* the
 * process.
 *
 * `last_pid` and `conductor_name` exist so a cockpit can stop a conductor it
 * did not start. They are reported on the registration payload the conductor
 * already sends, which is sound only because the serve loop is the process
 * that owns the pid. `poll` and `reap` build a Conductor and call start() +
 * tick() too, then exit within seconds; if they reported a pid unconditionally
 * every `bakers conductor poll` would overwrite a running conductor's pid with
 * its own short-lived one, and the next stop would signal a dead — or worse,
 * recycled — process.
 *
 * The guard is therefore structural rather than disciplinary: reporting is off
 * until a caller claims the process, and only cmdStartForeground claims it.
 */
describe('conductor process identity', () => {
  it('reports neither field by default, so poll and reap cannot clobber a pid', async () => {
    const remote = new RecordingRemote();
    const conductor = makeConductor(remote);

    await conductor.start();

    expect(remote.lastRegistration?.last_pid).toBeUndefined();
    expect(remote.lastRegistration?.conductor_name).toBeUndefined();
  });

  it('reports both once the serve loop claims the process', async () => {
    const remote = new RecordingRemote();
    const conductor = makeConductor(remote);

    conductor.claimServeProcess();
    await conductor.start();

    expect(remote.lastRegistration?.last_pid).toBe(process.pid);
    expect(remote.lastRegistration?.conductor_name).toBe('conductor');
  });

  it('derives the conductor name from the config file it was loaded from', async () => {
    const remote = new RecordingRemote();
    const conductor = makeConductor(remote, {
      config_path: `${CHECKOUT}/shop.conductor.config.js`,
    });

    conductor.claimServeProcess();
    await conductor.start();

    expect(remote.lastRegistration?.conductor_name).toBe('shop');
  });

  it('keeps reporting both on every heartbeat, not only the first registration', async () => {
    const remote = new RecordingRemote();
    const conductor = makeConductor(remote);

    conductor.claimServeProcess();
    await conductor.start();
    await conductor.tick();

    expect(remote.heartbeats.length).toBeGreaterThan(0);
    const last = remote.heartbeats.at(-1);
    expect(last?.last_pid).toBe(process.pid);
    expect(last?.conductor_name).toBe('conductor');
  });

  it('gives two configs in one workspace two distinct names', async () => {
    const defaultRemote = new RecordingRemote();
    const shopRemote = new RecordingRemote();

    const a = makeConductor(defaultRemote);
    const b = makeConductor(shopRemote, {
      config_path: `${CHECKOUT}/shop.conductor.config.js`,
      machine_id: 'mid-shop',
    });
    a.claimServeProcess();
    b.claimServeProcess();
    await a.start();
    await b.start();

    expect(defaultRemote.lastRegistration?.workspace).toBe(
      shopRemote.lastRegistration?.workspace,
    );
    expect(defaultRemote.lastRegistration?.conductor_name).toBe('conductor');
    expect(shopRemote.lastRegistration?.conductor_name).toBe('shop');
  });
});

const CHECKOUT = '/tmp/bakers-conductor-identity-checkout';

/** A remote that keeps what the conductor actually sent. */
class RecordingRemote extends FakeBbRemote {
  lastRegistration?: ConductorRegistration;
  heartbeats: ConductorRegistration[] = [];

  override async registerConductor(
    reg: ConductorRegistration,
  ): Promise<string> {
    this.lastRegistration = reg;
    return super.registerConductor(reg);
  }

  override async heartbeat(
    reg: ConductorRegistration,
    load: number,
    lease?: number,
  ): Promise<string> {
    this.heartbeats.push(reg);
    this.lastRegistration = reg;
    return super.heartbeat(reg, load, lease);
  }
}

function makeConductor(
  remote: FakeBbRemote,
  overrides: Record<string, unknown> = {},
): Conductor {
  return new Conductor(
    {
      site: { base_url: 'http://web', jsonapi_prefix: '/jsonapi' },
      label: 'identity test',
      project: 'bakers',
      states: ['coding'],
      max_parallel: 1,
      poll_interval_ms: 5000,
      lease_seconds: 300,
      machine_id: 'mid-default',
      config_path: `${CHECKOUT}/conductor.config.js`,
      ...overrides,
    } as any,
    remote,
    new FakeExecutor({ outcome: 'exited' }),
    new FakeWorkspace(),
    resolvedAgents(),
    silentLogger(),
    CHECKOUT,
  );
}

/** The 1-element ResolvedAgent[] the Conductor takes. */
function resolvedAgents(): ResolvedAgent[] {
  const agent: BbAgent = {
    id: 'claude',
    launchCommand: () => 'claude',
    getRunLog: async () => '',
    parseFootprint: () => ({}) as never,
  };
  return [{ id: agent.id, agent }];
}

function silentLogger() {
  const noop = () => {};
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => silentLogger(),
  } as any;
}
