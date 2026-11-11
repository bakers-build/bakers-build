import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConductorLogger } from '@bakers-build/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { transcriptKey } from '../src/args.js';
import { type BackendDeps, dockerRuntime } from '../src/backend.js';

type Call = [string, string[]];

let root: string;
let ws: string;
let common: string;
let agentHome: string;
let cache: string;
let calls: Call[];
let warnings: string[];

const logger: ConductorLogger = {
  debug: () => {},
  info: () => {},
  warn: (_o: object, msg?: string) => warnings.push(msg ?? ''),
  error: () => {},
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bb-runtime-'));
  ws = join(root, 'tree');
  common = join(root, 'main/.git');
  agentHome = join(root, 'agent');
  cache = join(root, 'cache');
  for (const d of [ws, common, join(common, 'worktrees/tree'), agentHome])
    mkdirSync(d, { recursive: true });
  writeFileSync(join(agentHome, 'settings.json'), '{"s":1}');
  writeFileSync(join(agentHome, '.claude.json'), '{"c":1}');
  writeFileSync(join(agentHome, '.credentials.json'), '{"secret":1}');
  calls = [];
  warnings = [];
});

function deps(over: Partial<BackendDeps> = {}): BackendDeps {
  return {
    exec: async (file, args) => {
      calls.push([file, args]);
      if (file === 'git' && args.includes('--git-common-dir'))
        return { stdout: `${common}\n` };
      if (file === 'git' && args.includes('--git-dir'))
        return { stdout: `${join(common, 'worktrees/tree')}\n` };
      return { stdout: '' };
    },
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
      XDG_CACHE_HOME: cache,
      HOME: join(root, 'home'),
    },
    logger,
    cliRoot: '/opt/cli',
    packageDir: '/pkg',
    version: '1.2.3',
    ...over,
  };
}

const launch = (over: Record<string, unknown> = {}) => ({
  command: 'claude --go',
  env: { CLAUDE_CONFIG_DIR: agentHome, BAKERS_CONDUCTOR_TOKEN: 'tok' },
  workspacePath: ws,
  run: { uuid: 'r-uuid', id: 7 },
  harness: 'claude',
  ...over,
});

describe('runtime-docker wrap', () => {
  it('prepares the run home without the credentials file', async () => {
    const rt = dockerRuntime({}, deps());
    const out = await rt.wrap(launch());
    const home = join(cache, 'bakers/runtime/r-uuid');
    expect(readFileSync(join(home, '.claude/settings.json'), 'utf8')).toBe(
      '{"s":1}',
    );
    expect(existsSync(join(home, '.claude/.claude.json'))).toBe(true);
    expect(existsSync(join(home, '.claude/.credentials.json'))).toBe(false);
    expect(existsSync(join(common, 'hooks'))).toBe(true);
    expect(out.command).toMatch(/^'?docker'? 'run'/);
    expect(out.command).toContain(`'${home}:/home/run'`);
    expect(out.command).not.toContain('oauth');
    expect(out.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth');
  });

  it('seeds a finished onboarding so Claude does not wait at first-run setup', async () => {
    const home = join(cache, 'bakers/runtime/r-uuid');
    await dockerRuntime({}, deps()).wrap(launch());
    expect(
      JSON.parse(readFileSync(join(home, '.claude/.claude.json'), 'utf8')),
    ).toEqual({ c: 1, hasCompletedOnboarding: true });
    const { CLAUDE_CONFIG_DIR: _, ...noAgentHome } = launch().env;
    await dockerRuntime({}, deps()).wrap(launch({ env: noAgentHome }));
    expect(
      JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')),
    ).toEqual({ hasCompletedOnboarding: true });
  });

  it('creates every mount point in the run home before docker does', async () => {
    const home = join(cache, 'bakers/runtime/r-uuid');
    await dockerRuntime({}, deps()).wrap(launch());
    expect(existsSync(join(home, '.claude/projects', transcriptKey(ws)))).toBe(
      true,
    );
    expect(existsSync(join(home, '.claude/plugins'))).toBe(true);
  });

  it('refuses without a model credential', async () => {
    const rt = dockerRuntime({}, deps({ env: { XDG_CACHE_HOME: cache } }));
    await expect(rt.wrap(launch())).rejects.toThrow(/claude setup-token/);
  });

  it('refuses a non-Claude harness on the default image', async () => {
    await expect(
      dockerRuntime({}, deps()).wrap(launch({ harness: 'codex' })),
    ).rejects.toThrow(/codex/);
    await expect(
      dockerRuntime({ image: 'mine' }, deps()).wrap(
        launch({ harness: 'codex' }),
      ),
    ).resolves.toBeDefined();
  });

  it('builds the default image once when missing', async () => {
    const d = deps({
      exec: async (file, args) => {
        if (args[0] === 'image') {
          calls.push([file, args]);
          throw new Error('No such image');
        }
        return deps().exec(file, args);
      },
    });
    const rt = dockerRuntime({}, d);
    await rt.wrap(launch());
    await rt.wrap(launch({ run: { uuid: 'r-2', id: 8 } }));
    const builds = calls.filter(([, a]) => a[0] === 'build');
    expect(builds).toEqual([
      ['docker', ['build', '-t', 'bakers-runtime:1.2.3', '/pkg/image']],
    ]);
  });

  it('never builds an operator image', async () => {
    const d = deps({
      exec: async (file, args) => {
        calls.push([file, args]);
        if (args[0] === 'image') throw new Error('No such image');
        return { stdout: '' };
      },
    });
    await expect(
      dockerRuntime({ image: 'mine:1' }, d).wrap(launch()),
    ).rejects.toThrow(/mine:1/);
    expect(calls.some(([, a]) => a[0] === 'build')).toBe(false);
  });
});

describe('runtime-docker cleanup', () => {
  it('removes only this run container and its home', async () => {
    const home = join(cache, 'bakers/runtime/r-uuid');
    mkdirSync(home, { recursive: true });
    const d = deps({
      exec: async (file, args) => {
        calls.push([file, args]);
        return { stdout: args[0] === 'ps' ? 'abc\ndef\n' : '' };
      },
    });
    await dockerRuntime({}, d).cleanup({ uuid: 'r-uuid', id: 7 });
    expect(calls).toEqual([
      [
        'docker',
        [
          'ps',
          '-aq',
          '--filter',
          'name=^bb-run-r-uuid$',
          '--filter',
          'label=build.bakers.run=r-uuid',
        ],
      ],
      ['docker', ['rm', '-f', 'abc', 'def']],
    ]);
    expect(existsSync(home)).toBe(false);
  });

  it('skips rm when no container is left', async () => {
    await dockerRuntime({}, deps()).cleanup({ uuid: 'r-uuid', id: 7 });
    expect(calls.map(([, a]) => a[0])).toEqual(['ps']);
  });

  it('tolerates a missing docker', async () => {
    const d = deps({
      exec: async () => {
        throw new Error('spawn docker ENOENT');
      },
    });
    await expect(
      dockerRuntime({}, d).cleanup({ uuid: 'r-uuid', id: 7 }),
    ).resolves.toBeUndefined();
    expect(warnings).toContain('runtime container cleanup failed');
  });
});

describe('runtime-docker allowlist mode', () => {
  const allowOpts = {
    network: 'allowlist' as const,
    allow: ['registry.npmjs.org'],
  };

  function fakeDocker(state: { networks: Set<string>; label?: string }) {
    return deps({
      conductorKey: 'aaa',
      exec: async (file, args) => {
        calls.push([file, args]);
        if (file === 'git') return deps().exec(file, args);
        if (args[0] === 'network' && args[1] === 'inspect') {
          const name = args[args.length - 1] as string;
          if (!state.networks.has(name)) throw new Error('no such network');
          return { stdout: args.includes('-f') ? '172.30.0.1\n' : '[]' };
        }
        if (args[0] === 'network' && args[1] === 'create')
          state.networks.add(args[args.length - 1] as string);
        if (args[0] === 'inspect') {
          if (state.label === undefined) throw new Error('no such object');
          return { stdout: `${state.label}\n` };
        }
        return { stdout: '' };
      },
    });
  }

  it('points the run at the proxy tool relay', () => {
    const rt = dockerRuntime(allowOpts, deps({ conductorKey: 'aaa' }));
    expect(rt.toolsUrl?.('http://127.0.0.1:4242/mcp')).toBe(
      'http://bb-runtime-proxy-aaa:8082/mcp',
    );
    expect(rt.toolsUrl?.('http://127.0.0.1:4242')).toBe(
      'http://bb-runtime-proxy-aaa:8082',
    );
  });

  it('has no tool relay in host mode', () => {
    const rt = dockerRuntime({}, deps());
    expect(rt.toolsUrl).toBeUndefined();
    expect(rt.toolServerHosts).toBeUndefined();
  });

  it('creates both networks when missing and returns the egress gateway', async () => {
    const state = { networks: new Set<string>() };
    const rt = dockerRuntime(allowOpts, fakeDocker(state));
    expect(await rt.toolServerHosts?.()).toEqual(['172.30.0.1']);
    expect(calls).toContainEqual([
      'docker',
      ['network', 'create', '--internal', 'bb-runtime'],
    ]);
    expect(calls).toContainEqual([
      'docker',
      ['network', 'create', 'bb-runtime-egress'],
    ]);
  });

  async function wrapped(state: { networks: Set<string>; label?: string }) {
    const rt = dockerRuntime(allowOpts, fakeDocker(state));
    await rt.toolServerHosts?.();
    rt.toolsUrl?.('http://127.0.0.1:4242');
    const out = await rt.wrap(launch());
    return out;
  }

  it('starts its sidecar with the credential by name and keeps it out of the run', async () => {
    const out = await wrapped({ networks: new Set() });
    const runCall = calls.find(([, a]) => a[0] === 'run' && a.includes('-d'));
    const args = runCall?.[1] ?? [];
    expect(args).toContain('bb-runtime-proxy-aaa');
    expect(args).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(args).toContain('BB_ALLOW=registry.npmjs.org');
    expect(args).toContain('BB_TOOLS=172.30.0.1:4242');
    expect(args.join(' ')).not.toContain('oauth');
    expect(calls).toContainEqual([
      'docker',
      ['network', 'connect', 'bb-runtime', 'bb-runtime-proxy-aaa'],
    ]);
    expect(out.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(out.command).toContain("'bb-runtime'");
  });

  it('recreates the sidecar only when its config changed', async () => {
    await wrapped({ networks: new Set(), label: 'stale' });
    expect(calls).toContainEqual([
      'docker',
      ['rm', '-f', 'bb-runtime-proxy-aaa'],
    ]);
    const hash = calls
      .find(([, a]) => a[0] === 'run' && a.includes('-d'))?.[1]
      .find((a) => a.startsWith('build.bakers.proxy='))
      ?.split('=')[1];
    calls = [];
    await wrapped({ networks: new Set(), label: hash });
    expect(calls.some(([, a]) => a[0] === 'rm' || a[0] === 'run')).toBe(false);
  });

  it("never touches another conductor's sidecar", async () => {
    await wrapped({ networks: new Set(), label: 'stale' });
    const names = calls
      .flatMap(([, a]) => a)
      .filter((a) => a.includes('bb-runtime-proxy-'));
    expect(names.every((n) => n.includes('bb-runtime-proxy-aaa'))).toBe(true);
  });
});
