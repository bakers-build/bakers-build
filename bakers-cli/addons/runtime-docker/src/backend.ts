import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  BbRuntime,
  RuntimeLaunch,
} from '@bakers-build/conductor/contract';
import { type ConductorLogger, shellQuote } from '@bakers-build/core';
import {
  type DockerOptions,
  dockerArgs,
  MODEL_CREDENTIALS,
  PROXY_PORTS,
  RUN_NETWORK,
  transcriptKey,
} from './args.js';

const EGRESS_NETWORK = 'bb-runtime-egress';

/** The addon's `with` options. */
export interface RuntimeDockerOptions {
  /** The container CLI; `podman` works too. */
  docker?: string;
  /** An operator image; never built. Default: the shipped image. */
  image?: string;
  /** Extra host paths mounted read-only. */
  mounts?: string[];
  network?: 'host' | 'allowlist';
  /** Allowlist mode: hosts the run may reach, exact or `*.suffix`. */
  allow?: string[];
}

export interface BackendDeps {
  exec(file: string, args: string[]): Promise<{ stdout: string }>;
  /** The conductor's own environment (the model credential lives here). */
  env: Record<string, string | undefined>;
  logger: ConductorLogger;
  /** The bakers CLI build, mounted read-only at its host path. */
  cliRoot: string;
  /** This package's directory; its `image/` holds the Dockerfile. */
  packageDir: string;
  version: string;
  /** The running bakers entry script; the run calls it as `bakers`. Absent: no shim. */
  bakersEntry?: string;
  /** Names this conductor's proxy sidecar, so conductors on one host never share one. */
  conductorKey?: string;
}

/** The first 12 hex chars of the sha256 of `text`. */
export const shortHash = (text: string) =>
  createHash('sha256').update(text).digest('hex').slice(0, 12);

const run = promisify(execFile);
export const realExec: BackendDeps['exec'] = (file, args) => run(file, args);

export function dockerRuntime(
  options: RuntimeDockerOptions,
  deps: BackendDeps,
): BbRuntime {
  const docker = options.docker ?? 'docker';
  const defaultImage = `bakers-runtime:${deps.version}`;
  const image = options.image ?? defaultImage;
  const opts: DockerOptions = {
    docker,
    image,
    mounts: options.mounts ?? [],
    network: options.network ?? 'host',
  };
  const allowlist = opts.network === 'allowlist';
  const proxyName = `bb-runtime-proxy-${deps.conductorKey ?? 'default'}`;
  if (allowlist) opts.proxy = proxyName;
  let gateway: string | undefined;
  let toolsPort: string | undefined;
  let proxyReady: { hash: string; ready: Promise<void> } | undefined;
  const cacheHome =
    deps.env.XDG_CACHE_HOME || join(deps.env.HOME || homedir(), '.cache');
  const runHomeOf = (uuid: string) => join(cacheHome, 'bakers/runtime', uuid);
  let imageReady: Promise<void> | undefined;

  const ensureImage = async () => {
    try {
      await deps.exec(docker, ['image', 'inspect', image]);
    } catch (err) {
      if (options.image !== undefined)
        throw new Error(
          `runtime-docker: image ${image} is not available (${String(err)}); pull or build it first`,
        );
      deps.logger.info({ image }, 'building the run image');
      await deps.exec(docker, [
        'build',
        '-t',
        image,
        join(deps.packageDir, 'image'),
      ]);
    }
  };

  const ensureNetwork = async (name: string, internal: boolean) => {
    try {
      await deps.exec(docker, ['network', 'inspect', name]);
    } catch {
      await deps.exec(docker, [
        'network',
        'create',
        ...(internal ? ['--internal'] : []),
        name,
      ]);
    }
  };

  // One sidecar per conductor; recreated only when what it relays changed.
  const startProxy = async (hash: string, credentials: string[]) => {
    const current = await deps
      .exec(docker, [
        'inspect',
        '-f',
        '{{index .Config.Labels "build.bakers.proxy"}}',
        proxyName,
      ])
      .then(
        (r) => r.stdout.trim(),
        () => undefined,
      );
    if (current === hash) return;
    if (current !== undefined) await deps.exec(docker, ['rm', '-f', proxyName]);
    await deps.exec(docker, [
      'run',
      '-d',
      '--restart',
      'unless-stopped',
      '--name',
      proxyName,
      '--label',
      `build.bakers.proxy=${hash}`,
      '--network',
      EGRESS_NETWORK,
      ...credentials.flatMap((k) => ['-e', k]),
      '-e',
      `BB_ALLOW=${(options.allow ?? []).join(',')}`,
      '-e',
      `BB_TOOLS=${gateway}:${toolsPort}`,
      image,
      'node',
      '/opt/bb-runtime/proxy.mjs',
    ]);
    await deps.exec(docker, ['network', 'connect', RUN_NETWORK, proxyName]);
  };

  const git = async (ws: string, flag: string) =>
    (
      await deps.exec('git', [
        '-C',
        ws,
        'rev-parse',
        '--path-format=absolute',
        flag,
      ])
    ).stdout.trim();

  const runtime: BbRuntime = {
    id: 'docker',
    async wrap(launch: RuntimeLaunch) {
      if (launch.harness !== 'claude' && options.image === undefined)
        throw new Error(
          `runtime-docker: the shipped image runs only Claude Code, not ${launch.harness}; set with.image to an image that has it`,
        );
      const credentials = MODEL_CREDENTIALS.filter((k) => deps.env[k]);
      if (credentials.length === 0)
        throw new Error(
          'runtime-docker: set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) or ANTHROPIC_API_KEY in the conductor environment; a container cannot use the host login',
        );
      imageReady ??= ensureImage().catch((err) => {
        imageReady = undefined;
        throw err;
      });
      await imageReady;
      if (allowlist) {
        if (!gateway || !toolsPort)
          throw new Error(
            'runtime-docker: allowlist mode needs the conductor tool server; it was not started',
          );
        const hash = shortHash(
          JSON.stringify([gateway, toolsPort, options.allow ?? [], image]),
        );
        if (proxyReady?.hash !== hash)
          proxyReady = {
            hash,
            ready: startProxy(hash, credentials).catch((err) => {
              proxyReady = undefined;
              throw err;
            }),
          };
        await proxyReady.ready;
      }
      const ws = launch.workspacePath;
      const gitCommonDir = await git(ws, '--git-common-dir');
      const worktreeConfig = join(
        await git(ws, '--git-dir'),
        'config.worktree',
      );
      // Bound read-only, so it must exist before docker would create it as root.
      mkdirSync(join(gitCommonDir, 'hooks'), { recursive: true });
      const runHome = runHomeOf(launch.run.uuid);
      mkdirSync(join(runHome, '.claude'), { recursive: true });
      const agentHome = launch.env.CLAUDE_CONFIG_DIR;
      // Settings travel; the login (.credentials.json) never does.
      for (const file of ['settings.json', '.claude.json'])
        if (agentHome && existsSync(join(agentHome, file)))
          copyFileSync(join(agentHome, file), join(runHome, '.claude', file));
      // The CLI build is mounted read-only; this puts the conductor's own CLI on PATH.
      if (deps.bakersEntry) {
        mkdirSync(join(runHome, 'bin'), { recursive: true });
        writeFileSync(
          join(runHome, 'bin/bakers'),
          `#!/bin/sh\nexec node ${shellQuote(deps.bakersEntry)} "$@"\n`,
          { mode: 0o755 },
        );
      }
      // A fresh home would stop Claude at its first-run setup screen.
      const stateFile = agentHome
        ? join(runHome, '.claude', '.claude.json')
        : join(runHome, '.claude.json');
      const state = existsSync(stateFile)
        ? (JSON.parse(readFileSync(stateFile, 'utf8')) as object)
        : {};
      writeFileSync(
        stateFile,
        JSON.stringify({ ...state, hasCompletedOnboarding: true }),
        { mode: 0o600 },
      );
      // shortcut: only Claude's transcript layout is mapped; map another harness's when it is supported.
      const configDir =
        agentHome ?? join(deps.env.HOME || homedir(), '.claude');
      const key = transcriptKey(ws);
      // Mount points docker would otherwise create root-owned, so cleanup could not delete the home.
      for (const dir of [
        join(configDir, 'projects', key),
        join(runHome, '.claude/projects', key),
        ...(agentHome ? [join(runHome, '.claude/plugins')] : []),
      ])
        mkdirSync(dir, { recursive: true });
      const env = { ...launch.env };
      // Allowlist mode: the credential stays with the proxy sidecar.
      if (!allowlist)
        for (const k of credentials) env[k] = deps.env[k] as string;
      const { argv, env: runEnv } = dockerArgs({ ...launch, env }, opts, {
        gitCommonDir,
        ...(existsSync(worktreeConfig) ? { worktreeConfig } : {}),
        runHome,
        configDir,
        ...(agentHome ? { agentHome } : {}),
        cliRoot: deps.cliRoot,
        uid: process.getuid?.() ?? 1000,
        gid: process.getgid?.() ?? 1000,
      });
      return { command: argv.map(shellQuote).join(' '), env: runEnv };
    },
    async cleanup(r) {
      try {
        const { stdout } = await deps.exec(docker, [
          'ps',
          '-aq',
          '--filter',
          `name=^bb-run-${r.uuid}$`,
          '--filter',
          `label=build.bakers.run=${r.uuid}`,
        ]);
        const ids = stdout.split('\n').filter(Boolean);
        if (ids.length > 0) await deps.exec(docker, ['rm', '-f', ...ids]);
      } catch (err) {
        deps.logger.warn(
          { run: r.uuid, err: String(err) },
          'runtime container cleanup failed',
        );
      }
      rmSync(runHomeOf(r.uuid), { recursive: true, force: true });
    },
  };
  if (allowlist) {
    runtime.toolsUrl = (hostUrl) => {
      const u = new URL(hostUrl);
      toolsPort = u.port;
      const path = u.pathname === '/' ? '' : u.pathname;
      return `http://${proxyName}:${PROXY_PORTS.tools}${path}${u.search}`;
    };
    runtime.toolServerHosts = async () => {
      await ensureNetwork(RUN_NETWORK, true);
      await ensureNetwork(EGRESS_NETWORK, false);
      const { stdout } = await deps.exec(docker, [
        'network',
        'inspect',
        '-f',
        '{{range .IPAM.Config}}{{.Gateway}}{{end}}',
        EGRESS_NETWORK,
      ]);
      gateway = stdout.trim();
      return [gateway];
    };
  }
  return runtime;
}
