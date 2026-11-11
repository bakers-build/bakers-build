import { join } from 'node:path';
import type { RuntimeLaunch } from '@bakers-build/conductor/contract';

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
  /** The worktree's own `config.worktree`, when it has one. */
  worktreeConfig?: string;
  /** The per-run home, mounted at `/home/run`. */
  runHome: string;
  /** Where the harness keeps transcripts: the agent home, or `~/.claude`. */
  configDir: string;
  /** The run's agent home (`CLAUDE_CONFIG_DIR`), when it has one. */
  agentHome?: string;
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

/** Claude Code's transcript directory name for a cwd (as the claude addon encodes it). */
export const transcriptKey = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

/** The model credentials a run may need; values never enter argv. */
export const MODEL_CREDENTIALS = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_API_KEY',
] as const;

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
  const key = transcriptKey(ws);
  const bind = (from: string, to = from, mode = '') => [
    '-v',
    `${from}:${to}${mode}`,
  ];
  const env = { ...input.env };
  const runClaudeDir = `${RUN_HOME}/.claude`;
  const computed: string[] = [`HOME=${RUN_HOME}`, `PATH=${RUN_PATH}`];
  if (env.CLAUDE_CONFIG_DIR !== undefined)
    computed.push(`CLAUDE_CONFIG_DIR=${runClaudeDir}`);
  const allowlist = opts.network === 'allowlist';
  if (allowlist) {
    const proxy = `http://${opts.proxy}:${PROXY_PORTS.egress}`;
    computed.push(
      `HTTPS_PROXY=${proxy}`,
      `HTTP_PROXY=${proxy}`,
      `NO_PROXY=${opts.proxy}`,
      `ANTHROPIC_BASE_URL=http://${opts.proxy}:${PROXY_PORTS.api}`,
      `ANTHROPIC_API_KEY=${API_KEY_PLACEHOLDER}`,
    );
  }
  const overridden = new Set(computed.map((c) => c.slice(0, c.indexOf('='))));
  const forwarded = Object.keys(env).filter(
    (k) =>
      !HOST_ONLY(k) &&
      !overridden.has(k) &&
      // Allowlist mode keeps the model credential in the proxy only.
      !(allowlist && (MODEL_CREDENTIALS as readonly string[]).includes(k)),
  );
  const plugins = where.agentHome ? join(where.agentHome, 'plugins') : '';
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
    ...bind(where.gitCommonDir),
    // The run must not plant a hook or rewrite Git config the host runs later.
    ...bind(join(where.gitCommonDir, 'hooks'), undefined, ':ro'),
    ...bind(join(where.gitCommonDir, 'config'), undefined, ':ro'),
    ...(where.worktreeConfig
      ? bind(where.worktreeConfig, undefined, ':ro')
      : []),
    ...bind(where.cliRoot, undefined, ':ro'),
    ...opts.mounts.flatMap((m) => bind(m, m, ':ro')),
    ...(plugins
      ? [
          ...bind(plugins, plugins, ':ro'),
          ...bind(plugins, `${runClaudeDir}/plugins`, ':ro'),
        ]
      : []),
    ...bind(where.runHome, RUN_HOME),
    ...bind(
      join(where.configDir, 'projects', key),
      `${runClaudeDir}/projects/${key}`,
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
