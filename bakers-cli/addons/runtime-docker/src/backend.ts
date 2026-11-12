import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type {
  BbRuntime,
  RuntimeLaunch,
} from '@bakers-build/conductor/contract';
import { type ConductorLogger, shellQuote } from '@bakers-build/core';
import {
  API_KEY_PLACEHOLDER,
  type DockerOptions,
  dockerArgs,
  PROXY_PORTS,
  RUN_HOME,
  RUN_NETWORK,
} from './args.js';
import type { AgentContainer, ContainerAgent } from './contract.js';

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

/** Quarantine only repositories host Git follows through the index, never symlinks. */
export async function quarantinePlanted(
  workspace: string,
  gitCommonDir: string,
  exec: BackendDeps['exec'] = realExec,
): Promise<string[]> {
  const ws = realpathSync(workspace);
  const modules = join(gitCommonDir, 'modules') + sep;
  const moved: string[] = [];
  const git = (...args: string[]) =>
    exec('git', ['-C', ws, '-c', 'core.fsmonitor=false', ...args]);
  const quarantineIndex = async () => {
    // A planted index.lock or oversized index must not leave unsafe entries active.
    const { stdout: indexPath } = await git('rev-parse', '--git-path', 'index');
    const index = resolve(ws, indexPath.trim());
    const parent = dirname(index);
    chmodSync(parent, statSync(parent).mode | 0o700);
    renameSync(index, `${index}.bakers-quarantine-${randomUUID()}`);
    moved.push(index);
  };
  let stdout: string;
  try {
    ({ stdout } = await git('ls-files', '--stage', '-z'));
  } catch {
    await quarantineIndex();
    return moved;
  }
  let unresolved = false;
  const links = new Set(
    stdout.split('\0').flatMap((line) => {
      const match = /^160000 [0-9a-f]+ [0-3]\t(.+)$/s.exec(line);
      return match?.[1] ? [match[1]] : [];
    }),
  );
  linksLoop: for (const name of links) {
    try {
      const parts = name.split('/');
      if (
        parts.some(
          (part) =>
            !part ||
            part === '.' ||
            part === '..' ||
            part.toLowerCase() === '.git',
        )
      )
        throw new Error(`unsafe gitlink: ${name}`);
      let path = ws;
      for (const part of [...parts, '.git']) {
        path = join(path, part);
        const entry = lstatSync(path, { throwIfNoEntry: false });
        if (!entry) continue linksLoop; // An uninitialised submodule has no config to execute.
        if (entry.isSymbolicLink()) throw new Error(`symlink: ${name}`);
      }
      if (lstatSync(path).isFile()) {
        const target = /^gitdir:\s*(.+)$/m.exec(
          readFileSync(path, 'utf8'),
        )?.[1];
        if (
          target &&
          realpathSync(resolve(ws, name, target.trim())).startsWith(modules)
        )
          continue;
      }
      renameSync(path, `${path}.bakers-quarantine-${randomUUID()}`);
      moved.push(path);
    } catch {
      // If inspection or rename fails, stop host Git following this entry instead.
      try {
        await git('update-index', '--force-remove', '--', name);
        moved.push(name);
      } catch {
        unresolved = true;
      }
    }
  }
  if (unresolved) await quarantineIndex();
  return moved;
}

const run = promisify(execFile);
export const realExec: BackendDeps['exec'] = (file, args) => run(file, args);

export function dockerRuntime(
  options: RuntimeDockerOptions,
  deps: BackendDeps,
): BbRuntime {
  const docker = options.docker ?? 'docker';
  const opts: Omit<DockerOptions, 'image'> = {
    docker,
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
  // The uuid names a container filter and a directory removed recursively.
  const plainName = (uuid: string) => /^[A-Za-z0-9-]+$/.test(uuid);
  const runHomeOf = (uuid: string) => {
    if (!plainName(uuid))
      throw new Error(
        `runtime-docker: invalid run uuid ${JSON.stringify(uuid)}`,
      );
    return join(cacheHome, 'bakers/runtime', uuid);
  };
  // Beside the run home, never mounted: cleanup trusts it to find the worktree.
  const recordOf = (uuid: string) => `${runHomeOf(uuid)}.workspace.json`;
  // One image per agent install; built once each.
  const imagesReady = new Map<string, Promise<void>>();

  const ensureImage = async (image: string, install: string) => {
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
        '--build-arg',
        `AGENT_INSTALL=${install}`,
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
  // shortcut: one model API per sidecar; agents of different APIs on one conductor recreate it, give each its own when that is needed.
  const startProxy = async (
    hash: string,
    credentials: string[],
    api: AgentContainer['api'],
    image: string,
  ) => {
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
      '-e',
      `BB_API_TARGET=${api.target}`,
      '-e',
      `BB_API_AUTH=${JSON.stringify(api.auth)}`,
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
      const runHome = runHomeOf(launch.run.uuid);
      const container = (launch.agent as Partial<ContainerAgent>).container;
      if (!container)
        throw new Error(
          `runtime-docker: agent ${launch.harness} does not support a container runtime`,
        );
      const credentials = Object.keys(container.api.auth).filter(
        (k) => deps.env[k],
      );
      if (credentials.length === 0)
        throw new Error(`runtime-docker: ${container.credentialHint}`);
      const image =
        options.image ??
        `bakers-runtime:${deps.version}-${shortHash(container.install)}`;
      if (!imagesReady.has(image))
        imagesReady.set(
          image,
          ensureImage(image, container.install).catch((err) => {
            imagesReady.delete(image);
            throw err;
          }),
        );
      await imagesReady.get(image);
      if (allowlist) {
        if (!gateway || !toolsPort)
          throw new Error(
            'runtime-docker: allowlist mode needs the conductor tool server; it was not started',
          );
        const hash = shortHash(
          JSON.stringify([
            gateway,
            toolsPort,
            options.allow ?? [],
            image,
            container.api,
          ]),
        );
        if (proxyReady?.hash !== hash)
          proxyReady = {
            hash,
            ready: startProxy(hash, credentials, container.api, image).catch(
              (err) => {
                proxyReady = undefined;
                throw err;
              },
            ),
          };
        await proxyReady.ready;
      }
      const ws = launch.workspacePath;
      const gitCommonDir = await git(ws, '--git-common-dir');
      const gitDir = await git(ws, '--git-dir');
      const gitLink = join(ws, '.git');
      // Bound read-only, so each must exist before docker would create it as root.
      for (const d of ['hooks', 'modules', 'worktrees'])
        mkdirSync(join(gitCommonDir, d), { recursive: true });
      for (const dir of new Set([gitCommonDir, gitDir])) {
        const worktreeConfig = join(dir, 'config.worktree');
        if (!existsSync(worktreeConfig)) writeFileSync(worktreeConfig, '');
      }
      mkdirSync(runHome, { recursive: true });
      writeFileSync(
        recordOf(launch.run.uuid),
        JSON.stringify({ workspace: ws, gitCommonDir }),
      );
      // The CLI build is mounted read-only; this puts the conductor's own CLI on PATH.
      if (deps.bakersEntry) {
        mkdirSync(join(runHome, 'bin'), { recursive: true });
        writeFileSync(
          join(runHome, 'bin/bakers'),
          `#!/bin/sh\nexec node ${shellQuote(deps.bakersEntry)} "$@"\n`,
          { mode: 0o755 },
        );
      }
      const agent = container.prepare({
        runHome,
        containerHome: RUN_HOME,
        workspacePath: ws,
        env: launch.env,
        hostHome: deps.env.HOME || homedir(),
        ...(allowlist ? { keyPlaceholder: API_KEY_PLACEHOLDER } : {}),
      });
      const env = { ...launch.env };
      // Allowlist mode: the credential stays with the proxy sidecar.
      if (!allowlist)
        for (const k of credentials) env[k] = deps.env[k] as string;
      const { argv, env: runEnv } = dockerArgs(
        { ...launch, env, container },
        { ...opts, image },
        {
          gitCommonDir,
          gitDir,
          ...(statSync(gitLink, { throwIfNoEntry: false })?.isFile()
            ? { gitLink }
            : {}),
          runHome,
          agent,
          cliRoot: deps.cliRoot,
          uid: process.getuid?.() ?? 1000,
          gid: process.getgid?.() ?? 1000,
        },
      );
      return { command: argv.map(shellQuote).join(' '), env: runEnv };
    },
    async cleanup(r) {
      if (!plainName(r.uuid)) {
        deps.logger.warn(
          { run: r.uuid },
          'runtime cleanup skipped: invalid run uuid',
        );
        return;
      }
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
        return;
      }
      // After the container is gone, so the run cannot plant anything behind the scan.
      const record = recordOf(r.uuid);
      if (existsSync(record)) {
        try {
          const { workspace, gitCommonDir } = JSON.parse(
            readFileSync(record, 'utf8'),
          );
          const moved = await quarantinePlanted(
            workspace,
            gitCommonDir,
            deps.exec,
          );
          if (moved.length > 0)
            deps.logger.warn(
              { run: r.uuid, moved },
              'runtime quarantined repositories the run planted',
            );
          rmSync(record);
        } catch (err) {
          deps.logger.error(
            { run: r.uuid, err: String(err) },
            'runtime quarantine failed: host git in the worktree may run what the run planted',
          );
        }
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
