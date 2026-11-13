import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Host-owned record of one isolated run's clone; never store it where the run can write. */
export interface RunClone {
  /** The run's Git directory, outside the workspace; mounted as `.git` only inside the run. */
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
  gitDir: string;
  branch: string;
  /** Carried as `origin/<target>`; nothing is merged. */
  target?: string;
  /** Borrow the parent's objects through alternates instead of copying them. */
  shared?: boolean;
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
  const { workspace, gitDir, branch, target, shared = false } = options;
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
  // Removes a planted link itself, never its target.
  rmSync(join(workspace, '.git'), { recursive: true, force: true });
  const tree = (...args: string[]) =>
    git(['--git-dir', gitDir, '--work-tree', workspace, ...args], workspace);
  // Index first, so clean removes only untracked files and reset rewrites only changed ones.
  tree('read-tree', 'HEAD');
  tree('clean', '-ffdq');
  tree('reset', '--hard', '--quiet');
  return {
    gitDir,
    workspace,
    parentGitDir,
    branch,
    expected,
    ...(target ? { target } : {}),
    shared,
  };
}
