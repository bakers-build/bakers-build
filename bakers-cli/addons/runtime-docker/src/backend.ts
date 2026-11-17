import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type {
  AgentModelApi,
  AgentRuntimeInfo,
  BbRuntime,
  RuntimeLaunch,
} from '@bakers-build/conductor/contract';
import {
  type ConductorLogger,
  type ProjectConfig,
  runtimeFragment,
  shellQuote,
} from '@bakers-build/core';
import {
  API_KEY_PLACEHOLDER,
  type DockerOptions,
  dockerArgs,
  PROXY_PORTS,
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
  /** Run clones borrow the parent's objects (`git clone --shared`). */
  shared?: boolean;
}

/** The project's `runtime.image`. */
export type RuntimeImageAdditions = NonNullable<
  NonNullable<ProjectConfig['runtime']>['image']
>;

export interface BackendDeps {
  /** `opts.env` is merged over the conductor's env for that one command; `opts.input` is its stdin. */
  exec(
    file: string,
    args: string[],
    opts?: { env?: Record<string, string>; input?: string },
  ): Promise<{ stdout: string }>;
  /** The conductor's own environment; the credential source without `agent.secrets`. */
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
  /** The project's `runtime.image` and its `.bakers/`, the layer's build context. */
  imageAdditions?: { image: RuntimeImageAdditions; bakersDir: string };
}

/** The first 12 hex chars of the sha256 of `text`. */
export const shortHash = (text: string) =>
  createHash('sha256').update(text).digest('hex').slice(0, 12);

const run = promisify(execFile);
export const realExec: BackendDeps['exec'] = (file, args, opts) => {
  const p = run(
    file,
    args,
    opts?.env ? { env: { ...process.env, ...opts.env } } : {},
  );
  if (opts?.input !== undefined) p.child.stdin?.end(opts.input);
  return p;
};

// Same as runtime.image.packages in the project schema: no whitespace, no option.
const PACKAGE = /^[A-Za-z0-9@][A-Za-z0-9@/._+:=~-]*$/;

/** The build context's files and contents, so a changed `COPY` source rebuilds the layer. */
const contextDigest = (dir: string) =>
  shortHash(
    JSON.stringify(
      readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .sort()
        .filter((f) =>
          statSync(join(dir, f), { throwIfNoEntry: false })?.isFile(),
        )
        .map((f) => [f, shortHash(readFileSync(join(dir, f), 'latin1'))]),
    ),
  );

const PLAYWRIGHT = /^(?:@playwright\/test|playwright)(?:@|$)/;

/** The layer on the shipped image: apt, npm, Playwright's Chromium, then the fragment. */
export function layerDockerfile(
  base: string,
  apt: string[],
  npm: string[],
  fragment: string,
): string {
  const lines = [`FROM ${base}`];
  if (apt.length > 0)
    lines.push(
      `RUN apt-get update && apt-get install -y --no-install-recommends ${apt.map(shellQuote).join(' ')} && rm -rf /var/lib/apt/lists/*`,
    );
  if (npm.length > 0)
    lines.push(
      `RUN npm install -g ${npm.map(shellQuote).join(' ')}`,
      // Node does not search the global modules: without it require('playwright') fails.
      'ENV NODE_PATH=/usr/local/lib/node_modules',
    );
  // Runs start under the host uid: browsers go where any uid can read them.
  if (npm.some((p) => PLAYWRIGHT.test(p)))
    lines.push(
      'ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright',
      'RUN playwright install --with-deps chromium && chmod -R a+rX /opt/ms-playwright',
    );
  if (fragment) lines.push(fragment.replace(/\n+$/, ''));
  return `${lines.join('\n')}\n`;
}

export function dockerRuntime(
  options: RuntimeDockerOptions,
  deps: BackendDeps,
): BbRuntime {
  const docker = options.docker ?? 'docker';
  const opts: Omit<DockerOptions, 'image'> = {
    docker,
    mounts: options.mounts ?? [],
    network: options.network ?? 'host',
    runNetwork: `bb-runtime-${deps.conductorKey ?? 'default'}`,
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
  // One image per tag (agent install, additions); built once each.
  const imagesReady = new Map<string, Promise<void>>();

  const ensureImage = (image: string, build: () => Promise<unknown>) => {
    let ready = imagesReady.get(image);
    if (!ready) {
      ready = (async () => {
        try {
          await deps.exec(docker, ['image', 'inspect', image]);
        } catch (err) {
          if (options.image !== undefined)
            throw new Error(
              `runtime-docker: image ${image} is not available (${String(err)}); pull or build it first`,
            );
          deps.logger.info({ image }, 'building the run image');
          await build();
        }
      })().catch((err) => {
        imagesReady.delete(image);
        throw err;
      });
      imagesReady.set(image, ready);
    }
    return ready;
  };

  /** The project's layer, or none; the fragment is reread and rechecked on every run. */
  const layerOf = (base: string) => {
    const additions = options.image ? undefined : deps.imageAdditions;
    if (!additions) return undefined;
    const { packages = {}, dockerfile } = additions.image;
    const apt = packages.apt ?? [];
    const npm = packages.npm ?? [];
    for (const p of [...apt, ...npm])
      if (!PACKAGE.test(p))
        throw new Error(`runtime-docker: invalid package ${JSON.stringify(p)}`);
    let fragment = '';
    if (dockerfile) {
      const { text, problems } = runtimeFragment(
        additions.bakersDir,
        dockerfile,
      );
      if (problems.length > 0)
        throw new Error(`runtime-docker: ${problems.join('; ')}`);
      fragment = text ?? '';
    }
    if (apt.length + npm.length === 0 && !fragment.trim()) return undefined;
    return {
      tag: `${base}-${shortHash(JSON.stringify([base, apt, npm, fragment, fragment && contextDigest(additions.bakersDir)]))}`,
      dockerfile: layerDockerfile(base, apt, npm, fragment),
      context: additions.bakersDir,
    };
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
    credentials: Record<string, string>,
    api: AgentModelApi,
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
    // Names in argv, values in the docker CLI's env: argv is visible in ps.
    await deps.exec(
      docker,
      [
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
        ...Object.keys(credentials).flatMap((k) => ['-e', k]),
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
      ],
      { env: credentials },
    );
    await deps.exec(docker, ['network', 'connect', opts.runNetwork, proxyName]);
  };

  const credentialsFor = (agent: AgentRuntimeInfo) => {
    const api = agent.modelApi;
    if (allowlist && !api)
      throw new Error(
        'runtime-docker: allowlist mode requires model API metadata',
      );
    const source = agent.secrets ?? deps.env;
    const credentials: Record<string, string> = {};
    for (const k of Object.keys(api?.auth ?? {}))
      if (source[k]) credentials[k] = source[k] as string;
    if (api && Object.keys(credentials).length === 0)
      throw new Error(`runtime-docker: ${api.credentialHint}`);
    return credentials;
  };

  const runtime: BbRuntime = {
    id: 'docker',
    async prepareRun(run, agent) {
      const credentials = credentialsFor(agent);
      const homePath = runHomeOf(run.uuid);
      mkdirSync(homePath, { recursive: true, mode: 0o700 });
      const env = allowlist
        ? { [(agent.modelApi as AgentModelApi).keyEnv]: API_KEY_PLACEHOLDER }
        : credentials;
      return { homePath, env };
    },
    async wrap(launch: RuntimeLaunch) {
      const runHome = runHomeOf(launch.run.uuid);
      if (launch.homePath !== runHome)
        throw new Error('runtime-docker: private run home was not prepared');
      const api = launch.modelApi;
      const credentials = credentialsFor(launch);
      if (!options.image && !launch.installCommand)
        throw new Error(
          `runtime-docker: agent ${launch.harness} has no installCommand; configure an image`,
        );
      const install = launch.installCommand ?? '';
      const base =
        options.image ?? `bakers-runtime:${deps.version}-${shortHash(install)}`;
      const layer = layerOf(base);
      await ensureImage(base, () =>
        deps.exec(docker, [
          'build',
          '-t',
          base,
          '--build-arg',
          `AGENT_INSTALL=${install}`,
          join(deps.packageDir, 'image'),
        ]),
      );
      if (layer)
        await ensureImage(layer.tag, () =>
          deps.exec(
            docker,
            ['build', '-t', layer.tag, '-f', '-', layer.context],
            { input: layer.dockerfile },
          ),
        );
      const image = layer?.tag ?? base;
      const agentVersion = options.image
        ? 'operator image'
        : (/@(\d[\w.+-]*)\s*$/.exec(install)?.[1] ?? 'unpinned');
      if (agentVersion === 'unpinned')
        deps.logger.warn(
          { image, agentVersion },
          'run image: the agent version is not pinned to the host',
        );
      else deps.logger.info({ image, agentVersion }, 'run image');
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
            api,
            opts.runNetwork,
          ]),
        );
        if (proxyReady?.hash !== hash)
          proxyReady = {
            hash,
            ready: startProxy(
              hash,
              credentials,
              api as AgentModelApi,
              image,
            ).catch((err) => {
              proxyReady = undefined;
              throw err;
            }),
          };
        await proxyReady.ready;
      }
      const ws = launch.workspacePath;
      const runGitDir = launch.gitDir;
      const within = (path: string, root: string) =>
        path === root || path.startsWith(root + sep);
      if (within(realpathSync(dirname(runHome)), realpathSync(ws)))
        throw new Error(
          'runtime-docker: private state must stay outside the worktree',
        );
      if (runGitDir && within(realpathSync(runGitDir), realpathSync(ws)))
        throw new Error(
          'runtime-docker: the run Git directory must stay outside the workspace',
        );
      const canonical = (path: string) =>
        existsSync(path) ? realpathSync(path) : resolve(path);
      const binds = launch.bindPaths ?? [];
      for (const { target } of binds)
        if (target.includes(':') || !within(resolve(target), resolve(runHome)))
          throw new Error(
            `runtime-docker: shared file target outside the run home ${target}`,
          );
      for (const [paths, write] of [
        [launch.readPaths ?? [], false],
        [launch.writePaths ?? [], true],
        [binds.map(({ source }) => source), true],
      ] as const) {
        for (const path of paths) {
          if (!isAbsolute(path) || path.includes(':') || !existsSync(path))
            throw new Error(`runtime-docker: invalid prepared path ${path}`);
          const actual = canonical(path);
          if (
            actual === '/' ||
            (deps.env.HOME && within(canonical(deps.env.HOME), actual))
          )
            throw new Error(`runtime-docker: refusing broad path ${path}`);
          if (
            write &&
            [
              ...(runGitDir ? [runGitDir] : []),
              ...(launch.sharedObjects ? [launch.sharedObjects] : []),
              dirname(runHome),
              join(ws, '.git'),
              deps.cliRoot,
              ...(launch.readPaths ?? []),
              ...opts.mounts,
            ].some(
              (root) =>
                within(actual, canonical(root)) ||
                within(canonical(root), actual),
            )
          )
            throw new Error(`runtime-docker: protected write path ${path}`);
        }
      }

      // The CLI build is mounted read-only; this puts the conductor's own CLI on PATH.
      if (deps.bakersEntry) {
        mkdirSync(join(runHome, 'bin'), { recursive: true });
        writeFileSync(
          join(runHome, 'bin/bakers'),
          `#!/bin/sh\nexec node ${shellQuote(deps.bakersEntry)} "$@"\n`,
          { mode: 0o755 },
        );
      }
      const env = { ...launch.env };
      // Allowlist mode: the credential stays with the proxy sidecar.
      if (!allowlist) Object.assign(env, credentials);
      const { argv, env: runEnv } = dockerArgs(
        { ...launch, env },
        { ...opts, image },
        {
          ...(runGitDir ? { runGitDir } : {}),
          ...(launch.sharedObjects
            ? { sharedObjects: launch.sharedObjects }
            : {}),
          runHome,
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
      await ensureNetwork(opts.runNetwork, true);
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
