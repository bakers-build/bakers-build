import type { RuntimeLaunch } from '@bakers-build/conductor/contract';

export interface DockerOptions {
  /** The container CLI: `docker`, or `podman`. */
  docker: string;
  image: string;
  /** Extra host paths, mounted read-only at the same path. */
  mounts: string[];
  network: 'host' | 'allowlist';
  /** The conductor-specific internal network used in allowlist mode. */
  runNetwork: string;
  /** Allowlist mode: the conductor's proxy sidecar name. */
  proxy?: string;
}

/** Host facts the launch depends on, resolved by the backend. */
export interface HostPaths {
  /** The run clone's Git directory, mounted as `<workspace>/.git`. */
  runGitDir?: string;
  /** A `shared` clone's parent object store, mounted read-only at its own path. */
  sharedObjects?: string;
  /** The per-run home, mounted at its host path. */
  runHome: string;
  /** The bakers CLI build, mounted read-only at its host path. */
  cliRoot: string;
  uid: number;
  gid: number;
}

/** The image's PATH, behind the run home's `bin` (the `bakers` shim lives there). */
export const RUN_PATH = `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;
export const PROXY_PORTS = { egress: 3128, api: 8081, tools: 8082 } as const;
/** What the run sends as its API key in allowlist mode; the proxy swaps in the real one. */
export const API_KEY_PLACEHOLDER = 'bb-runtime-placeholder';

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
  const api = input.modelApi;
  const bind = (from: string, to = from, mode = '') => [
    '-v',
    `${from}:${to}${mode}`,
  ];
  const env = { ...input.env };
  const computed: string[] = [
    `HOME=${where.runHome}`,
    `PATH=${where.runHome}/bin:${RUN_PATH}`,
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
    allowlist ? opts.runNetwork : 'host',
    '--user',
    `${where.uid}:${where.gid}`,
    ...(opts.docker.endsWith('podman') ? ['--userns=keep-id'] : []),
    ...computed.flatMap((c) => ['-e', c]),
    ...forwarded.flatMap((k) => ['-e', k]),
    ...bind(ws),
    // The only Git the run sees; the parent repository is not mounted.
    ...(where.runGitDir ? bind(where.runGitDir, `${ws}/.git`) : []),
    ...(where.sharedObjects ? ro(where.sharedObjects) : []),
    ...bind(where.cliRoot, undefined, ':ro'),
    ...opts.mounts.flatMap((m) => bind(m, m, ':ro')),
    ...bind(where.runHome),
    ...(input.readPaths ?? []).flatMap((path) => ro(path)),
    ...(input.writePaths ?? []).flatMap((path) => bind(path)),
    // Shared host files over their placeholders in the run home.
    ...(input.bindPaths ?? []).flatMap(({ source, target }) =>
      bind(source, target),
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
