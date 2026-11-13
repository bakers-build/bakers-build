import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  createRunClone,
  loadRunClone,
  removeRunClone,
  runCloneGitDir,
  saveRunClone,
} from '../src/core/run-clone.js';

const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((root) => {
    rmSync(root, { recursive: true, force: true });
  }),
);
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const commit = (cwd: string, message: string) =>
  git(
    cwd,
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@test',
    'commit',
    '-qm',
    message,
  );

/** A parent with `ticket` one commit ahead of the base and `origin/next` one commit beside it. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bb-run-clone-'));
  roots.push(root);
  const parent = join(root, 'parent');
  mkdirSync(parent);
  git(parent, 'init', '-q', '-b', 'main');
  writeFileSync(join(parent, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(parent, 'file'), 'base');
  git(parent, 'add', '.');
  commit(parent, 'base');
  git(parent, 'checkout', '-qb', 'target-work');
  writeFileSync(join(parent, 'target-only'), 'target');
  git(parent, 'add', '.');
  commit(parent, 'target');
  git(parent, 'update-ref', 'refs/remotes/origin/next', 'HEAD');
  git(parent, 'checkout', '-qb', 'ticket', 'main');
  mkdirSync(join(parent, 'dir'));
  writeFileSync(join(parent, 'dir/tracked'), 'ticket');
  git(parent, 'add', '.');
  commit(parent, 'ticket');
  git(parent, 'checkout', '-q', 'main');
  const workspace = join(root, 'workspace');
  const gitDir = join(root, 'storage/run.git');
  const create = (shared = false) =>
    createRunClone({
      parent,
      workspace,
      gitDir,
      branch: 'ticket',
      target: 'next',
      shared,
    });
  const run = (...args: string[]) =>
    git(workspace, `--git-dir=${gitDir}`, `--work-tree=${workspace}`, ...args);
  return { root, parent, workspace, gitDir, create, run };
}

it('clones the ticket branch with its Git directory outside the workspace and the target as an unmerged ref', () => {
  const { parent, workspace, gitDir, create, run } = fixture();
  const record = create();

  expect(existsSync(join(workspace, '.git'))).toBe(false);
  expect(readFileSync(join(workspace, 'dir/tracked'), 'utf8')).toBe('ticket');
  expect(run('symbolic-ref', 'HEAD')).toBe('refs/heads/ticket');
  expect(run('rev-parse', 'HEAD')).toBe(git(parent, 'rev-parse', 'ticket'));
  expect(record.expected).toBe(git(parent, 'rev-parse', 'ticket'));
  expect(run('rev-parse', 'origin/next')).toBe(
    git(parent, 'rev-parse', 'origin/next'),
  );
  // Nothing is merged: the target's file is absent and the tree is clean.
  expect(existsSync(join(workspace, 'target-only'))).toBe(false);
  expect(run('status', '--porcelain')).toBe('');
  expect(record).toMatchObject({ gitDir, workspace, branch: 'ticket' });
});

it('copies objects into independent inodes without alternates by default', () => {
  const { gitDir, create } = fixture();
  create();
  expect(existsSync(join(gitDir, 'objects/info/alternates'))).toBe(false);
  const files = readdirSync(join(gitDir, 'objects'), {
    recursive: true,
    withFileTypes: true,
  }).filter((entry) => entry.isFile());
  expect(files.length).toBeGreaterThan(0);
  for (const entry of files)
    expect(statSync(join(entry.parentPath, entry.name)).nlink).toBe(1);
});

it('borrows the parent objects through alternates when shared', () => {
  const { parent, gitDir, create, run } = fixture();
  create(true);
  expect(
    readFileSync(join(gitDir, 'objects/info/alternates'), 'utf8').trim(),
  ).toBe(join(parent, '.git/objects'));
  expect(run('status', '--porcelain')).toBe('');
});

it('starts every run fresh: drops run refs, config and uncommitted work, keeps ignored files', () => {
  const { root, workspace, gitDir, create, run } = fixture();
  create();
  run('update-ref', 'refs/heads/planted', 'HEAD');
  run('config', 'core.fsmonitor', `touch ${join(root, 'executed')}`);
  writeFileSync(join(workspace, 'file'), 'edited');
  writeFileSync(join(workspace, 'untracked'), 'left over');
  mkdirSync(join(workspace, 'node_modules'));
  writeFileSync(join(workspace, 'node_modules/kept'), 'installed');

  create();

  expect(run('for-each-ref', '--format=%(refname)', 'refs/heads')).toBe(
    'refs/heads/ticket',
  );
  expect(readFileSync(join(gitDir, 'config'), 'utf8')).not.toContain(
    'fsmonitor',
  );
  expect(readFileSync(join(workspace, 'file'), 'utf8')).toBe('base');
  expect(existsSync(join(workspace, 'untracked'))).toBe(false);
  expect(readFileSync(join(workspace, 'node_modules/kept'), 'utf8')).toBe(
    'installed',
  );
  expect(existsSync(join(root, 'executed'))).toBe(false);
});

it('does not write through a symlink the previous run planted over a tracked directory', () => {
  const { root, workspace, create } = fixture();
  create();
  const outside = join(root, 'outside');
  mkdirSync(outside);
  rmSync(join(workspace, 'dir'), { recursive: true });
  symlinkSync(outside, join(workspace, 'dir'));
  symlinkSync(outside, join(workspace, '.git'));

  create();

  expect(readdirSync(outside)).toEqual([]);
  expect(readFileSync(join(workspace, 'dir/tracked'), 'utf8')).toBe('ticket');
  expect(existsSync(join(workspace, '.git'))).toBe(false);
});

it('refuses a branch the parent does not have', () => {
  const { parent, workspace, gitDir } = fixture();
  expect(() =>
    createRunClone({ parent, workspace, gitDir, branch: 'missing' }),
  ).toThrow();
});

it('stores the clone outside the workspace by default and finds it again by workspace path', () => {
  const { root, parent, workspace } = fixture();
  const env = { XDG_CACHE_HOME: join(root, 'cache') };
  expect(loadRunClone(workspace, env)).toBeUndefined();

  const record = createRunClone({ parent, workspace, branch: 'ticket', env });

  expect(record.gitDir).toBe(runCloneGitDir(workspace, env));
  expect(record.gitDir.startsWith(join(root, 'cache/bakers/run-git/'))).toBe(
    true,
  );
  expect(loadRunClone(workspace, env)).toEqual(record);
  saveRunClone({ ...record, expected: 'moved', protectedPaths: ['.ddev'] });
  expect(loadRunClone(workspace, env)).toMatchObject({
    expected: 'moved',
    protectedPaths: ['.ddev'],
  });
  removeRunClone(workspace, env);
  expect(loadRunClone(workspace, env)).toBeUndefined();
  expect(existsSync(record.gitDir)).toBe(false);
});
