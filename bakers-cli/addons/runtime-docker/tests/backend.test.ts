import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentRuntimeInfo } from '@bakers-build/conductor/contract';
import { type ConductorLogger, createRunClone } from '@bakers-build/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type BackendDeps, dockerRuntime, shortHash } from '../src/backend.js';

type Call = [string, string[], string?];

let root: string;
let ws: string;
let common: string;
let cache: string;
let runGit: string;
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
  const main = join(root, 'main');
  mkdirSync(main);
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: main,
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
      stdio: 'pipe',
    });
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  git('branch', 'ticket');
  runGit = createRunClone({
    parent: main,
    workspace: ws,
    gitDir: join(root, 'storage/run.git'),
    branch: 'ticket',
  }).gitDir;
  mkdirSync(join(root, 'transcripts'));
  // The conductor supplies a home already created by prepareRun.
  mkdirSync(join(cache, 'bakers/runtime/r-uuid'), { recursive: true });
  calls = [];
  warnings = [];
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function deps(over: Partial<BackendDeps> = {}): BackendDeps {
  return {
    exec: async (file, args) => {
      calls.push([file, args]);
      if (file === 'git')
        return { stdout: execFileSync(file, args, { encoding: 'utf8' }) };
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
  gitDir: runGit,
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

  it('mounts the run Git directory as .git and no parent Git', async () => {
    const before = readFileSync(join(common, 'config'), 'utf8');
    const out = await dockerRuntime({}, deps()).wrap(launch());
    expect(out.command).toContain(`'${runGit}:${join(ws, '.git')}'`);
    expect(out.command).not.toContain(common);
    expect(readFileSync(join(common, 'config'), 'utf8')).toBe(before);
    expect(calls.filter(([file]) => file === 'git')).toEqual([]);
  });

  it('mounts the parent objects read-only for a shared clone', async () => {
    const objects = join(common, 'objects');
    const out = await dockerRuntime({}, deps()).wrap(
      launch({ sharedObjects: objects }),
    );
    expect(out.command).toContain(`'${objects}:${objects}:ro'`);
  });

  it('refuses a run Git directory inside the workspace', async () => {
    mkdirSync(join(ws, 'inside.git'));
    await expect(
      dockerRuntime({}, deps()).wrap(
        launch({ gitDir: join(ws, 'inside.git') }),
      ),
    ).rejects.toThrow(/outside the workspace/);
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

  it('takes the credential from the secrets the conductor hands out', async () => {
    const rt = dockerRuntime(
      {},
      deps({ env: { XDG_CACHE_HOME: cache, HOME: join(root, 'home') } }),
    );
    const secrets = { MODEL_TOKEN: 'from-file' };
    const prepared = await rt.prepareRun?.(
      { uuid: 'r-uuid', id: 7 },
      { ...agent(), secrets },
    );
    expect(prepared?.env).toEqual(secrets);
    const out = await rt.wrap(launch({ secrets }));
    expect(out.env.MODEL_TOKEN).toBe('from-file');
    expect(out.command).not.toContain('from-file');
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

  it('keeps the home when container removal fails', async () => {
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
    expect(existsSync(join(cache, 'bakers/runtime/r-uuid'))).toBe(true);
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

  it('hands the sidecar a file secret through the exec env, never argv', async () => {
    const seen: Array<{ args: string[]; env?: Record<string, string> }> = [];
    const base = fakeDocker({ networks: new Set() });
    const rt = dockerRuntime(allowOpts, {
      ...base,
      env: { XDG_CACHE_HOME: cache, HOME: join(root, 'home') },
      exec: async (file, args, opts) => {
        seen.push({ args, ...(opts?.env ? { env: opts.env } : {}) });
        return base.exec(file, args);
      },
    });
    await rt.toolServerHosts?.();
    rt.toolsUrl?.('http://127.0.0.1:4242');
    const out = await rt.wrap(
      launch({ secrets: { MODEL_TOKEN: 'from-file' } }),
    );
    const proxy = seen.find(
      ({ args }) => args[0] === 'run' && args.includes('-d'),
    );
    expect(proxy?.args).toContain('MODEL_TOKEN');
    expect(proxy?.args.join(' ')).not.toContain('from-file');
    expect(proxy?.env).toEqual({ MODEL_TOKEN: 'from-file' });
    expect(out.env.MODEL_TOKEN).toBeUndefined();
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

describe('runtime-docker: project additions to the run image', () => {
  const base = `bakers-runtime:1.2.3-${shortHash('install-agent')}`;
  let bakersDir: string;
  let infos: object[];
  let warns: object[];
  beforeEach(() => {
    bakersDir = join(root, 'project/.bakers');
    mkdirSync(bakersDir, { recursive: true });
    infos = [];
    warns = [];
  });
  /** Images that exist start out as `present`; every build adds its tag. */
  const fakeDocker = (present: string[] = []) => {
    const images = new Set(present);
    return deps({
      logger: {
        ...logger,
        info: (o: object) => infos.push(o),
        warn: (o: object) => warns.push(o),
      },
      exec: async (file, args, opts) => {
        calls.push([file, args, ...(opts?.input ? [opts.input] : [])]);
        if (args[0] === 'image' && !images.has(args[2] as string))
          throw new Error('No such image');
        if (args[0] === 'build') images.add(args[2] as string);
        return { stdout: '' };
      },
    });
  };
  const builds = () => calls.filter(([, a]) => a[0] === 'build');
  const additions = (image: object) => ({
    imageAdditions: { image, bakersDir },
  });

  it('builds the layer from the base with apt, npm, Playwright and the fragment', async () => {
    writeFileSync(join(bakersDir, 'run.Dockerfile'), 'RUN echo extra\n');
    const d = fakeDocker();
    const rt = dockerRuntime(
      {},
      {
        ...d,
        ...additions({
          packages: { apt: ['jq'], npm: ['playwright@1.65.0'] },
          dockerfile: 'run.Dockerfile',
        }),
      },
    );
    await rt.wrap(launch());
    const [baseBuild, layer] = builds();
    expect(baseBuild?.[1][2]).toBe(base);
    const tag = layer?.[1][2] as string;
    expect(tag).toMatch(
      new RegExp(`^${base.replace(/[.]/g, '\\.')}-[0-9a-f]{12}$`),
    );
    expect(layer?.[1]).toEqual(['build', '-t', tag, '-f', '-', bakersDir]);
    expect(layer?.[2]).toBe(
      [
        `FROM ${base}`,
        "RUN apt-get update && apt-get install -y --no-install-recommends 'jq' && rm -rf /var/lib/apt/lists/*",
        "RUN npm install -g 'playwright@1.65.0'",
        'ENV NODE_PATH=/usr/local/lib/node_modules',
        'ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright',
        'RUN playwright install --with-deps chromium && chmod -R a+rX /opt/ms-playwright',
        'RUN echo extra',
        '',
      ].join('\n'),
    );
    expect(warns).toContainEqual({ image: tag, agentVersion: 'unpinned' });
    expect((await rt.wrap(launch())).command).toContain(`'${tag}'`);
  });

  it('builds a layer once per content and again after the fragment changed', async () => {
    writeFileSync(join(bakersDir, 'run.Dockerfile'), 'RUN echo one\n');
    const opts = {
      ...fakeDocker(),
      ...additions({ dockerfile: 'run.Dockerfile' }),
    };
    const rt = dockerRuntime({}, opts);
    await rt.wrap(launch());
    await rt.wrap(launch());
    expect(builds()).toHaveLength(2);
    writeFileSync(join(bakersDir, 'run.Dockerfile'), 'RUN echo two\n');
    await rt.wrap(launch());
    expect(builds()).toHaveLength(3);
    expect(builds()[2]?.[2]).toContain('RUN echo two');
  });

  it('rebuilds the layer after a file the fragment copies changed', async () => {
    writeFileSync(join(bakersDir, 'run.Dockerfile'), 'COPY tool.sh /opt/\n');
    writeFileSync(join(bakersDir, 'tool.sh'), 'echo one\n');
    const rt = dockerRuntime(
      {},
      { ...fakeDocker(), ...additions({ dockerfile: 'run.Dockerfile' }) },
    );
    await rt.wrap(launch());
    await rt.wrap(launch());
    expect(builds()).toHaveLength(2);
    writeFileSync(join(bakersDir, 'tool.sh'), 'echo two\n');
    await rt.wrap(launch());
    expect(builds()).toHaveLength(3);
  });

  it('refuses a package that is not a plain name before building anything', async () => {
    await expect(
      dockerRuntime(
        {},
        {
          ...fakeDocker(),
          ...additions({ packages: { apt: ['jq\nUSER root'] } }),
        },
      ).wrap(launch()),
    ).rejects.toThrow('runtime-docker: invalid package');
    expect(builds()).toEqual([]);
  });

  it('reuses a layer another conductor built', async () => {
    const first = dockerRuntime(
      {},
      { ...fakeDocker(), ...additions({ packages: { npm: ['x'] } }) },
    );
    await first.wrap(launch());
    const tags = builds().map(([, a]) => a[2] as string);
    calls = [];
    const second = dockerRuntime(
      {},
      { ...fakeDocker(tags), ...additions({ packages: { npm: ['x'] } }) },
    );
    await second.wrap(launch());
    expect(builds()).toEqual([]);
  });

  it('logs the agent version the install pins', async () => {
    await dockerRuntime({}, { ...fakeDocker(), ...additions({}) }).wrap(
      launch({ installCommand: 'npm install -g agent@2.1.3' }),
    );
    expect(warns).toEqual([]);
    expect(infos).toContainEqual({
      image: `bakers-runtime:1.2.3-${shortHash('npm install -g agent@2.1.3')}`,
      agentVersion: '2.1.3',
    });
  });

  it('refuses a fragment with USER before building anything', async () => {
    writeFileSync(join(bakersDir, 'run.Dockerfile'), 'USER root\n');
    await expect(
      dockerRuntime(
        {},
        { ...fakeDocker(), ...additions({ dockerfile: 'run.Dockerfile' }) },
      ).wrap(launch()),
    ).rejects.toThrow(
      'run.Dockerfile:1: USER is not allowed in a run image fragment',
    );
    expect(builds()).toEqual([]);
  });

  it('with.image builds nothing and ignores the additions', async () => {
    writeFileSync(join(bakersDir, 'run.Dockerfile'), 'USER root\n');
    const out = await dockerRuntime(
      { image: 'mine:1' },
      {
        ...fakeDocker(['mine:1']),
        ...additions({
          packages: { apt: ['jq'] },
          dockerfile: 'run.Dockerfile',
        }),
      },
    ).wrap(launch());
    expect(builds()).toEqual([]);
    expect(out.command).toContain("'mine:1'");
  });
});
