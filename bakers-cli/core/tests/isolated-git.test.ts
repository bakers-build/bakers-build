import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
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
  isolateGit,
  transferIsolatedCommit,
} from '../src/core/isolated-git.js';

const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((root) => {
    rmSync(root, { recursive: true, force: true });
  }),
);
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

it('keeps local commits private and transfers only the intended branch without source hooks or config', () => {
  const root = mkdtempSync(join(tmpdir(), 'bb-private-git-'));
  roots.push(root);
  const main = join(root, 'main');
  const ws = join(root, 'tree');
  mkdirSync(main);
  git(main, 'init', '-q');
  git(
    main,
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@test',
    'commit',
    '--allow-empty',
    '-qm',
    'base',
  );
  git(main, 'worktree', 'add', '-qb', 'ticket', ws);
  const initial = git(main, 'show-ref');
  const record = isolateGit(ws, join(root, 'private'), 'ticket');
  const local = (...args: string[]) =>
    git(ws, `--git-dir=${record.path}`, ...args);
  local(
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@test',
    'commit',
    '--allow-empty',
    '-qm',
    'local',
  );
  const commit = local('rev-parse', 'HEAD');
  expect(git(main, 'show-ref')).toBe(initial);
  local('update-ref', 'refs/heads/unrelated', commit);
  const config = readFileSync(join(main, '.git/config'), 'utf8');
  writeFileSync(
    join(record.path, 'config'),
    `[core]\nfsmonitor = touch ${join(root, 'executed')}\n[uploadpack]\npackObjectsHook = touch ${join(root, 'executed')}\n`,
  );
  writeFileSync(
    join(record.path, 'hooks/reference-transaction'),
    `#!/bin/sh\ntouch ${join(root, 'executed')}\n`,
    { mode: 0o755 },
  );
  transferIsolatedCommit(record, commit);
  expect(git(main, 'rev-parse', 'ticket')).toBe(commit);
  expect(
    git(main, 'for-each-ref', '--format=%(refname)', 'refs/heads/unrelated'),
  ).toBe('');
  expect(readFileSync(join(main, '.git/config'), 'utf8')).toBe(config);
  expect(() => readFileSync(join(root, 'executed'))).toThrow();
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bb-private-git-'));
  roots.push(root);
  const main = join(root, 'main');
  const workspace = join(root, 'tree');
  const sibling = join(root, 'sibling');
  mkdirSync(main);
  git(main, 'init', '-q');
  writeFileSync(join(main, 'file'), 'base');
  git(main, 'add', 'file');
  git(
    main,
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@test',
    'commit',
    '-qm',
    'base',
  );
  git(main, 'worktree', 'add', '-qb', 'ticket', workspace);
  git(main, 'worktree', 'add', '-qb', 'sibling', sibling);
  const record = isolateGit(workspace, join(root, 'private'), 'ticket');
  const local = (...args: string[]) =>
    git(workspace, `--git-dir=${record.path}`, ...args);
  const commit = () => {
    writeFileSync(join(workspace, 'file'), 'local');
    local('add', 'file');
    local(
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@test',
      'commit',
      '-qm',
      'local',
    );
    return local('rev-parse', 'HEAD');
  };
  return { root, main, workspace, sibling, record, local, commit };
}
function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (relative: string) => {
    for (const name of readdirSync(join(root, relative))) {
      const path = join(relative, name);
      const stat = lstatSync(join(root, path));
      if (stat.isDirectory()) visit(path);
      else files[path] = readFileSync(join(root, path)).toString('hex');
    }
  };
  visit('');
  return files;
}
it('copies object bytes into independent inodes without alternates', () => {
  const { main, record } = fixture();
  const objects = join(main, '.git/objects');
  const files = snapshot(objects);
  expect(Object.keys(files).length).toBeGreaterThan(0);
  for (const file of Object.keys(files)) {
    const source = statSync(join(objects, file));
    const copy = statSync(join(record.path, 'objects', file));
    expect([copy.dev, copy.ino]).not.toEqual([source.dev, source.ino]);
    expect(copy.nlink).toBe(1);
    expect(
      readFileSync(join(record.path, 'objects', file)).toString('hex'),
    ).toBe(files[file]);
  }
  expect(existsSync(join(record.path, 'objects/info/alternates'))).toBe(false);
});
it('keeps parent and sibling snapshots unchanged through local Git and direct metadata writes', () => {
  const { main, sibling, record, local, commit } = fixture();
  const beforeMain = snapshot(main);
  const beforeSibling = snapshot(sibling);
  const tip = commit();
  expect(local('log', '-1', '--format=%s')).toBe('local');
  expect(local('diff', '--name-only', record.expected, tip)).toBe('file');
  local('update-ref', 'refs/heads/sibling', tip);
  writeFileSync(join(record.path, 'refs/heads/ticket'), `${tip}\n`);
  writeFileSync(join(record.path, 'config'), '[core]\nbare = false\n');
  expect(snapshot(main)).toEqual(beforeMain);
  expect(snapshot(sibling)).toEqual(beforeSibling);
});
it('rejects a concurrently advanced destination without changing any refs or losing local work', () => {
  const { main, record, local, commit } = fixture();
  const tip = commit();
  const tree = git(main, 'rev-parse', 'HEAD^{tree}');
  const moved = git(
    main,
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@test',
    'commit-tree',
    tree,
    '-p',
    record.expected,
    '-m',
    'concurrent',
  );
  git(main, 'update-ref', 'refs/heads/ticket', moved);
  const refs = git(main, 'show-ref');
  expect(() => transferIsolatedCommit(record, tip)).toThrow();
  expect(git(main, 'show-ref')).toBe(refs);
  expect(local('rev-parse', 'HEAD')).toBe(tip);
  expect(local('show', 'HEAD:file')).toBe('local');
});
it('rejects malformed, missing, noncommit and unrelated commits without changing host refs', () => {
  const { main, record, local } = fixture();
  const refs = git(main, 'show-ref');
  const blob = local('rev-parse', 'HEAD:file');
  const tree = local('rev-parse', 'HEAD^{tree}');
  const unrelated = local(
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@test',
    'commit-tree',
    tree,
    '-m',
    'unrelated',
  );
  for (const value of ['HEAD', '0'.repeat(40), blob, tree, unrelated]) {
    expect(() => transferIsolatedCommit(record, value)).toThrow();
    expect(git(main, 'show-ref')).toBe(refs);
  }
});
it.each([
  'objects',
  'directory',
  'file',
])('rejects symlinked %s in the private object store', (kind) => {
  const { root, main, record, commit } = fixture();
  const tip = commit();
  const objects = join(record.path, 'objects');
  const target =
    kind === 'objects'
      ? objects
      : kind === 'directory'
        ? join(objects, tip.slice(0, 2))
        : join(objects, tip.slice(0, 2), tip.slice(2));
  const outside = join(root, 'outside');
  if (kind === 'file') writeFileSync(outside, readFileSync(target));
  else mkdirSync(outside);
  rmSync(target, { recursive: true, force: true });
  symlinkSync(outside, target);
  const before = snapshot(main);
  expect(() => transferIsolatedCommit(record, tip)).toThrow();
  expect(snapshot(main)).toEqual(before);
});
it('does not execute run-planted workspace metadata during transfer', () => {
  const { root, main, workspace, record, commit } = fixture();
  const tip = commit();
  const evil = join(root, 'evil');
  git(root, 'init', '--bare', '-q', evil);
  writeFileSync(
    join(evil, 'hooks/reference-transaction'),
    `#!/bin/sh\ntouch '${join(root, 'executed')}'\n`,
    { mode: 0o755 },
  );
  writeFileSync(join(workspace, '.git'), `gitdir: ${evil}\n`);
  expect(() => transferIsolatedCommit(record, tip)).not.toThrow();
  expect(git(main, 'rev-parse', 'ticket')).toBe(tip);
  expect(existsSync(join(root, 'executed'))).toBe(false);
});

it('rejects isolation for a destination other than the trusted worktree branch', () => {
  const { root, main, workspace } = fixture();
  const before = snapshot(main);
  expect(() =>
    isolateGit(workspace, join(root, 'wrong-destination'), 'sibling'),
  ).toThrow(/intended ticket branch/);
  expect(snapshot(main)).toEqual(before);
});

it.each([
  'index',
  'HEAD',
])('rejects tracked gitlinks in %s before isolation', (kind) => {
  const { root, workspace, record } = fixture();
  git(
    workspace,
    'update-index',
    '--add',
    '--cacheinfo',
    `160000,${record.expected},nested`,
  );
  if (kind === 'HEAD')
    git(
      workspace,
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@test',
      'commit',
      '-qm',
      'submodule',
    );
  expect(() =>
    isolateGit(workspace, join(root, 'with-submodule'), 'ticket'),
  ).toThrow(/submodules.*not supported/);
  expect(existsSync(join(root, 'with-submodule'))).toBe(false);
});
it('rejects a transferred gitlink before importing any objects or changing host metadata', () => {
  const { main, workspace, record, local } = fixture();
  local(
    'update-index',
    '--add',
    '--cacheinfo',
    `160000,${record.expected},nested`,
  );
  local(
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@test',
    'commit',
    '-qm',
    'submodule',
  );
  const tip = local('rev-parse', 'HEAD');
  const nested = join(workspace, 'nested');
  mkdirSync(nested);
  git(nested, 'init', '-q');
  const hook = join(nested, 'fsmonitor');
  writeFileSync(
    hook,
    `#!/bin/sh\ntouch '${join(workspace, 'executed')}'\nprintf 'token\\0'\n`,
    { mode: 0o755 },
  );
  git(nested, 'config', 'core.fsmonitor', hook);
  const before = snapshot(main);
  expect(() => transferIsolatedCommit(record, tip)).toThrow(
    /submodules.*not supported/,
  );
  expect(snapshot(main)).toEqual(before);
  expect(existsSync(join(workspace, 'executed'))).toBe(false);
});

function protectedFixture(paths: readonly string[] = []) {
  const context = fixture();
  mkdirSync(join(context.workspace, '.bakers'));
  mkdirSync(join(context.workspace, '.ddev'));
  writeFileSync(join(context.workspace, '.bakers/host.sh'), 'trusted');
  writeFileSync(join(context.workspace, '.ddev/config.yaml'), 'trusted');
  git(context.workspace, 'add', '.bakers', '.ddev');
  git(
    context.workspace,
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@test',
    'commit',
    '-qm',
    'host configuration',
  );
  const record = isolateGit(
    context.workspace,
    join(context.root, 'protected-private'),
    'ticket',
    paths,
  );
  const local = (...args: string[]) =>
    git(context.workspace, `--git-dir=${record.path}`, ...args);
  const commitTree = (...parents: string[]) =>
    local(
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@test',
      'commit-tree',
      local('write-tree'),
      ...parents.flatMap((parent) => ['-p', parent]),
      '-m',
      'plumbing',
    );
  const payload = join(context.root, 'payload');
  writeFileSync(payload, 'hostile');
  const blob = local('hash-object', '-w', payload);
  return { ...context, record, local, commitTree, blob };
}
it.each([
  'edit',
  'delete',
  'rename',
  'symlink',
  'directory-to-file',
  'configured',
])('rejects protected path %s synthesized through Git plumbing before host import', (attack) => {
  const { main, record, local, commitTree, blob } = protectedFixture(['.ddev']);
  const path =
    attack === 'configured' ? '.ddev/config.yaml' : '.bakers/host.sh';
  if (['delete', 'rename', 'directory-to-file'].includes(attack))
    local('update-index', '--force-remove', path);
  if (attack !== 'delete')
    local(
      'update-index',
      '--add',
      '--cacheinfo',
      `${attack === 'symlink' ? '120000' : '100644'},${blob},${attack === 'rename' ? 'renamed.sh' : attack === 'directory-to-file' ? '.bakers' : path}`,
    );
  const tip = commitTree(record.expected);
  const before = snapshot(main);
  expect(() => transferIsolatedCommit(record, tip)).toThrow(/protected path/);
  expect(snapshot(main)).toEqual(before);
});
it.each([
  'restored',
  'merge',
])('rejects protected changes hidden in %s history', (history) => {
  const { main, record, local, commitTree, blob } = protectedFixture();
  local('update-index', '--cacheinfo', `100644,${blob},.bakers/host.sh`);
  const hostile = commitTree(record.expected);
  local('read-tree', record.expected);
  const tip =
    history === 'restored'
      ? commitTree(hostile)
      : commitTree(record.expected, hostile);
  expect(local('diff-tree', '-r', '--name-only', record.expected, tip)).toBe(
    '',
  );
  const before = snapshot(main);
  expect(() => transferIsolatedCommit(record, tip)).toThrow(/protected path/);
  expect(snapshot(main)).toEqual(before);
});
it('keeps protected pathspecs literal and allows unrelated edits', () => {
  const { main, record, local, commitTree, blob } = protectedFixture([
    './literal[abc]/',
  ]);
  expect(record.protectedPaths).toEqual(['.bakers', 'literal[abc]']);
  local('update-index', '--add', '--cacheinfo', `100644,${blob},literala/file`);
  const tip = commitTree(record.expected);
  expect(() => transferIsolatedCommit(record, tip)).not.toThrow();
  expect(git(main, 'rev-parse', 'ticket')).toBe(tip);
});
it('rejects a literal metacharacter path protected by the host record', () => {
  const { main, record, local, commitTree, blob } = protectedFixture([
    'literal[abc]',
  ]);
  local(
    'update-index',
    '--add',
    '--cacheinfo',
    `100644,${blob},literal[abc]/file`,
  );
  const tip = commitTree(record.expected);
  const before = snapshot(main);
  expect(() => transferIsolatedCommit(record, tip)).toThrow(/protected path/);
  expect(snapshot(main)).toEqual(before);
});

it('protects .bakers when loading a legacy host record without protectedPaths', () => {
  const { main, record, local, commitTree, blob } = protectedFixture();
  delete record.protectedPaths;
  local('update-index', '--cacheinfo', `100644,${blob},.bakers/host.sh`);
  const tip = commitTree(record.expected);
  const before = snapshot(main);
  expect(() => transferIsolatedCommit(record, tip)).toThrow(/protected path/);
  expect(snapshot(main)).toEqual(before);
});
it.each([
  '',
  '.',
  '../escape',
  '/absolute',
  'a/../b',
  'bad\0path',
  'bad\\path',
])('rejects invalid protected path %s before creating private metadata', (path) => {
  const { root, workspace } = fixture();
  const privatePath = join(root, 'invalid-private');
  expect(() => isolateGit(workspace, privatePath, 'ticket', [path])).toThrow(
    /invalid protected path/,
  );
  expect(existsSync(privatePath)).toBe(false);
});
