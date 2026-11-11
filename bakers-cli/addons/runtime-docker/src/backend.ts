import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
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
  transcriptKey,
} from './args.js';

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
}

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
    network: 'host',
  };
  const cacheHome = deps.env.XDG_CACHE_HOME || join(homedir(), '.cache');
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

  return {
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
      // shortcut: only Claude's transcript layout is mapped; map another harness's when it is supported.
      const configDir = agentHome ?? join(homedir(), '.claude');
      mkdirSync(join(configDir, 'projects', transcriptKey(ws)), {
        recursive: true,
      });
      const env = { ...launch.env };
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
}
