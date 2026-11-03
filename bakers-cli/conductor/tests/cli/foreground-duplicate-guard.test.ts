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
  ConductorStatus,
} from '@bakers-build/conductor/contract';
import type { ProcProbe } from '@bakers-build/core';
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
 * BB-474: `bakers oven start --foreground` carries no one-per-project
 * guard at all — `cmdStartForeground` goes straight from `resolveConfig` to
 * `conductor.claimServeProcess()` / `start()`, unlike the detached path's
 * `cmdStartBody`, which refuses a second start when an existing record is
 * `online`. This is the RED case: a second `--foreground` invocation must be
 * refused, verified by an actual process probe of the recorded `last_pid`,
 * not by the entity's derived liveness alone.
 */
describe('bakers oven start --foreground duplicate guard (BB-474)', () => {
  const HOST = 'mid-fg';
  const CONDUCTOR_CMDLINE =
    'node /usr/local/bin/bakers oven start --foreground --no-update-check';

  let home: string;
  const originalHome = process.env.BB_HOME;
  const originalLog = process.env.BB_CONDUCTOR_LOG;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'bakers-fg-duplicate-'));
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

  function runningRow(over: Partial<ConductorStatus> = {}): ConductorStatus {
    const now = Math.floor(Date.now() / 1000);
    return {
      id: 'mid-fg',
      project: 'bakers',
      label: 'test',
      status: 'online',
      lastSeen: now,
      load: 0,
      workspaceRoot: '/home/dev/project',
      leaseExpiresAt: now + 300,
      maxParallel: 1,
      lastPid: 4242,
      hostKey: HOST,
      ...over,
    };
  }

  function fakeProcProbe(pid: number): ProcProbe {
    return {
      supported: true,
      cmdlineOf: (p: number) => (p === pid ? CONDUCTOR_CMDLINE : undefined),
      uidOf: (p: number) => (p === pid ? (process.getuid?.() ?? 0) : undefined),
      send: () => {
        throw new Error('this test must never signal a process');
      },
    };
  }

  class RunningRemote extends FakeBbRemote {
    registrations: ConductorRegistration[] = [];

    override async listConductors(): Promise<ConductorStatus[]> {
      return [runningRow()];
    }

    override async registerConductor(
      reg: ConductorRegistration,
    ): Promise<string> {
      this.registrations.push(reg);
      return super.registerConductor(reg);
    }
  }

  function makeConfig(): ConductorFileConfig {
    return {
      site: { base_url: 'http://web', jsonapi_prefix: '/jsonapi' },
      remote: fakeRemote(),
      executor: fakeExecutor(),
      agent: [{ agent: claudeAgent() }],
      workspace: fakeWorkspace(),
      label: 'foreground duplicate test',
      project: 'bakers',
      states: ['working'],
      prompt: DEFAULT_AGENT_PROMPT,
      max_parallel: 1,
      poll_interval_ms: 5,
      lease_seconds: 300,
      conductor_id: 'mid-fg',
      host_key: HOST,
      config_path: join(home, 'conductor.config.js'),
    } as ConductorFileConfig;
  }

  it('refuses to start a second --foreground process when one is already live, verified by a real pid probe', async () => {
    const remote = new RunningRemote();
    const deps: BbCliDeps = {
      remote,
      config: makeConfig(),
      executor: new FakeExecutor({ outcome: 'exited' }),
      workspace: new FakeWorkspace(),
      agents: [{ id: 'claude', agent: claudeAgent() }],
      procProbe: fakeProcProbe(4242),
    };
    const program = buildConductorProgram(deps);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let lines: string[] = [];
    try {
      await program.parseAsync(['oven', 'start', '--foreground'], {
        from: 'user',
      });
    } finally {
      lines = logSpy.mock.calls.map((c) => String(c[0]));
      logSpy.mockRestore();
    }

    // Expected (post-fix) behaviour: a refusal naming the running pid, and no
    // second registration under the same identity.
    expect(lines.some((l) => l.includes('already running'))).toBe(true);
    expect(remote.registrations).toHaveLength(0);
  });
});
