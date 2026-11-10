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
    expect(out).toEqual([LINE, 'codex: sandbox ok']);
    expect(process.exitCode).toBe(1);
  });

  it('check exits 0 when every agent can start its sandbox', async () => {
    await run(['check'], [agent('claude', { ok: true })]);
    expect(out).toEqual(['claude: sandbox ok']);
    expect(process.exitCode).toBeUndefined();
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
  ): Promise<void> {
    await buildConductorProgram({
      remote: new FakeBbRemote(),
      config: makeConfig(),
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
