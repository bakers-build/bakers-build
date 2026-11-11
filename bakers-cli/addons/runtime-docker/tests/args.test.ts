import { describe, expect, it } from 'vitest';
import { type DockerOptions, dockerArgs, type HostPaths } from '../src/args.js';

const launch = {
  command: "claude 'it''s'",
  env: { BAKERS_CONDUCTOR_TOKEN: 'secret-token', BAKERS_STATE: 'working' },
  workspacePath: '/w/tree',
  run: { uuid: 'r-uuid', id: 7 },
  harness: 'claude',
};
const opts: DockerOptions = {
  docker: 'docker',
  image: 'img',
  mounts: [],
  network: 'host',
};
const where: HostPaths = {
  gitCommonDir: '/w/main/.git',
  worktreeConfig: '/w/main/.git/worktrees/tree/config.worktree',
  runHome: '/h/run',
  configDir: '/home/op/.claude',
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
    expect(argv.slice(-4)).toEqual(['img', 'sh', '-c', "claude 'it''s'"]);
    expect(argv.join(' ')).toContain('-w /w/tree');
  });

  it('mounts exactly the allowed paths', () => {
    expect(volumes(dockerArgs(launch, opts, where).argv)).toEqual([
      '/w/tree:/w/tree',
      '/w/main/.git:/w/main/.git',
      '/w/main/.git/hooks:/w/main/.git/hooks:ro',
      '/w/main/.git/config:/w/main/.git/config:ro',
      '/w/main/.git/worktrees/tree/config.worktree:/w/main/.git/worktrees/tree/config.worktree:ro',
      '/opt/cli:/opt/cli:ro',
      '/h/run:/home/run',
      '/home/op/.claude/projects/-w-tree:/home/run/.claude/projects/-w-tree',
    ]);
  });

  it('mounts an agent home read-only for plugins and its transcripts', () => {
    const v = volumes(
      dockerArgs(launch, opts, {
        ...where,
        configDir: '/agent',
        agentHome: '/agent',
      }).argv,
    );
    expect(v).toContain('/agent/plugins:/agent/plugins:ro');
    expect(v).toContain('/agent/plugins:/home/run/.claude/plugins:ro');
    expect(v).toContain(
      '/agent/projects/-w-tree:/home/run/.claude/projects/-w-tree',
    );
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
          CLAUDE_CONFIG_DIR: '/agent',
        },
      },
      opts,
      where,
    );
    const flags = envFlags(argv);
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'XDG_CACHE_HOME'])
      expect(flags).not.toContain(key);
    expect(flags).toContain('HOME=/home/run');
    expect(flags).toContain('CLAUDE_CONFIG_DIR=/home/run/.claude');
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

  it('runs podman with its user namespace kept', () => {
    const { argv } = dockerArgs(launch, { ...opts, docker: 'podman' }, where);
    expect(argv[0]).toBe('podman');
    expect(argv).toContain('--userns=keep-id');
  });

  it('skips a missing config.worktree and adds operator mounts read-only', () => {
    const { worktreeConfig: _, ...rest } = where;
    const v = volumes(
      dockerArgs(launch, { ...opts, mounts: ['/srv/data'] }, rest).argv,
    );
    expect(v.some((m) => m.includes('config.worktree'))).toBe(false);
    expect(v).toContain('/srv/data:/srv/data:ro');
  });
});
