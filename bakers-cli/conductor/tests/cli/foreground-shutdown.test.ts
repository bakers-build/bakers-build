import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeAgent } from '@bakers-build/addon-claude';
import {
  FakeBbRemote,
  FakeExecutor,
  FakeWorkspace,
  fakeExecutor,
  fakeRemote,
  fakeWorkspace,
} from '@bakers-build/addon-fake';
import type {
  ConductorFileConfig,
  ConductorRegistration,
} from '@bakers-build/conductor/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BbCliDeps,
  buildConductorProgram,
} from '../../src/commands/conductor.js';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';

vi.mock('dropsh', async (orig) => {
  const actual = await orig<typeof import('dropsh')>();
  return { ...actual, authStatus: vi.fn(async () => ({ loggedIn: true })) };
});

/**
 * The exiting conductor writes its own `offline`.
 *
 * It has to be this process that writes it. ConductorRegistrar sets `online`
 * unconditionally on every heartbeat, so a status written by anyone else — a
 * cockpit, another CLI — is erased by the next tick. Only after the heartbeats
 * have stopped is the value trustworthy, and the only party that knows they
 * have stopped is the process that stopped them.
 */
describe('bakers oven start --foreground shutdown', () => {
  let home: string;
  const originalHome = process.env.BB_HOME;
  const originalLog = process.env.BB_CONDUCTOR_LOG;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'bakers-fg-shutdown-'));
    process.env.BB_HOME = join(home, '.bakers');
    process.env.BB_CONDUCTOR_LOG = 'silent';
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.BB_HOME;
    else process.env.BB_HOME = originalHome;
    if (originalLog === undefined) delete process.env.BB_CONDUCTOR_LOG;
    else process.env.BB_CONDUCTOR_LOG = originalLog;
  });

  it('writes offline for its own conductor once serve unwinds', async () => {
    const remote = new ShutdownRemote();

    await runForeground(remote);

    expect(remote.statusWrites).toEqual([['fake-conductor-uuid', 'offline']]);
  });

  it('reports its pid while running, so a cockpit can stop it', async () => {
    const remote = new ShutdownRemote();

    await runForeground(remote);

    expect(remote.registrations[0]?.last_pid).toBe(process.pid);
    expect(remote.registrations[0]?.conductor_name).toBe('conductor');
  });

  it('still exits when the control plane rejects the offline write', async () => {
    const remote = new ShutdownRemote();
    remote.failStatusWrite = true;

    await expect(runForeground(remote)).resolves.toBeUndefined();
  });

  /**
   * Drives one serve cycle and then asks the process to stop, exactly as a
   * `bakers oven stop` would: the SIGTERM handler cmdStartForeground
   * installs aborts the loop.
   */
  async function runForeground(remote: ShutdownRemote): Promise<void> {
    const deps: BbCliDeps = {
      remote,
      config: makeConfig(),
      executor: new FakeExecutor({ outcome: 'exited' }),
      workspace: new FakeWorkspace(),
      agents: [{ id: 'claude', agent: claudeAgent() }],
    };
    const program = buildConductorProgram(deps);
    await program.parseAsync(['oven', 'start', '--foreground'], {
      from: 'user',
    });
  }

  function makeConfig(): ConductorFileConfig {
    return {
      site: { base_url: 'http://web', jsonapi_prefix: '/jsonapi' },
      remote: fakeRemote(),
      executor: fakeExecutor(),
      agent: [{ agent: claudeAgent() }],
      workspace: fakeWorkspace(),
      project: 'bakers',
      states: ['working'],
      prompt: DEFAULT_AGENT_PROMPT,
      max_parallel: 1,
      poll_interval_ms: 5,
      lease_seconds: 300,
      machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',
      variant: 'conductor',
      config_path: join(home, 'conductor.config.js'),
    } as ConductorFileConfig;
  }
});

/**
 * A remote that lets the serve loop run exactly one tick, then signals the
 * process to stop — the same SIGTERM a `bakers oven stop` sends.
 */
class ShutdownRemote extends FakeBbRemote {
  registrations: ConductorRegistration[] = [];
  statusWrites: Array<[string, string]> = [];
  failStatusWrite = false;

  override async registerConductor(
    reg: ConductorRegistration,
  ): Promise<string> {
    this.registrations.push(reg);
    return super.registerConductor(reg);
  }

  override async heartbeat(
    reg: ConductorRegistration,
    load: number,
    lease?: number,
  ): Promise<string> {
    const status = await super.heartbeat(reg, load, lease);
    // One tick is enough to prove the loop ran; ask it to wind down.
    process.emit('SIGTERM');
    return status;
  }

  override async setConductorStatus(id: string, status: string): Promise<void> {
    if (this.failStatusWrite) {
      throw new Error('control plane unreachable');
    }
    this.statusWrites.push([id, status]);
  }
}
