import { join } from 'node:path';
import type {
  ContainerMount,
  RuntimeLaunch,
} from '@bakers-build/conductor/contract';

export interface DockerOptions {
  /** The container CLI: `docker`, or `podman`. */
  docker: string;
  image: string;
  /** Extra host paths, mounted read-only at the same path. */
  mounts: string[];
  network: 'host' | 'allowlist';
  /** Allowlist mode: the conductor's proxy sidecar name. */
  proxy?: string;
}

/** Host facts the launch depends on, resolved by the backend. */
export interface HostPaths {
  gitCommonDir: string;
  /** The worktree's own Git dir; the common dir itself for a main checkout. */
  gitDir: string;
  /** `<worktree>/.git` when it is a gitlink file. */
  gitLink?: string;
  /** The per-run home, mounted at `/home/run`. */
  runHome: string;
  /** What the agent's `container.prepare` returned. */
  agent: { env: Record<string, string>; mounts: ContainerMount[] };
  /** The bakers CLI build, mounted read-only at its host path. */
  cliRoot: string;
  uid: number;
  gid: number;
}

export const RUN_HOME = '/home/run';
/** The image's PATH, behind the run home's `bin` (the `bakers` shim lives there). */
export const RUN_PATH = `${RUN_HOME}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;
export const PROXY_PORTS = { egress: 3128, api: 8081, tools: 8082 } as const;
/** What the run sends as its API key in allowlist mode; the proxy swaps in the real one. */
export const API_KEY_PLACEHOLDER = 'bb-runtime-placeholder';
export const RUN_NETWORK = 'bb-runtime';

/** Keys whose host value means nothing inside the container. */
const HOST_ONLY = (key: string) =>
  key === 'PATH' ||
  key === 'HOME' ||
  key === 'TMPDIR' ||
  key.startsWith('XDG_');

/**
 * The `docker run` argv for one run. Pure: every secret travels as `-e KEY`
 * with its value in the returned env, which the executor hands the docker
 * client; nothing of the operator home is mounted beyond the list below.
 */
export function dockerArgs(
  input: RuntimeLaunch,
  opts: DockerOptions,
  where: HostPaths,
): { argv: string[]; env: Record<string, string> } {
  const ws = input.workspacePath;
  const api = input.container?.api;
  const bind = (from: string, to = from, mode = '') => [
    '-v',
    `${from}:${to}${mode}`,
  ];
  const env = { ...input.env };
  const computed: string[] = [
    `HOME=${RUN_HOME}`,
    `PATH=${RUN_PATH}`,
    ...Object.entries(where.agent.env).map(([k, v]) => `${k}=${v}`),
  ];
  const allowlist = opts.network === 'allowlist';
  if (allowlist && api) {
    const proxy = `http://${opts.proxy}:${PROXY_PORTS.egress}`;
    computed.push(
      `HTTPS_PROXY=${proxy}`,
      `HTTP_PROXY=${proxy}`,
      `NO_PROXY=${opts.proxy}`,
      `${api.baseUrlEnv}=http://${opts.proxy}:${PROXY_PORTS.api}`,
      `${api.keyEnv}=${API_KEY_PLACEHOLDER}`,
    );
  }
  const overridden = new Set(computed.map((c) => c.slice(0, c.indexOf('='))));
  const credentials = Object.keys(api?.auth ?? {});
  const forwarded = Object.keys(env).filter(
    (k) =>
      !HOST_ONLY(k) &&
      !overridden.has(k) &&
      // Allowlist mode keeps the model credential in the proxy only.
      !(allowlist && credentials.includes(k)),
  );
  const common = where.gitCommonDir;
  const gitDir = where.gitDir;
  const linked = gitDir !== common;
  const ro = (path: string) => bind(path, path, ':ro');
  const argv = [
    opts.docker,
    'run',
    '--rm',
    '-it',
    '--name',
    `bb-run-${input.run.uuid}`,
    '--label',
    `build.bakers.run=${input.run.uuid}`,
    '--network',
    allowlist ? RUN_NETWORK : 'host',
    '--user',
    `${where.uid}:${where.gid}`,
    ...(opts.docker.endsWith('podman') ? ['--userns=keep-id'] : []),
    ...computed.flatMap((c) => ['-e', c]),
    ...forwarded.flatMap((k) => ['-e', k]),
    ...bind(ws),
    ...(where.gitLink ? bind(where.gitLink, undefined, ':ro') : []),
    ...bind(common),
    // The run must not plant a hook, rewrite Git config or repoint a worktree's
    // Git dir: host git in these repos would run what the run chose.
    ...ro(join(common, 'hooks')),
    ...ro(join(common, 'config')),
    // Read by host git in the main checkout once `extensions.worktreeConfig` is on.
    ...ro(join(common, 'config.worktree')),
    ...ro(join(common, 'modules')),
    ...ro(join(common, 'worktrees')),
    ...(linked
      ? [
          // Docker mounts by depth, so this reopens only the run's own Git dir.
          ...bind(gitDir),
          ...ro(join(gitDir, 'commondir')),
          ...ro(join(gitDir, 'gitdir')),
          ...ro(join(gitDir, 'config.worktree')),
        ]
      : []),
    ...bind(where.cliRoot, undefined, ':ro'),
    ...opts.mounts.flatMap((m) => bind(m, m, ':ro')),
    ...bind(where.runHome, RUN_HOME),
    ...where.agent.mounts.flatMap((m) =>
      bind(m.host, m.container, m.readOnly ? ':ro' : ''),
    ),
    '-w',
    ws,
    opts.image,
    'sh',
    '-c',
    input.command,
  ];
  return { argv, env };
}
