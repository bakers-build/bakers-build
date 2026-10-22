import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeAgent } from '@bakers-build/addon-claude';
import {
  FakeBbRemote,
  fakeExecutor,
  fakeRemote,
  fakeWorkspace,
} from '@bakers-build/addon-fake';
import type {
  ConductorFileConfig,
  ConductorStatus,
} from '@bakers-build/conductor/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BbCliDeps,
  buildConductorProgram,
  type HerdrHost,
} from '../../src/commands/conductor.js';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';

vi.mock('dropsh', async (orig) => {
  const actual = await orig<typeof import('dropsh')>();
  return { ...actual, authStatus: vi.fn(async () => ({ loggedIn: true })) };
});

/**
 * `~/.bakers/conductors.json` is gone, and nothing writes or reads it.
 *
 * The registry was a second list of conductors kept beside the control plane's,
 * and it lost. Every field it held is on the bb_conductor record — `path` as
 * `workspace_root`, `project`, `label`, the handle derivable from the
 * machine_id — while the record additionally knows whether the conductor is
 * alive, which the file could never know. What the file did have was the
 * ability to be wrong: on this machine it listed seven conductors, one of them
 * pointing at a directory that no longer existed and another at a checkout the
 * control plane had long since superseded.
 */
describe('the local conductor registry is gone', () => {
  let home: string;
  let out: string[];
  const originalHome = process.env.BB_HOME;
  const originalLog = process.env.BB_CONDUCTOR_LOG;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'bakers-no-registry-'));
    process.env.BB_HOME = join(home, '.bakers');
    process.env.BB_CONDUCTOR_LOG = 'silent';
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      out.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.BB_HOME;
    else process.env.BB_HOME = originalHome;
    if (originalLog === undefined) delete process.env.BB_CONDUCTOR_LOG;
    else process.env.BB_CONDUCTOR_LOG = originalLog;
  });

  it('start writes no registry file', async () => {
    await run(['start'], []);

    expect(existsSync(join(home, '.bakers', 'conductors.json'))).toBe(false);
    // Nothing else should appear in its place either.
    const bakersDir = join(home, '.bakers');
    if (existsSync(bakersDir)) {
      expect(readdirSync(bakersDir)).not.toContain('conductors.json');
    }
  });

  it('start refuses a second conductor when the first is running', async () => {
    const herdr = fakeHerdr();
    const nowS = Math.floor(Date.now() / 1000);

    await run(
      ['start'],
      [row({ status: 'online', lastSeen: nowS, leaseExpiresAt: nowS + 300 })],
      herdr,
    );

    expect(herdr.spawned).toEqual([]);
    expect(out.join('\n')).toContain('already running');
  });

  it('start allows a restart when the conductor crashed without saying so', async () => {
    // A crash leaves `status: online` on the record until the cron reaper
    // notices the lapsed lease. Blocking on the raw status would make a restart
    // impossible for minutes, which is exactly when a restart is wanted.
    const herdr = fakeHerdr();
    const nowS = Math.floor(Date.now() / 1000);

    await run(
      ['start'],
      [
        row({
          status: 'online',
          lastSeen: nowS - 5000,
          leaseExpiresAt: nowS - 4700,
        }),
      ],
      herdr,
    );

    expect(herdr.spawned.length).toBe(1);
  });

  it('start allows a restart after a clean stop', async () => {
    const herdr = fakeHerdr();

    await run(['start'], [row({ status: 'offline' })], herdr);

    expect(herdr.spawned.length).toBe(1);
  });

  it('ls builds its rows from the control plane alone', async () => {
    await run(
      ['ls'],
      [row({ id: 'mid-a', project: 'bakers', label: 'alpha' })],
    );

    const text = out.join('\n');
    expect(text).toContain('mid-a');
    expect(text).toContain('bakers');
    expect(text).toContain('alpha');
  });

  it('ls speaks the shared liveness vocabulary, not the old CLI one', async () => {
    const nowS = Math.floor(Date.now() / 1000);
    await run(
      ['ls'],
      [
        row({ id: 'mid-live', lastSeen: nowS, leaseExpiresAt: nowS + 300 }),
        row({ id: 'mid-old', lastSeen: nowS - 5000 }),
        row({ id: 'mid-off', status: 'offline' }),
      ],
    );

    const text = out.join('\n');
    // BB-450 D11: the fresh word is `online` — the server's own word —
    // not the CLI-only `running` this superseded.
    expect(text).toContain('online');
    expect(text).toContain('stale');
    expect(text).toContain('offline');
    // The words the registry made possible are gone with it.
    expect(text).not.toContain('wedged');
    expect(text).not.toContain('registry-only');
    expect(text).not.toContain('stopped');
  });

  it('no longer offers `bakers conductor rm`', async () => {
    const program = buildConductorProgram({
      remote: new ListRemote([]),
      config: makeConfig(),
    });
    const conductor = program.commands.find((c) => c.name() === 'conductor');
    const names = (conductor?.commands ?? []).map((c) => c.name());

    expect(names).not.toContain('rm');
    expect(names).toContain('start');
    expect(names).toContain('stop');
  });

  function row(over: Partial<ConductorStatus>): ConductorStatus {
    return {
      id: 'mid-registry',
      project: 'bakers',
      label: 'registry test',
      status: 'online',
      lastSeen: 0,
      load: 0,
      workspaceRoot: join(home, '.bakers'),
      leaseExpiresAt: 0,
      maxParallel: 1,
      ...over,
    };
  }

  async function run(
    argv: string[],
    rows: ConductorStatus[],
    herdr?: ReturnType<typeof fakeHerdr>,
  ): Promise<void> {
    const deps: BbCliDeps = {
      remote: new ListRemote(rows),
      config: makeConfig(),
      herdr: herdr ?? fakeHerdr(),
      // BB-450 D9: `start` polls for a fresh heartbeat after spawning; these
      // tests only care that a spawn happened, so settle in one fast attempt
      // rather than waiting on a real timer.
      sleep: async () => {},
      startPollIntervalMs: 0,
      startPollAttempts: 1,
    };
    await buildConductorProgram(deps).parseAsync(['conductor', ...argv], {
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
      label: 'registry test',
      project: 'bakers',
      states: ['coding'],
      prompt: DEFAULT_AGENT_PROMPT,
      max_parallel: 1,
      poll_interval_ms: 5000,
      lease_seconds: 300,
      machine_id: 'mid-registry',
      config_path: join(home, '.bakers', 'conductor.config.js'),
    } as ConductorFileConfig;
  }
});

class ListRemote extends FakeBbRemote {
  constructor(private readonly rows: ConductorStatus[]) {
    super();
  }

  override async listConductors(): Promise<ConductorStatus[]> {
    return this.rows;
  }
}

function fakeHerdr(): HerdrHost & { spawned: string[][] } {
  const spawned: string[][] = [];
  return {
    spawned,
    async spawn(handle: string, cwd: string, cmd: string) {
      spawned.push([handle, cwd, cmd]);
    },
  } as HerdrHost & { spawned: string[][] };
}
