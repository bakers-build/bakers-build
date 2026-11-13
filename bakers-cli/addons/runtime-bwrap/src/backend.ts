import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  BbRuntime,
  RuntimeLaunch,
  RuntimeRun,
} from '@bakers-build/conductor/contract';
import { shellQuote } from '@bakers-build/core';

export interface BwrapOptions {
  readPaths?: string[];
}
export interface BwrapDeps {
  cachePath: string;
  bwrapPath?: string;
  cliRoot: string;
  env: Readonly<Record<string, string | undefined>>;
}

const SYSTEM = [
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
  '/etc/ssl/certs',
  '/etc/ssl/openssl.cnf',
  '/etc/resolv.conf',
  '/etc/hosts',
  '/etc/passwd',
  '/etc/group',
  '/etc/nsswitch.conf',
  '/etc/localtime',
];
const launcher = fileURLToPath(
  new URL(
    import.meta.url.includes('/dist/') ? '../../launch.mjs' : '../launch.mjs',
    import.meta.url,
  ),
);
const within = (path: string, root: string) =>
  path === root || path.startsWith(root + sep);

function softwarePaths(env: BwrapDeps['env']): string[] {
  const paths = [dirname(process.execPath)];
  for (const path of (env.PATH ?? '').split(':')) {
    if (!isAbsolute(path) || !existsSync(path) || !statSync(path).isDirectory())
      continue;
    paths.push(path);
    for (const name of readdirSync(path)) {
      const entry = join(path, name);
      try {
        if (lstatSync(entry).isSymbolicLink()) {
          const target = realpathSync(entry);
          if (lstatSync(target).isFile()) {
            accessSync(target, constants.X_OK);
            paths.push(target);
          }
        }
      } catch {
        /* An unavailable optional program is not a mount. */
      }
    }
  }
  return paths;
}

/** Build an explicit filesystem view; no blanket bind of the host root or home. */
function argv(
  input: RuntimeLaunch,
  options: BwrapOptions,
  deps: BwrapDeps,
): string[] {
  const ws = resolve(input.workspacePath);
  const gitDir = input.gitDir;
  if (gitDir && within(realpathSync(gitDir), realpathSync(ws)))
    throw new Error(
      'runtime-bwrap: the run Git directory must stay outside the workspace',
    );
  const protectedPaths = [
    resolve(deps.cachePath),
    ...(gitDir ? [gitDir] : []),
    ...(input.sharedObjects ? [input.sharedObjects] : []),
    join(ws, '.git'),
    deps.cliRoot,
    ...(options.readPaths ?? []),
    ...(input.readPaths ?? []),
  ];
  for (const path of input.writePaths ?? []) {
    if (
      !isAbsolute(path) ||
      protectedPaths.some(
        (root) =>
          within(
            realpathSync(path),
            existsSync(root) ? realpathSync(root) : resolve(root),
          ) ||
          within(
            existsSync(root) ? realpathSync(root) : resolve(root),
            realpathSync(path),
          ),
      )
    )
      throw new Error(`runtime-bwrap: protected write path ${path}`);
  }
  const mounts = new Map<string, boolean>();
  const mount = (path: string, write: boolean) => {
    if (
      !isAbsolute(path) ||
      path === '/' ||
      (deps.env.HOME && within(deps.env.HOME, path))
    )
      throw new Error(`runtime-bwrap: refusing broad or relative path ${path}`);
    if (!existsSync(path))
      throw new Error(`runtime-bwrap: required path is missing: ${path}`);
    const actual = realpathSync(path);
    if (
      actual === '/' ||
      (deps.env.HOME && within(realpathSync(deps.env.HOME), actual))
    )
      throw new Error(`runtime-bwrap: refusing broad path ${path}`);
    mounts.set(path, write);
  };
  for (const path of [
    ...SYSTEM.filter(existsSync),
    ...softwarePaths(deps.env),
    deps.cliRoot,
    ...(input.sharedObjects ? [input.sharedObjects] : []),
    ...(options.readPaths ?? []),
    ...(input.readPaths ?? []),
  ])
    mount(path, false);
  for (const path of [
    ws,
    input.homePath as string,
    ...(input.writePaths ?? []),
  ])
    mount(path, true);
  mount(deps.cliRoot, false);
  const bindings = [...mounts].sort(
    ([a], [b]) =>
      a.split(sep).length - b.split(sep).length || a.localeCompare(b),
  );
  return [
    '--unshare-user',
    '--unshare-pid',
    '--unshare-ipc',
    '--unshare-uts',
    '--new-session',
    '--die-with-parent',
    '--cap-drop',
    'ALL',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
    '--dir',
    '/tmp/run',
    ...bindings.flatMap(([path, write]) => [
      write ? '--bind' : '--ro-bind',
      path,
      path,
    ]),
    // The only Git the run sees; bwrap creates the empty mount point on the host.
    ...(gitDir ? ['--bind', gitDir, join(ws, '.git')] : []),
    '--chdir',
    ws,
    '--',
    '/bin/sh',
    '-c',
    input.command,
  ];
}

export function bwrapRuntime(
  options: BwrapOptions,
  deps: BwrapDeps,
): BbRuntime {
  const pathOf = (run: RuntimeRun) => {
    if (!/^[A-Za-z0-9-]+$/.test(run.uuid))
      throw new Error('runtime-bwrap: invalid run uuid');
    return join(deps.cachePath, run.uuid);
  };
  return {
    id: 'bwrap',
    async prepareRun(run) {
      const homePath = pathOf(run);
      mkdirSync(homePath, { recursive: true, mode: 0o700 });
      return { homePath };
    },
    async wrap(input) {
      const homePath = pathOf(input.run);
      if (input.homePath !== homePath)
        throw new Error('runtime-bwrap: private run home was not prepared');
      const env = {
        ...input.env,
        HOME: homePath,
        PATH: deps.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        TMPDIR: '/tmp',
        XDG_RUNTIME_DIR: '/tmp/run',
        XDG_CACHE_HOME: join(homePath, '.cache'),
        XDG_CONFIG_HOME: join(homePath, '.config'),
        XDG_DATA_HOME: join(homePath, '.local/share'),
      };
      if (
        within(realpathSync(deps.cachePath), realpathSync(input.workspacePath))
      )
        throw new Error(
          'runtime-bwrap: private state must stay outside the worktree',
        );
      const planPath = `${homePath}.launch.json`;
      writeFileSync(
        planPath,
        JSON.stringify({
          bwrap: deps.bwrapPath ?? '/usr/bin/bwrap',
          argv: argv(input, options, deps),
          envKeys: Object.keys(env),
          workspacePath: input.workspacePath,
        }),
        { mode: 0o600 },
      );
      return {
        command: [process.execPath, launcher, planPath]
          .map(shellQuote)
          .join(' '),
        env,
      };
    },
    async cleanup(run) {
      const homePath = pathOf(run);
      const planPath = `${homePath}.launch.json`;
      const pidPath = `${planPath}.pid`;
      if (existsSync(pidPath)) {
        const pid = Number(readFileSync(pidPath, 'utf8'));
        if (!Number.isSafeInteger(pid) || pid < 2)
          throw new Error('runtime-bwrap: invalid launcher pid');
        let owned = false;
        try {
          const command = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split(
            '\0',
          );
          owned = command[1] === launcher && command[2] === planPath;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
        if (owned) {
          process.kill(pid, 'SIGTERM');
          for (let i = 0; i < 20 && existsSync(`/proc/${pid}`); i++)
            await new Promise((done) => setTimeout(done, 50));
          if (existsSync(`/proc/${pid}`)) process.kill(pid, 'SIGKILL');
          for (let i = 0; i < 20 && existsSync(`/proc/${pid}`); i++)
            await new Promise((done) => setTimeout(done, 50));
          if (existsSync(`/proc/${pid}`))
            throw new Error(
              'runtime-bwrap: launcher did not stop; retaining the home',
            );
        }
      }
      rmSync(planPath, { force: true });
      rmSync(homePath, { recursive: true, force: true });
      rmSync(pidPath, { force: true });
    },
  };
}
