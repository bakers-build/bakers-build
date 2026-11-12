import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentRuntimeInfo } from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { type BackendDeps, dockerRuntime, shortHash } from '../src/backend.js';

type Call = [string, string[]];

let root: string;
let ws: string;
let common: string;
let cache: string;
let calls: Call[];
let warnings: string[];

/** A harness the runtime knows nothing about. */
const agent = (installCommand = 'install-agent'): AgentRuntimeInfo => ({
  installCommand,
  modelApi: {
    credentialHint: 'fake hint: set MODEL_TOKEN',
    target: 'https://api.example',
    baseUrlEnv: 'MODEL_BASE_URL',
    keyEnv: 'MODEL_KEY',
    auth: { MODEL_TOKEN: { set: { authorization: 'Bearer {value}' } } },
  },
});

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
  cache = join(root, 'cache');
  for (const d of [ws, common, join(common, 'worktrees/tree')])
    mkdirSync(d, { recursive: true });
  mkdirSync(join(root, 'transcripts'));
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
      MODEL_TOKEN: 'oauth',
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
  command: 'agent --go',
  env: { BAKERS_CONDUCTOR_TOKEN: 'tok' },
  workspacePath: ws,
  run: { uuid: 'r-uuid', id: 7 },
  harness: 'fake',
  ...agent(),
  homePath: join(
    cache,
    'bakers/runtime',
    (over.run as { uuid: string } | undefined)?.uuid ?? 'r-uuid',
  ),
  readPaths: [],
  writePaths: [join(root, 'transcripts')],
  ...over,
});

describe('runtime-docker wrap', () => {
  it("prepares the run home and adds the agent's env and mounts", async () => {
    const out = await dockerRuntime({}, deps()).wrap(launch());
    const home = join(cache, 'bakers/runtime/r-uuid');
    expect(existsSync(home)).toBe(true);
    expect(existsSync(join(common, 'hooks'))).toBe(true);
    expect(out.command).toMatch(/^'?docker'? 'run'/);
    expect(out.command).toContain(`'${home}:${home}'`);
    expect(out.command).toContain(
      `'${join(root, 'transcripts')}:${join(root, 'transcripts')}'`,
    );
    expect(out.command).not.toContain('oauth');
    expect(out.env.MODEL_TOKEN).toBe('oauth');
  });

  it('puts the conductor own bakers CLI into the run home bin', async () => {
    const home = join(cache, 'bakers/runtime/r-uuid');
    await dockerRuntime({}, deps({ bakersEntry: '/opt/cli/bin/bakers' })).wrap(
      launch(),
    );
    expect(readFileSync(join(home, 'bin/bakers'), 'utf8')).toBe(
      '#!/bin/sh\nexec node \'/opt/cli/bin/bakers\' "$@"\n',
    );
  });

  it('protects the worktree Git files the host reads later', async () => {
    writeFileSync(
      join(ws, '.git'),
      `gitdir: ${join(common, 'worktrees/tree')}\n`,
    );
    const out = await dockerRuntime({}, deps()).wrap(launch());
    const gitDir = join(common, 'worktrees/tree');
    // Bound read-only, so each must exist before docker would create it as root.
    expect(readFileSync(join(gitDir, 'config.worktree'), 'utf8')).toBe('');
    expect(readFileSync(join(common, 'config.worktree'), 'utf8')).toBe('');
    for (const d of ['modules', 'worktrees'])
      expect(existsSync(join(common, d))).toBe(true);
    expect(out.command).toContain(
      `'${join(ws, '.git')}:${join(ws, '.git')}:ro'`,
    );
    expect(out.command).toContain(
      `'${gitDir}/commondir:${gitDir}/commondir:ro'`,
    );
  });

  it('refuses a run uuid that is not a plain name', async () => {
    for (const uuid of ['', '../x', 'a/b'])
      await expect(
        dockerRuntime({}, deps()).wrap(launch({ run: { uuid, id: 7 } })),
      ).rejects.toThrow(/run uuid/);
  });

  it('refuses without a model credential', async () => {
    const rt = dockerRuntime({}, deps({ env: { XDG_CACHE_HOME: cache } }));
    await expect(rt.wrap(launch())).rejects.toThrow(/fake hint/);
  });

  it('requires installation metadata only for the default image', async () => {
    await expect(
      dockerRuntime({}, deps()).wrap(launch({ installCommand: undefined })),
    ).rejects.toThrow(/installCommand/);
    await expect(
      dockerRuntime({ image: 'mine' }, deps()).wrap(
        launch({ installCommand: undefined, modelApi: undefined }),
      ),
    ).resolves.toMatchObject({ env: expect.any(Object) });
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
    await rt.wrap(
      launch({
        installCommand: 'install-other',
      }),
    );
    const build = (install: string) => [
      'docker',
      [
        'build',
        '-t',
        `bakers-runtime:1.2.3-${shortHash(install)}`,
        '--build-arg',
        `AGENT_INSTALL=${install}`,
        '/pkg/image',
      ],
    ];
    expect(calls.filter(([, a]) => a[0] === 'build')).toEqual([
      build('install-agent'),
      build('install-other'),
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

  it('keeps the workspace record and home when container removal fails', async () => {
    const d = deps();
    const exec = d.exec;
    d.exec = async (file, args) => {
      if (file === 'docker' && args[0] === 'ps') return { stdout: 'running' };
      if (file === 'docker' && args[0] === 'rm') throw new Error('busy');
      return exec(file, args);
    };
    const runtime = dockerRuntime({}, d);
    await runtime.wrap(launch());
    await runtime.cleanup({ uuid: 'r-uuid', id: 7 });
    expect(
      existsSync(join(cache, 'bakers/runtime/r-uuid.workspace.json')),
    ).toBe(true);
    expect(existsSync(join(cache, 'bakers/runtime/r-uuid'))).toBe(true);
  });

  it('quarantines a repository the run planted, so host git runs nothing of it', async () => {
    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    };
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString();
    const main = join(root, 'repo');
    const tree = join(root, 'linked');
    mkdirSync(main);
    git(main, 'init', '-q');
    git(main, 'commit', '-q', '--allow-empty', '-m', 'base');
    git(main, 'worktree', 'add', '-q', tree, '-b', 'run');
    // What the run does inside the container: a nested repo whose config runs a command.
    const marker = join(root, 'planted-ran');
    const hook = join(root, 'fsmonitor.sh');
    writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, {
      mode: 0o755,
    });
    const sub = join(tree, 'sub');
    mkdirSync(sub);
    git(sub, 'init', '-q');
    writeFileSync(join(sub, 'f'), 'x');
    git(sub, 'add', 'f');
    git(sub, 'commit', '-q', '-m', 'sub');
    git(sub, 'config', 'core.fsmonitor', hook);
    git(tree, 'add', 'sub');
    // A submodule the host initialised itself points into the read-only modules dir.
    const kept = join(tree, 'kept');
    mkdirSync(kept);
    writeFileSync(
      join(kept, '.git'),
      `gitdir: ${join(main, '.git/modules/kept')}\n`,
    );
    git(tree, 'status');
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);

    const d = deps({
      exec: async (file, args) => {
        calls.push([file, args]);
        return file === 'git'
          ? { stdout: git(tree, ...args.slice(2)) }
          : { stdout: '' };
      },
    });
    const runtime = dockerRuntime({}, d);
    await runtime.wrap(launch({ workspacePath: tree }));
    await runtime.cleanup({ uuid: 'r-uuid', id: 7 });

    git(tree, 'status');
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(sub, '.git'))).toBe(false);
    expect(
      readdirSync(sub).some((name) =>
        name.startsWith('.git.bakers-quarantine-'),
      ),
    ).toBe(true);
    expect(existsSync(join(kept, '.git'))).toBe(true);
    expect(existsSync(join(tree, '.git'))).toBe(true);
    expect(warnings).toContain(
      'runtime quarantined repositories the run planted',
    );
  });

  it('deletes nothing for a run uuid that is not a plain name', async () => {
    const homes = join(cache, 'bakers/runtime');
    mkdirSync(join(homes, 'other'), { recursive: true });
    mkdirSync(join(cache, 'bakers/x'), { recursive: true });
    for (const uuid of ['', '../x'])
      await dockerRuntime({}, deps()).cleanup({ uuid, id: 7 });
    expect(existsSync(join(homes, 'other'))).toBe(true);
    expect(existsSync(join(cache, 'bakers/x'))).toBe(true);
    expect(calls).toEqual([]);
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
      ['network', 'create', '--internal', 'bb-runtime-aaa'],
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

  it('keeps each conductor run network separate from the other proxy', async () => {
    const state = { networks: new Set<string>() };
    for (const conductorKey of ['aaa', 'bbb']) {
      const rt = dockerRuntime(allowOpts, {
        ...fakeDocker(state),
        conductorKey,
      });
      await rt.toolServerHosts?.();
      rt.toolsUrl?.('http://127.0.0.1:4242');
      const out = await rt.wrap(launch({ run: { uuid: conductorKey, id: 7 } }));
      expect(out.command).toContain(`'--network' 'bb-runtime-${conductorKey}'`);
      expect(calls).toContainEqual([
        'docker',
        [
          'network',
          'connect',
          `bb-runtime-${conductorKey}`,
          `bb-runtime-proxy-${conductorKey}`,
        ],
      ]);
    }
    expect([...state.networks].sort()).toEqual([
      'bb-runtime-aaa',
      'bb-runtime-bbb',
      'bb-runtime-egress',
    ]);
  });

  it('tells the agent the placeholder key the run holds', async () => {
    const out = await wrapped({ networks: new Set() });
    expect(out.command).toContain("'MODEL_KEY=bb-runtime-placeholder'");
    expect(out.command).toContain(
      "'MODEL_BASE_URL=http://bb-runtime-proxy-aaa:8081'",
    );
  });

  it('starts its sidecar with the credential by name and keeps it out of the run', async () => {
    const out = await wrapped({ networks: new Set() });
    const runCall = calls.find(([, a]) => a[0] === 'run' && a.includes('-d'));
    const args = runCall?.[1] ?? [];
    expect(args).toContain('bb-runtime-proxy-aaa');
    expect(args).toContain('MODEL_TOKEN');
    expect(args).toContain('BB_ALLOW=registry.npmjs.org');
    expect(args).toContain('BB_API_TARGET=https://api.example');
    expect(args).toContain(
      `BB_API_AUTH=${JSON.stringify(agent().modelApi!.auth)}`,
    );
    expect(args).toContain('BB_TOOLS=172.30.0.1:4242');
    expect(args.join(' ')).not.toContain('oauth');
    expect(calls).toContainEqual([
      'docker',
      ['network', 'connect', 'bb-runtime-aaa', 'bb-runtime-proxy-aaa'],
    ]);
    expect(out.env.MODEL_TOKEN).toBeUndefined();
    expect(out.command).toContain("'bb-runtime-aaa'");
  });

  it('recreates a sidecar still attached to the old shared run network', async () => {
    const oldHash = shortHash(
      JSON.stringify([
        '172.30.0.1',
        '4242',
        allowOpts.allow,
        `bakers-runtime:1.2.3-${shortHash('install-agent')}`,
        agent().modelApi,
      ]),
    );
    await wrapped({ networks: new Set(), label: oldHash });
    expect(calls).toContainEqual([
      'docker',
      ['rm', '-f', 'bb-runtime-proxy-aaa'],
    ]);
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
