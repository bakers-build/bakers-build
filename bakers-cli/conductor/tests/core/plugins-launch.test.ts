import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FakeBbRemote,
  fakeExecutor,
  fakeRemote,
  fakeWorkspace,
} from '@bakers-build/addon-fake';
import type {
  BbAgent,
  BbExecutor,
  BbWorkspace,
  ConductorFileConfig,
  EnsuredWorkspace,
  HookName,
  HookResult,
  MarketplaceDeclaration,
  SpawnRunInput,
  WorktreeTeardown,
} from '@bakers-build/conductor/contract';
import { emptyAgentFootprint } from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';
import { homeKey, homePath } from '../../src/plugins/agent-home.js';
import { TestConductor } from '../test-conductor.js';

const CHECKOUT = '/tmp/bakers-plugins-launch-checkout';
const probe: MarketplaceDeclaration = {
  url: 'https://probe.invalid/probe.git',
  ref: 'vA',
  plugins: ['probe-plugin'],
};

beforeEach(() => vi.stubEnv('XDG_CACHE_HOME', '/cache'));
const workspaces: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of workspaces.splice(0))
    rmSync(path, { recursive: true, force: true });
});

class RecordingWorkspace implements BbWorkspace {
  constructor(private readonly path?: string) {}
  async ensure(identifier: string): Promise<EnsuredWorkspace> {
    const path =
      this.path ?? mkdtempSync(join(tmpdir(), `bakers-plugins-${identifier}-`));
    mkdirSync(join(path, '.bakers'), { recursive: true });
    workspaces.push(path);
    return {
      path,
      instructions: null,
      created: true,
    };
  }
}

class RecordingExecutor implements BbExecutor {
  readonly id = 'recording';
  readonly started: SpawnRunInput[] = [];
  capabilities() {
    return { persistent: false };
  }
  async runHook(name: HookName): Promise<HookResult> {
    return { hook: name, ran: true, ok: true };
  }
  async startRun(input: SpawnRunInput) {
    this.started.push(input);
    return { sessionRef: input.ticket.branchName };
  }
  async stopRun(): Promise<void> {}
  async cleanupRun(): Promise<void> {}
  async removeWorktree(): Promise<WorktreeTeardown> {
    return 'unverified';
  }
}

async function dispatch(
  agent: BbAgent,
  marketplaces: MarketplaceDeclaration[] = [probe],
  ticket: { recipe?: string; worktree?: string } = {},
) {
  const remote = new FakeBbRemote({
    tickets: {
      't-1': {
        identifier: 'BB-1',
        title: 'One',
        state: 'working',
        ...(ticket.recipe ? { recipe: ticket.recipe, type: 'feature' } : {}),
      },
    },
  });
  remote.queue.push({
    runUuid: 'r-1',
    runId: 1,
    ticketUuid: 't-1',
    stateAtStart: 'working',
    handler: 'code',
  });
  const executor = new RecordingExecutor();
  const logs: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
  const mk = (obj: object, msg?: string) =>
    logs.push({ obj: obj as Record<string, unknown>, msg });
  const log: ConductorLogger = { debug: mk, info: mk, warn: mk, error: mk };
  const config: ConductorFileConfig = {
    site: { base_url: 'http://web', jsonapi_prefix: '/jsonapi' },
    remote: fakeRemote(),
    executor: fakeExecutor(),
    workspace: fakeWorkspace(),
    label: 'test',
    conductor_id: 'bakers-test-conductor',
    project: 'bakers',
    states: ['working'],
    prompt: DEFAULT_AGENT_PROMPT,
    host_key: 'test-host',
    poll_interval_ms: 5000,
    lease_seconds: 300,
    config_path: `${CHECKOUT}/conductor.config.js`,
    marketplaces,
  } as unknown as ConductorFileConfig;
  const conductor = new TestConductor(
    config,
    remote,
    executor,
    new RecordingWorkspace(ticket.worktree),
    [{ id: agent.id, alias: 'opus', permissions: 'sandbox', agent }],
    log,
    CHECKOUT,
  );
  await conductor.start();
  await conductor.tick();
  const entry = logs.find((l) => l.msg === 'plugins')?.obj.plugins as
    | Record<string, unknown>
    | undefined;
  return { executor, remote, entry };
}

const baseAgent = (calls: string[], extra: Partial<BbAgent> = {}): BbAgent => ({
  id: 'claude',
  launchCommand: (_p, _run, _ws, _tools, _env, args) => {
    calls.push(`launch ${(args ?? []).join(' ')}`);
    return 'claude';
  },
  getRunLog: async () => '',
  parseFootprint: () => emptyAgentFootprint(),
  ...extra,
});

describe('conductor: a run starts with the project plugins installed', () => {
  it('installs into the per-declaration home before launch, passing env and args on', async () => {
    const calls: string[] = [];
    const agent = baseAgent(calls, {
      installPlugins: async (marketplaces, home) => {
        calls.push(`install ${home} ${marketplaces[0]?.plugins[0]}`);
        return {
          env: { CLAUDE_CONFIG_DIR: home },
          args: ['--plugin-flag'],
          home: 'built',
          trust_bypass: ['hooks'],
        };
      },
    });
    const { executor, entry } = await dispatch(agent);
    const home = homePath('claude', homeKey([probe]));
    expect(calls).toEqual([
      `install ${home} probe-plugin`,
      'launch --plugin-flag',
    ]);
    expect(executor.started[0]?.env.CLAUDE_CONFIG_DIR).toBe(home);
    expect(entry).toMatchObject({
      harness: 'claude',
      alias: 'opus',
      mode: 'sandbox',
      state: 'on',
      hash: homeKey([probe]),
      home,
      outcome: 'built',
      marketplaces: [probe],
      trust_bypass: ['hooks'],
    });
  });

  it('starts the run without a skill check once the plugins are installed', async () => {
    // Neither the recipe skill nor a checks table in WORKFLOW.md can block the start.
    const worktree = mkdtempSync(join(tmpdir(), 'bakers-plugins-launch-'));
    writeFileSync(
      join(worktree, 'WORKFLOW.md'),
      '## bb-phase-work\n\n### Checks\n\n| Check | `args` for `provision_exec` |\n|---|---|\n| PHPCS | `.ddev/commands/web/phpcs` |\n',
    );
    const agent = baseAgent([], {
      installPlugins: async (_m, _home) => ({
        env: {},
        args: [],
        home: 'reused',
      }),
    });
    const { executor, remote, entry } = await dispatch(agent, [probe], {
      recipe: 'matt',
      worktree,
    });
    expect(executor.started).toHaveLength(1);
    expect(remote.calls.markFailed).toHaveLength(0);
    expect(entry).toMatchObject({ state: 'on', outcome: 'reused' });
    expect(entry).not.toHaveProperty('required_skills');
    expect(entry).not.toHaveProperty('failure');
  });

  it.each([
    ['unsupported', {}, [probe]],
    ['disabled', { pluginsDisabled: true }, [probe]],
    ['none declared', {}, []],
  ] as const)('runs without plugins when they are off (%s)', async (reason, extra, marketplaces) => {
    const calls: string[] = [];
    const install = vi.fn();
    const agent = baseAgent(calls, {
      ...extra,
      ...(reason === 'unsupported' ? {} : { installPlugins: install }),
    });
    const { executor, entry } = await dispatch(agent, [...marketplaces]);
    expect(install).not.toHaveBeenCalled();
    expect(executor.started).toHaveLength(1);
    expect(entry).toMatchObject({
      harness: 'claude',
      state: `off (${reason})`,
    });
  });

  it('fails the run start, naming harness and reason, when the install fails', async () => {
    const calls: string[] = [];
    const agent = baseAgent(calls, {
      installPlugins: async () => {
        throw new Error(
          'probe-plugin: claude plugin install exited 1: not found',
        );
      },
    });
    const { executor, remote, entry } = await dispatch(agent);
    expect(executor.started).toHaveLength(0);
    const failed = remote.calls.markFailed[0]?.errorLog ?? '';
    expect(failed).toMatch(/plugins.*claude.*probe-plugin.*not found/);
    expect(entry).toMatchObject({
      harness: 'claude',
      failure: expect.stringContaining('not found'),
    });
  });
});
