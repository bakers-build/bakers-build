import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { UI_REFRESH_FILE } from './ui-refresh.js';

/** Host-owned record of one isolated run's clone; never store it where the run can write. */
export interface RunClone {
  /**
   * The run's Git directory, outside the workspace; mounted as `.git` only
   * inside the run. On the host `<workspace>/.git` is an empty directory.
   */
  gitDir: string;
  workspace: string;
  /** The parent repository's common Git directory. */
  parentGitDir: string;
  branch: string;
  /** The ticket branch tip the run started from; the transfer's compare-and-swap base. */
  expected: string;
  target?: string;
  shared: boolean;
  protectedPaths?: string[];
}

export interface RunCloneOptions {
  /** Any path inside the parent checkout. */
  parent: string;
  /** Stable per-ticket directory; refreshed in place. */
  workspace: string;
  /** Default: {@link runCloneGitDir}, in the conductor's cache. */
  gitDir?: string;
  env?: Env;
  branch: string;
  /** Carried as `origin/<target>`; nothing is merged. */
  target?: string;
  /** Borrow the parent's objects through alternates instead of copying them. */
  shared?: boolean;
}

type Env = Record<string, string | undefined>;

/** Where a workspace's run Git directory lives: the conductor's cache, never the workspace. */
export function runCloneGitDir(workspace: string, env: Env = process.env) {
  const cache = env.XDG_CACHE_HOME || join(env.HOME || homedir(), '.cache');
  const key = createHash('sha256').update(resolve(workspace)).digest('hex');
  return join(cache, 'bakers/run-git', `${key.slice(0, 16)}.git`);
}

const recordOf = (gitDir: string) => `${gitDir}.json`;

export function saveRunClone(record: RunClone): void {
  writeFileSync(recordOf(record.gitDir), JSON.stringify(record), {
    mode: 0o600,
  });
}

/** The record of the workspace's current run clone; `undefined` for a linked worktree. */
export function loadRunClone(
  workspace: string,
  env: Env = process.env,
): RunClone | undefined {
  try {
    return JSON.parse(
      readFileSync(recordOf(runCloneGitDir(workspace, env)), 'utf8'),
    );
  } catch {
    return undefined;
  }
}

export function removeRunClone(workspace: string, env: Env = process.env) {
  const gitDir = runCloneGitDir(workspace, env);
  rmSync(gitDir, { recursive: true, force: true });
  rmSync(recordOf(gitDir), { force: true });
}

const git = (args: string[], cwd?: string) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

const tryGit = (args: string[]) => {
  try {
    return git(args);
  } catch {
    return undefined;
  }
};

/**
 * A fresh clone of the ticket branch for one isolated run. The previous run's
 * Git directory is discarded, so no ref, config or hook it wrote survives; the
 * workspace keeps only ignored files.
 */
export function createRunClone(options: RunCloneOptions): RunClone {
  const { workspace, branch, target, shared = false } = options;
  const gitDir = options.gitDir ?? runCloneGitDir(workspace, options.env);
  const parentGitDir = git(
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    options.parent,
  );
  const parent = (...args: string[]) =>
    git(['--git-dir', parentGitDir, ...args]);
  git(['check-ref-format', `refs/heads/${branch}`]);
  const expected = parent(
    'rev-parse',
    '--verify',
    `refs/heads/${branch}^{commit}`,
  );
  // Git runs a submodule's own config; the host never checks one out for a run.
  if (
    parent('ls-tree', '-r', '-z', expected)
      .split('\0')
      .some((entry) => entry.startsWith('160000 '))
  )
    throw new Error('run clone: submodules are not supported');

  rmSync(gitDir, { recursive: true, force: true });
  mkdirSync(dirname(gitDir), { recursive: true });
  git([
    '-c',
    'init.defaultRefFormat=files',
    'clone',
    '--quiet',
    '--bare',
    '--template=',
    '--no-tags',
    '--single-branch',
    '--branch',
    branch,
    ...(shared ? ['--shared'] : ['--no-local', '--no-hardlinks']),
    parentGitDir,
    gitDir,
  ]);
  const run = (...args: string[]) => git(['--git-dir', gitDir, ...args]);
  run('config', 'core.bare', 'false');
  // The conductor's reload signal is not the run's untracked work.
  mkdirSync(join(gitDir, 'info'), { recursive: true });
  writeFileSync(join(gitDir, 'info/exclude'), `/.bakers/${UI_REFRESH_FILE}\n`);
  run('config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
  // The parent path means nothing inside the run; forge tools do the real fetch and push.
  const url = tryGit([
    '--git-dir',
    parentGitDir,
    'config',
    '--get',
    'remote.origin.url',
  ]);
  if (url) run('config', 'remote.origin.url', url);
  else run('config', '--unset', 'remote.origin.url');
  if (target) {
    const source = [
      `refs/remotes/origin/${target}`,
      `refs/heads/${target}`,
    ].find((ref) =>
      tryGit([
        '--git-dir',
        parentGitDir,
        'rev-parse',
        '--verify',
        '--quiet',
        ref,
      ]),
    );
    if (source)
      run(
        'fetch',
        '--quiet',
        '--no-tags',
        '--no-write-fetch-head',
        parentGitDir,
        `+${source}:refs/remotes/origin/${target}`,
      );
  }

  mkdirSync(workspace, { recursive: true });
  // An empty `.git` stays: the run's and the site containers' mounts sit on
  // it, and removing it would detach them. Anything else there was planted;
  // rm removes a link itself, never its target.
  const placeholder = join(workspace, '.git');
  const present = lstatSync(placeholder, { throwIfNoEntry: false });
  if (!present?.isDirectory() || readdirSync(placeholder).length > 0) {
    rmSync(placeholder, { recursive: true, force: true });
    mkdirSync(placeholder);
  }
  const tree = (...args: string[]) =>
    git(['--git-dir', gitDir, '--work-tree', workspace, ...args], workspace);
  // Index first, so clean removes only untracked files and reset rewrites only changed ones.
  tree('read-tree', 'HEAD');
  tree('clean', '-ffdq');
  tree('reset', '--hard', '--quiet');
  const record: RunClone = {
    gitDir,
    workspace,
    parentGitDir,
    branch,
    expected,
    ...(target ? { target } : {}),
    shared,
  };
  saveRunClone(record);
  return record;
}
