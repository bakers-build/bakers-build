import { execFileSync } from 'node:child_process';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, sep } from 'node:path';

/** Host-owned record; never store this inside the run's writable mounts. */
export interface IsolatedGit {
  path: string;
  workspace: string;
  branch: string;
  expected: string;
  gitDir: string;
  commonDir: string;
  protectedPaths?: string[];
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

function normalizeProtectedPaths(paths: readonly string[]): string[] {
  return [
    ...new Set(
      ['.bakers', ...paths].map((path) => {
        if (
          !path ||
          path.startsWith('/') ||
          path.includes('\0') ||
          path.includes('\\') ||
          path.includes(':') ||
          path.split('/').includes('..')
        )
          throw new Error(`isolated Git: invalid protected path ${path}`);
        const normalized = posix.normalize(path).replace(/\/$/, '');
        if (normalized === '.')
          throw new Error(`isolated Git: invalid protected path ${path}`);
        return normalized;
      }),
    ),
  ];
}

function rejectGitlinks(entries: string): void {
  if (entries.split('\0').some((entry) => entry.startsWith('160000 ')))
    throw new Error('isolated Git: submodules are not supported');
}

/** Copy objects, never hardlink or borrow them from the parent's GC lifetime. */
export function isolateGit(
  workspace: string,
  path: string,
  branch: string,
  protectedPaths: readonly string[] = ['.bakers'],
): IsolatedGit {
  const protectedRelativePaths = normalizeProtectedPaths(protectedPaths);
  git(workspace, 'check-ref-format', `refs/heads/${branch}`);
  if (git(workspace, 'symbolic-ref', 'HEAD') !== `refs/heads/${branch}`)
    throw new Error(
      'isolated Git: workspace is not on the intended ticket branch',
    );
  const expected = git(workspace, 'rev-parse', 'HEAD');
  // Host status may execute nested Git config; host tools must not stage run-planted repositories.
  rejectGitlinks(git(workspace, 'ls-files', '--stage', '-z'));
  rejectGitlinks(git(workspace, 'ls-tree', '-r', '-z', expected));
  const gitDir = git(
    workspace,
    'rev-parse',
    '--path-format=absolute',
    '--git-dir',
  );
  const commonDir = git(
    workspace,
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  );
  if (gitDir === commonDir)
    throw new Error('isolated Git requires a linked Git worktree');
  git(
    workspace,
    'clone',
    '--bare',
    '--no-hardlinks',
    '--dissociate',
    '--template=',
    commonDir,
    path,
  );
  git(
    workspace,
    `--git-dir=${path}`,
    'symbolic-ref',
    'HEAD',
    `refs/heads/${branch}`,
  );
  git(
    workspace,
    `--git-dir=${path}`,
    'update-ref',
    `refs/heads/${branch}`,
    expected,
  );
  git(workspace, `--git-dir=${path}`, 'config', 'core.bare', 'false');
  git(workspace, `--git-dir=${path}`, 'config', 'core.worktree', workspace);
  git(workspace, `--git-dir=${path}`, 'read-tree', expected);
  mkdirSync(join(path, 'hooks'), { recursive: true });
  return {
    path: realpathSync(path),
    workspace,
    branch,
    expected,
    gitDir,
    commonDir,
    protectedPaths: protectedRelativePaths,
  };
}

/** Read object bytes without following a run-planted symlink, including raced ancestors. */
function copyObjects(source: string, target: string): void {
  if (!lstatSync(source).isDirectory() || realpathSync(source) !== source)
    throw new Error('isolated Git: invalid object store');
  const root = source;
  const copy = (from: string, to: string) => {
    const fd = openSync(from, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const actual = realpathSync(`/proc/self/fd/${fd}`);
      if (!actual.startsWith(root + sep) || !fstatSync(fd).isFile())
        throw new Error('isolated Git: object escaped its private store');
      writeFileSync(to, readFileSync(fd), { flag: 'wx' });
    } finally {
      closeSync(fd);
    }
  };
  for (const name of readdirSync(source)) {
    if (name === 'info') continue; // Never import alternates or source-side configuration.
    if (name !== 'pack' && !/^[a-f0-9]{2}$/.test(name))
      throw new Error('isolated Git: invalid object directory');
    const from = join(source, name);
    if (!lstatSync(from).isDirectory())
      throw new Error('isolated Git: invalid object directory');
    mkdirSync(join(target, name), { recursive: true });
    for (const file of readdirSync(from)) {
      const valid =
        name === 'pack'
          ? /^pack-[a-f0-9]{40,64}\.(pack|idx|rev)$/.test(file)
          : /^[a-f0-9]{38}$|^[a-f0-9]{62}$/.test(file);
      if (!valid) throw new Error('isolated Git: invalid object file');
      copy(join(from, file), join(target, name, file));
    }
  }
}

/** Import verified objects through clean metadata; update one ref with compare-and-swap. */
export function transferIsolatedCommit(
  record: IsolatedGit,
  commit: string,
): void {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit))
    throw new Error('isolated Git: transfer requires a full commit hash');
  const scratch = mkdtempSync(join(tmpdir(), 'bb-commit-transfer-'));
  try {
    git(
      scratch,
      'init',
      '--bare',
      '--template=',
      `--object-format=${commit.length === 64 ? 'sha256' : 'sha1'}`,
      '-q',
    );
    copyObjects(join(record.path, 'objects'), join(scratch, 'objects'));
    git(scratch, 'fsck', '--strict', '--no-reflogs', '--no-dangling', commit);
    if (git(scratch, 'cat-file', '-t', commit) !== 'commit')
      throw new Error('isolated Git: transfer requires a commit');
    rejectGitlinks(git(scratch, 'ls-tree', '-r', '-z', commit));
    git(scratch, 'merge-base', '--is-ancestor', record.expected, commit);
    const protectedPaths = normalizeProtectedPaths(
      record.protectedPaths ?? [],
    ).map((path) => `:(literal)${path}`);
    for (const revision of git(
      scratch,
      'rev-list',
      `${record.expected}..${commit}`,
    )
      .split('\n')
      .filter(Boolean)) {
      if (
        git(
          scratch,
          'diff-tree',
          '-m',
          '-r',
          '--root',
          '--no-commit-id',
          '--name-only',
          '-z',
          '--no-renames',
          revision,
          '--',
          ...protectedPaths,
        )
      )
        throw new Error(
          `isolated Git: commit ${revision} changes a protected path`,
        );
    }
    // Only scratch's clean config is read; the run's hooks/config never reach host Git.
    git(
      record.workspace,
      `--git-dir=${record.gitDir}`,
      '-c',
      'protocol.file.allow=always',
      'fetch',
      '--no-tags',
      '--no-write-fetch-head',
      scratch,
      commit,
    );
    git(
      record.workspace,
      `--git-dir=${record.gitDir}`,
      'update-ref',
      `refs/heads/${record.branch}`,
      commit,
      record.expected,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
