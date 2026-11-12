import type { AgentModelApi } from '@bakers-build/conductor/contract';
import { describe, expect, it } from 'vitest';
import { type DockerOptions, dockerArgs, type HostPaths } from '../src/args.js';

/** A harness the runtime knows nothing about. */
const modelApi: AgentModelApi = {
  credentialHint: 'set MODEL_TOKEN',
  target: 'https://api.example',
  baseUrlEnv: 'MODEL_BASE_URL',
  keyEnv: 'MODEL_KEY',
  auth: { MODEL_TOKEN: { set: { authorization: 'Bearer {value}' } } },
};

const launch = {
  command: "agent 'it''s'",
  env: { BAKERS_CONDUCTOR_TOKEN: 'secret-token', BAKERS_STATE: 'working' },
  workspacePath: '/w/tree',
  run: { uuid: 'r-uuid', id: 7 },
  harness: 'fake',
  modelApi,
  readPaths: ['/home/op/.agent/p'],
  writePaths: ['/home/op/.agent/t'],
};
const opts: DockerOptions = {
  docker: 'docker',
  image: 'img',
  mounts: [],
  network: 'host',
};
const where: HostPaths = {
  gitCommonDir: '/w/main/.git',
  gitDir: '/w/main/.git/worktrees/tree',
  gitLink: '/w/tree/.git',
  runHome: '/h/run',
  cliRoot: '/opt/cli',
  uid: 1000,
  gid: 1000,
};

const volumes = (argv: string[]) =>
  argv.flatMap((a, i) => (a === '-v' ? [argv[i + 1] as string] : []));
const envFlags = (argv: string[]) =>
  argv.flatMap((a, i) => (a === '-e' ? [argv[i + 1] as string] : []));

describe('dockerArgs', () => {
  it('starts one named, labelled container', () => {
    const { argv } = dockerArgs(launch, opts, where);
    expect(argv.slice(0, 12)).toEqual([
      'docker',
      'run',
      '--rm',
      '-it',
      '--name',
      'bb-run-r-uuid',
      '--label',
      'build.bakers.run=r-uuid',
      '--network',
      'host',
      '--user',
      '1000:1000',
    ]);
    expect(argv.slice(-4)).toEqual(['img', 'sh', '-c', "agent 'it''s'"]);
    expect(argv.join(' ')).toContain('-w /w/tree');
  });

  it('mounts exactly the allowed paths', () => {
    expect(volumes(dockerArgs(launch, opts, where).argv)).toEqual([
      '/w/tree:/w/tree',
      '/w/tree/.git:/w/tree/.git:ro',
      '/w/main/.git:/w/main/.git',
      '/w/main/.git/hooks:/w/main/.git/hooks:ro',
      '/w/main/.git/config:/w/main/.git/config:ro',
      '/w/main/.git/config.worktree:/w/main/.git/config.worktree:ro',
      '/w/main/.git/modules:/w/main/.git/modules:ro',
      '/w/main/.git/worktrees:/w/main/.git/worktrees:ro',
      '/w/main/.git/worktrees/tree:/w/main/.git/worktrees/tree',
      '/w/main/.git/worktrees/tree/commondir:/w/main/.git/worktrees/tree/commondir:ro',
      '/w/main/.git/worktrees/tree/gitdir:/w/main/.git/worktrees/tree/gitdir:ro',
      '/w/main/.git/worktrees/tree/config.worktree:/w/main/.git/worktrees/tree/config.worktree:ro',
      '/opt/cli:/opt/cli:ro',
      '/h/run:/h/run',
      '/home/op/.agent/p:/home/op/.agent/p:ro',
      '/home/op/.agent/t:/home/op/.agent/t',
    ]);
  });

  it('passes secrets by name only', () => {
    const { argv, env } = dockerArgs(launch, opts, where);
    expect(envFlags(argv)).toContain('BAKERS_CONDUCTOR_TOKEN');
    expect(argv.join(' ')).not.toContain('secret-token');
    expect(env.BAKERS_CONDUCTOR_TOKEN).toBe('secret-token');
  });

  it('drops host-only keys and sets the run home', () => {
    const { argv, env } = dockerArgs(
      {
        ...launch,
        env: {
          PATH: '/usr/bin',
          HOME: '/home/op',
          TMPDIR: '/tmp/x',
          XDG_CACHE_HOME: '/c',
          AGENT_DIR: '/host/agent',
        },
      },
      opts,
      where,
    );
    const flags = envFlags(argv);
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'XDG_CACHE_HOME'])
      expect(flags).not.toContain(key);
    expect(flags).toContain('HOME=/h/run');
    expect(flags).toContain('AGENT_DIR');
    expect(env.AGENT_DIR).toBe('/host/agent');
    // The docker client itself still runs with the host env.
    expect(env.PATH).toBe('/usr/bin');
  });

  it('mounts nothing else from the operator home', () => {
    const joined = dockerArgs(launch, opts, where).argv.join(' ');
    expect(joined).not.toMatch(
      /\.ssh|\/\.bakers|docker\.sock|\.credentials\.json/,
    );
    expect(volumes(dockerArgs(launch, opts, where).argv)).not.toContainEqual(
      expect.stringMatching(/^\/home\/op:/),
    );
  });

  it('puts the run home bin first on PATH', () => {
    expect(envFlags(dockerArgs(launch, opts, where).argv)).toContain(
      'PATH=/h/run/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    );
  });

  it('runs podman with its user namespace kept', () => {
    const { argv } = dockerArgs(launch, { ...opts, docker: 'podman' }, where);
    expect(argv[0]).toBe('podman');
    expect(argv).toContain('--userns=keep-id');
  });

  it('protects the Git files of a main checkout', () => {
    const { gitLink: _, ...main } = where;
    const v = volumes(
      dockerArgs({ ...launch, workspacePath: '/w/main' }, opts, {
        ...main,
        gitDir: '/w/main/.git',
      }).argv,
    );
    expect(
      v.filter(
        (m) =>
          m === '/w/main/.git/config.worktree:/w/main/.git/config.worktree:ro',
      ),
    ).toHaveLength(1);
    expect(v).toContain('/w/main/.git/worktrees:/w/main/.git/worktrees:ro');
    expect(
      v.some((m) =>
        /commondir|gitdir|\/w\/main\/\.git:\/w\/main\/\.git:ro/.test(m),
      ),
    ).toBe(false);
  });

  it('adds operator mounts read-only', () => {
    const v = volumes(
      dockerArgs(launch, { ...opts, mounts: ['/srv/data'] }, where).argv,
    );
    expect(v).toContain('/srv/data:/srv/data:ro');
  });
});

describe('dockerArgs in allowlist mode', () => {
  const allow: DockerOptions = {
    ...opts,
    network: 'allowlist',
    proxy: 'bb-runtime-proxy-abc',
  };
  const withCred = {
    ...launch,
    env: { ...launch.env, MODEL_TOKEN: 'oauth' },
  };

  it('joins the internal network and routes through the proxy', () => {
    const { argv } = dockerArgs(withCred, allow, where);
    expect(argv.join(' ')).toContain('--network bb-runtime ');
    const flags = envFlags(argv);
    expect(flags).toContain('HTTPS_PROXY=http://bb-runtime-proxy-abc:3128');
    expect(flags).toContain('NO_PROXY=bb-runtime-proxy-abc');
    expect(flags).toContain('MODEL_BASE_URL=http://bb-runtime-proxy-abc:8081');
    expect(flags).toContain('MODEL_KEY=bb-runtime-placeholder');
  });

  it('keeps the model credential out of the run', () => {
    const { argv } = dockerArgs(withCred, allow, where);
    expect(envFlags(argv)).not.toContain('MODEL_TOKEN');
    expect(argv.join(' ')).not.toContain('oauth');
  });
});
