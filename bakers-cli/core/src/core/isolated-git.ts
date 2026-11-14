import { execFileSync } from 'node:child_process';
import {
  closeSync,
  constants,
  existsSync,
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
import type { RunClone } from './run-clone.js';

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

/** Read object bytes without following a run-planted symlink, including raced ancestors. */
function copyObjects(source: string, target: string): void {
  if (!lstatSync(source).isDirectory() || realpathSync(source) !== source)
    throw new Error('isolated Git: invalid object store');
  const root = source;
  const copy = (from: string, to: string) => {
    // O_NONBLOCK: a FIFO the run planted must fail the isFile check, not block the open.
    const fd = openSync(
      from,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
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
    if (name !== 'pack' && !/^[a-f0-9]{2}$/.test(name)) continue;
    const from = join(source, name);
    if (!lstatSync(from).isDirectory())
      throw new Error('isolated Git: invalid object directory');
    mkdirSync(join(target, name), { recursive: true });
    for (const file of readdirSync(from)) {
      const valid =
        name === 'pack'
          ? /^pack-[a-f0-9]{40,64}\.(pack|idx|rev)$/.test(file)
          : /^[a-f0-9]{38}$|^[a-f0-9]{62}$/.test(file);
      if (!valid) continue; // Auxiliary indexes and retention markers are not objects.
      copy(join(from, file), join(target, name, file));
    }
  }
}

// shortcut: /proc/self/fd pins directories against swapped symlinks, Linux only; use openat when another host OS runs isolating runtimes.
/** Open `rel` below `root` one component at a time, never through a link the run planted. */
function pinDir(root: string, rel: string, create = false): number {
  const flags =
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  let fd = openSync(root, flags);
  for (const part of rel.split('/').filter(Boolean)) {
    const next = `/proc/self/fd/${fd}/${part}`;
    try {
      if (part === '..') throw new Error('isolated Git: invalid path');
      if (create && !existsSync(next)) mkdirSync(next);
      const child = openSync(next, flags);
      closeSync(fd);
      fd = child;
    } catch (err) {
      closeSync(fd);
      throw err;
    }
  }
  return fd;
}

/** A small file below the run's Git directory; `undefined` when it does not exist. */
function readRunFile(root: string, path: string): string | undefined {
  let dir: number;
  try {
    dir = pinDir(root, posix.dirname(path));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  try {
    const fd = openSync(
      `/proc/self/fd/${dir}/${posix.basename(path)}`,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      if (!fstatSync(fd).isFile())
        throw new Error(`isolated Git: ${path} is not a file`);
      return readFileSync(fd, 'utf8');
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  } finally {
    closeSync(dir);
  }
}

const HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

/** The run's ticket branch tip, read as plain files: Git never runs under the run's config. */
export function runCloneTip(record: RunClone): string {
  const ref = `refs/heads/${record.branch}`;
  if (readRunFile(record.gitDir, 'HEAD')?.trim() !== `ref: ${ref}`)
    throw new Error('isolated Git: the run left its ticket branch');
  const tip =
    readRunFile(record.gitDir, ref)?.trim() ??
    readRunFile(record.gitDir, 'packed-refs')
      ?.split('\n')
      .find((line) => line.endsWith(` ${ref}`))
      ?.split(' ')[0];
  if (!tip || !HASH.test(tip))
    throw new Error('isolated Git: the run ticket branch has no readable tip');
  return tip;
}

/** The parent's tip of a branch as the run sees it under `origin/`. */
function parentOrigin(record: RunClone, branch: string): string | undefined {
  for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
    try {
      return git(
        record.parentGitDir,
        `--git-dir=${record.parentGitDir}`,
        'rev-parse',
        '--verify',
        '--quiet',
        `${ref}^{commit}`,
      );
    } catch {
      // Try the next spelling.
    }
  }
  return undefined;
}

/** One ref of the run's clone, written as a plain file below pinned directories. */
function writeRunRef(record: RunClone, ref: string, tip: string): void {
  const dir = pinDir(record.gitDir, posix.dirname(ref), true);
  try {
    const fd = openSync(
      `/proc/self/fd/${dir}/${posix.basename(ref)}`,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_TRUNC |
        constants.O_NOFOLLOW,
      0o644,
    );
    try {
      writeFileSync(fd, `${tip}\n`);
    } finally {
      closeSync(fd);
    }
  } finally {
    closeSync(dir);
  }
}

/**
 * Give the run the parent's current `origin/<branch>` refs (default: its
 * target): objects as one new pack, each ref as a plain file. Nothing here
 * runs Git inside the run's directory.
 */
export function refreshRunTarget(
  record: RunClone,
  branches: readonly string[] = record.target ? [record.target] : [],
): void {
  const tips = branches.flatMap((branch) => {
    git(record.parentGitDir, 'check-ref-format', `refs/heads/${branch}`);
    const tip = parentOrigin(record, branch);
    return tip ? [{ branch, tip }] : [];
  });
  if (tips.length === 0) return;
  // pack-objects renames its temp pack from the parent's object store: same filesystem, or EXDEV.
  const scratch = mkdtempSync(join(record.parentGitDir, 'bb-target-refresh-'));
  try {
    execFileSync(
      'git',
      [
        `--git-dir=${record.parentGitDir}`,
        'pack-objects',
        '--quiet',
        '--revs',
        join(scratch, 'pack'),
      ],
      {
        input: `${tips.map(({ tip }) => tip).join('\n')}\n^${record.expected}\n`,
        stdio: ['pipe', 'ignore', 'pipe'],
      },
    );
    const pack = pinDir(record.gitDir, 'objects/pack', true);
    try {
      for (const file of readdirSync(scratch)) {
        try {
          writeFileSync(
            `/proc/self/fd/${pack}/${file}`,
            readFileSync(join(scratch, file)),
            { flag: 'wx', mode: 0o444 },
          );
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        }
      }
    } finally {
      closeSync(pack);
    }
    for (const { branch, tip } of tips)
      writeRunRef(record, `refs/remotes/origin/${branch}`, tip);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Import verified objects through clean metadata and fast-forward the ticket
 * branch in the parent with compare-and-swap. Defaults to the run's branch tip.
 */
export function transferIsolatedCommit(
  record: RunClone,
  commit: string = runCloneTip(record),
): string {
  if (!HASH.test(commit))
    throw new Error('isolated Git: transfer requires a full commit hash');
  if (commit === record.expected) return commit;
  const parent = (...args: string[]) =>
    git(record.parentGitDir, `--git-dir=${record.parentGitDir}`, ...args);
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
    // History the parent already holds is read from there, never from the run.
    mkdirSync(join(scratch, 'objects/info'), { recursive: true });
    writeFileSync(
      join(scratch, 'objects/info/alternates'),
      `${join(record.parentGitDir, 'objects')}\n`,
    );
    copyObjects(join(record.gitDir, 'objects'), join(scratch, 'objects'));
    git(scratch, 'fsck', '--strict', '--no-reflogs', '--no-dangling', commit);
    if (git(scratch, 'cat-file', '-t', commit) !== 'commit')
      throw new Error('isolated Git: transfer requires a commit');
    rejectGitlinks(git(scratch, 'ls-tree', '-r', '-z', commit));
    git(scratch, 'merge-base', '--is-ancestor', record.expected, commit);
    // Against the tip the run started from, so a merge of the target passes.
    if (
      git(
        scratch,
        'diff-tree',
        '-r',
        '--name-only',
        '-z',
        '--no-renames',
        record.expected,
        commit,
        '--',
        ...normalizeProtectedPaths(record.protectedPaths ?? []).map(
          (path) => `:(literal)${path}`,
        ),
      )
    )
      throw new Error(
        `isolated Git: commit ${commit} changes a protected path`,
      );
    // Only scratch's clean config is read; the run's hooks/config never reach host Git.
    parent(
      '-c',
      'protocol.file.allow=always',
      'fetch',
      '--no-tags',
      '--no-write-fetch-head',
      scratch,
      commit,
    );
    parent(
      'update-ref',
      `refs/heads/${record.branch}`,
      commit,
      record.expected,
    );
    return commit;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
