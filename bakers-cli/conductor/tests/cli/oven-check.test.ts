import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseClaudeTranscript } from '@bakers-build/addon-claude';
import {
  FakeBbRemote,
  fakeExecutor,
  fakeRemote,
  fakeWorkspace,
} from '@bakers-build/addon-fake';
import type {
  BbAgent,
  ConductorFileConfig,
  ResolvedAgent,
  RuntimePlugin,
  SandboxPreflight,
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

const agent = (id: string, result: SandboxPreflight): ResolvedAgent => ({
  id,
  agent: {
    id,
    launchCommand: () => id,
    getRunLog: async () => '',
    parseFootprint: parseClaudeTranscript,
    sandboxPreflight: async () => result,
  } satisfies BbAgent,
});

const MISSING: SandboxPreflight = {
  ok: false,
  cause: 'socat not found',
  fix: 'install it with sudo apt-get install -y socat',
};
const LINE =
  'sandbox unavailable: claude: socat not found — install it with sudo apt-get install -y socat (see https://bakers.build/docs/advanced/run-security#sandbox-prerequisites)';

// Fake plugins all carry id 'fake'; makeConfig sets where each came from and
// the server's package, which check prints in place of the id.
const SLOTS = [
  'server: @bakers-build/addon-remote-drupal (default)',
  'executor: fake (addons)',
  'worktree: fake (slot)',
];

describe('bakers conductor check / start sandbox report', () => {
  let home: string;
  let out: string[];
  const originalLog = process.env.BAKERS_CONDUCTOR_LOG;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'bakers-oven-check-'));
    process.env.BAKERS_CONDUCTOR_LOG = 'silent';
    process.exitCode = undefined;
    out = [];
    const record = (...args: unknown[]) => {
      out.push(args.map(String).join(' '));
    };
    vi.spyOn(console, 'log').mockImplementation(record);
    vi.spyOn(console, 'warn').mockImplementation(record);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
    process.exitCode = undefined;
    if (originalLog === undefined) delete process.env.BAKERS_CONDUCTOR_LOG;
    else process.env.BAKERS_CONDUCTOR_LOG = originalLog;
  });

  it('check prints one line per agent and exits 1 on a failure', async () => {
    await run(
      ['check'],
      [agent('claude', MISSING), agent('codex', { ok: true })],
    );
    expect(out).toEqual([...SLOTS, LINE, 'codex: sandbox ok']);
    expect(process.exitCode).toBe(1);
  });

  it('check exits 0 when every agent can start its sandbox', async () => {
    await run(['check'], [agent('claude', { ok: true })]);
    expect(out).toEqual([...SLOTS, 'claude: sandbox ok']);
    expect(process.exitCode).toBeUndefined();
  });

  it.each([
    'check',
    'start',
  ])('%s warns about unchecked runtime prerequisites without failing', async (command) => {
    const spawner = fakeSpawn();
    await run(
      command === 'check' ? ['check'] : ['start', '--no-update-check'],
      [agent('claude', { ok: true })],
      spawner,
      {
        kind: 'runtime',
        id: 'docker',
        isolates: true,
        requiredModules: [],
        createRuntime: async () => {
          throw new Error('not needed');
        },
      },
    );
    expect(out).toContainEqual(
      expect.stringMatching(/warning:.*host only.*docker.*not checked/),
    );
    if (command === 'check') expect(process.exitCode).toBeUndefined();
    else expect(spawner.spawned).toHaveLength(1);
  });

  it('check names each agent by its alias', async () => {
    await run(
      ['check'],
      [
        { ...agent('claude', MISSING), alias: 'claude-fast' },
        { ...agent('claude', { ok: true }), alias: 'claude-deep' },
      ],
    );
    expect(out).toEqual([
      ...SLOTS,
      LINE.replace('claude:', 'claude-fast:'),
      'claude-deep: sandbox ok',
    ]);
  });

  it('start warns about the sandbox and still launches the conductor', async () => {
    const spawner = fakeSpawn();
    await run(
      ['start', '--no-update-check'],
      [agent('claude', MISSING)],
      spawner,
    );
    expect(out).toContain(`warning: ${LINE}`);
    expect(spawner.spawned).toHaveLength(1);
  });

  async function run(
    argv: string[],
    agents: ResolvedAgent[],
    spawner = fakeSpawn(),
    runtime?: RuntimePlugin,
  ): Promise<void> {
    await buildConductorProgram({
      remote: new FakeBbRemote(),
      config: { ...makeConfig(), ...(runtime ? { runtime } : {}) },
      agents,
      spawnConductor: spawner,
      sleep: async () => {},
      startPollIntervalMs: 0,
      startPollAttempts: 1,
    }).parseAsync(['conductor', ...argv], { from: 'user' });
  }

  function makeConfig(): ConductorFileConfig {
    return {
      site: { base_url: 'http://web', jsonapi_prefix: '/jsonapi' },
      remote: fakeRemote(),
      executor: fakeExecutor(),
      agent: [],
      workspace: fakeWorkspace(),
      slot_sources: { server: 'default', executor: 'addons', worktree: 'slot' },
      slot_packages: { server: '@bakers-build/addon-remote-drupal' },
      label: 'check test',
      project: 'bakers',
      states: ['working'],
      prompt: DEFAULT_AGENT_PROMPT,
      max_parallel: 1,
      poll_interval_ms: 5000,
      lease_seconds: 300,
      conductor_id: 'mid-check',
      config_path: join(home, '.bakers', 'project.config.js'),
    };
  }
});

function fakeSpawn(): NonNullable<BbCliDeps['spawnConductor']> & {
  spawned: string[][];
} {
  const spawned: string[][] = [];
  const spawn = async (req: { argv: string[] }) => {
    spawned.push(req.argv);
    return { pid: 9999, exited: new Promise<number | null>(() => {}) };
  };
  return Object.assign(spawn, { spawned });
}
