import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

describe('the secrets file at conductor start', () => {
  let home: string;
  let file: string;
  const originalHome = process.env.BAKERS_HOME;
  const originalLog = process.env.BAKERS_CONDUCTOR_LOG;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'bakers-secrets-start-'));
    mkdirSync(join(home, '.bakers'));
    process.env.BAKERS_HOME = join(home, '.bakers');
    process.env.BAKERS_CONDUCTOR_LOG = 'silent';
    file = join(home, '.bakers', '.bakers.env');
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
    rmSync(home, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.BAKERS_HOME;
    else process.env.BAKERS_HOME = originalHome;
    if (originalLog === undefined) delete process.env.BAKERS_CONDUCTOR_LOG;
    else process.env.BAKERS_CONDUCTOR_LOG = originalLog;
  });

  class RecordingRemote extends FakeBbRemote {
    registrations: ConductorRegistration[] = [];
    override async registerConductor(
      reg: ConductorRegistration,
    ): Promise<string> {
      this.registrations.push(reg);
      return super.registerConductor(reg);
    }
  }

  function setup() {
    const remote = new RecordingRemote();
    const spawned: unknown[] = [];
    const deps: BbCliDeps = {
      remote,
      config: {
        site: { base_url: 'http://web', jsonapi_prefix: '/jsonapi' },
        remote: fakeRemote(),
        executor: fakeExecutor(),
        agent: [{ agent: claudeAgent() }],
        workspace: fakeWorkspace(),
        label: 'secrets test',
        project: 'bakers',
        states: ['working'],
        prompt: DEFAULT_AGENT_PROMPT,
        max_parallel: 1,
        poll_interval_ms: 5,
        lease_seconds: 300,
        conductor_id: 'secrets-test',
        host_key: 'secrets-host',
        config_path: join(home, 'project.config.js'),
      } as ConductorFileConfig,
      executor: new FakeExecutor({ outcome: 'exited' }),
      workspace: new FakeWorkspace(),
      agents: [{ id: 'claude', agent: claudeAgent() }],
      spawnConductor: async (req) => {
        spawned.push(req);
        throw new Error('this test must not spawn');
      },
    };
    return { remote, spawned, deps };
  }

  async function run(deps: BbCliDeps, args: string[]) {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await buildConductorProgram(deps).parseAsync(args, { from: 'user' });
      return err.mock.calls.map((c) => String(c[0])).join('\n');
    } finally {
      err.mockRestore();
      log.mockRestore();
    }
  }

  const starts: Array<[string, string[]]> = [
    [
      'foreground start',
      ['conductor', 'start', '--foreground', '--no-update-check'],
    ],
    ['detached start', ['conductor', 'start', '--no-update-check']],
    ['poll', ['conductor', 'once']],
  ];

  for (const [name, args] of starts) {
    it(`${name}: refuses a file others can read, naming the fix and no value`, async () => {
      writeFileSync(file, 'CLAUDE_CODE_OAUTH_TOKEN=sk-leak\n', { mode: 0o644 });
      const { remote, spawned, deps } = setup();
      const stderr = await run(deps, args);
      expect(process.exitCode).toBe(1);
      expect(stderr).toContain(file);
      expect(stderr).toContain(`chmod 600 ${file}`);
      expect(stderr).not.toContain('sk-leak');
      expect(remote.registrations).toHaveLength(0);
      expect(spawned).toHaveLength(0);
    });

    it(`${name}: refuses a malformed file by line number, no value`, async () => {
      writeFileSync(file, '# ok\nsk-leak-line\n', { mode: 0o600 });
      const { remote, spawned, deps } = setup();
      const stderr = await run(deps, args);
      expect(process.exitCode).toBe(1);
      expect(stderr).toContain('line 2');
      expect(stderr).not.toContain('sk-leak');
      expect(remote.registrations).toHaveLength(0);
      expect(spawned).toHaveLength(0);
    });
  }
});
