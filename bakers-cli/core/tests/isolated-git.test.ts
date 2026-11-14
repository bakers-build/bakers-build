import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
  refreshRunTarget,
  runCloneTip,
  transferIsolatedCommit,
} from '../src/core/isolated-git.js';
import { createRunClone } from '../src/core/run-clone.js';

const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((root) => {
    rmSync(root, { recursive: true, force: true });
  }),
);
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const ident = ['-c', 'user.name=test', '-c', 'user.email=test@test'];

/** Parent with `ticket`, a `sibling` branch and `origin/next` one commit ahead of the base. */
function fixture(shared = false, base = tmpdir()) {
  const root = mkdtempSync(join(base, 'bb-transfer-'));
  roots.push(root);
  const parent = join(root, 'parent');
  mkdirSync(join(parent, '.bakers'), { recursive: true });
  git(parent, 'init', '-q', '-b', 'main');
  writeFileSync(join(parent, 'file'), 'base');
  writeFileSync(join(parent, '.bakers/provision.sh'), 'trusted');
  git(parent, 'add', '.');
  git(parent, ...ident, 'commit', '-qm', 'base');
  git(parent, 'branch', 'ticket');
  git(parent, 'branch', 'sibling');
  writeFileSync(join(parent, 'target-only'), 'target');
  git(parent, 'add', '.');
  git(parent, ...ident, 'commit', '-qm', 'target');
  git(parent, 'update-ref', 'refs/remotes/origin/next', 'HEAD');
  git(parent, 'reset', '-q', '--hard', 'ticket');
  const workspace = join(root, 'workspace');
  const record = {
    ...createRunClone({
      parent,
      workspace,
      gitDir: join(root, 'storage/run.git'),
      branch: 'ticket',
      target: 'next',
      shared,
    }),
    protectedPaths: ['.bakers', '.ddev', '.github'],
  };
  const run = (...args: string[]) =>
    git(
      workspace,
      `--git-dir=${record.gitDir}`,
      `--work-tree=${workspace}`,
      ...args,
    );
  const commit = (path = 'file') => {
    mkdirSync(join(workspace, path, '..'), { recursive: true });
    writeFileSync(join(workspace, path), 'local');
    run('add', '-A');
    run(...ident, 'commit', '-qm', 'local');
    return run('rev-parse', 'HEAD');
  };
  const plantHostileConfig = () => {
    const touch = `touch ${join(root, 'executed')}`;
    writeFileSync(
      join(record.gitDir, 'config'),
      `[core]\nfsmonitor = ${touch}\nhooksPath = ${join(record.gitDir, 'hooks')}\n[uploadpack]\npackObjectsHook = ${touch}\n`,
    );
    mkdirSync(join(record.gitDir, 'hooks'), { recursive: true });
    for (const hook of ['reference-transaction', 'post-merge', 'pre-receive'])
      writeFileSync(
        join(record.gitDir, 'hooks', hook),
        `#!/bin/sh\n${touch}\n`,
        {
          mode: 0o755,
        },
      );
  };
  return { root, parent, workspace, record, run, commit, plantHostileConfig };
}

it.each([
  false,
  true,
])('fast-forwards only the ticket branch and never runs the run-owned config or hooks (shared=%s)', (shared) => {
  const { root, parent, record, run, commit, plantHostileConfig } =
    fixture(shared);
  const tip = commit();
  run('update-ref', 'refs/heads/sibling', tip);
  run('update-ref', 'refs/heads/unrelated', tip);
  const siblingBefore = git(parent, 'rev-parse', 'sibling');
  const config = readFileSync(join(parent, '.git/config'), 'utf8');
  plantHostileConfig();

  expect(runCloneTip(record)).toBe(tip);
  expect(transferIsolatedCommit(record)).toBe(tip);

  expect(git(parent, 'rev-parse', 'ticket')).toBe(tip);
  expect(git(parent, 'rev-parse', 'sibling')).toBe(siblingBefore);
  expect(
    git(parent, 'for-each-ref', '--format=%(refname)', 'refs/heads/unrelated'),
  ).toBe('');
  expect(readFileSync(join(parent, '.git/config'), 'utf8')).toBe(config);
  expect(existsSync(join(root, 'executed'))).toBe(false);
});

it('transfers a merge of the target that the run made', () => {
  const { parent, record, run, commit } = fixture();
  commit();
  run(...ident, 'merge', '-q', '--no-edit', 'origin/next');
  const tip = run('rev-parse', 'HEAD');

  transferIsolatedCommit(record, tip);

  expect(git(parent, 'rev-parse', 'ticket')).toBe(tip);
  expect(git(parent, 'show', 'ticket:target-only')).toBe('target');
});

it('returns the start tip and changes nothing when the run made no commit', () => {
  const { parent, record } = fixture();
  const refs = git(parent, 'show-ref');
  expect(transferIsolatedCommit(record)).toBe(record.expected);
  expect(git(parent, 'show-ref')).toBe(refs);
});

it('rejects a destination that moved since the run started and keeps the local work', () => {
  const { parent, record, run, commit } = fixture();
  const tip = commit();
  const moved = git(
    parent,
    ...ident,
    'commit-tree',
    `${record.expected}^{tree}`,
    '-p',
    record.expected,
    '-m',
    'concurrent',
  );
  git(parent, 'update-ref', 'refs/heads/ticket', moved);
  const refs = git(parent, 'show-ref');

  expect(() => transferIsolatedCommit(record, tip)).toThrow();

  expect(git(parent, 'show-ref')).toBe(refs);
  expect(run('show', 'HEAD:file')).toBe('local');
});

it('rejects malformed, missing, non-commit and unrelated commits', () => {
  const { parent, record, run } = fixture();
  const refs = git(parent, 'show-ref');
  const blob = run('rev-parse', 'HEAD:file');
  const tree = run('rev-parse', 'HEAD^{tree}');
  const unrelated = run(...ident, 'commit-tree', tree, '-m', 'unrelated');
  for (const value of ['HEAD', '0'.repeat(40), blob, tree, unrelated]) {
    expect(() => transferIsolatedCommit(record, value)).toThrow();
    expect(git(parent, 'show-ref')).toBe(refs);
  }
});

it.each([
  '.bakers/provision.sh',
  '.ddev/config.yaml',
  '.github/workflows/checks.yml',
])('rejects a commit-tree commit that changes %s', (path) => {
  const { parent, record, run } = fixture();
  const refs = git(parent, 'show-ref');
  // Built without the read-only working tree, as a run could.
  const blob = execFileSync(
    'git',
    [`--git-dir=${record.gitDir}`, 'hash-object', '-w', '--stdin'],
    { input: 'planted', encoding: 'utf8' },
  ).trim();
  run('update-index', '--add', '--cacheinfo', `100644,${blob},${path}`);
  const planted = run(
    ...ident,
    'commit-tree',
    run('write-tree'),
    '-p',
    record.expected,
    '-m',
    'planted',
  );

  expect(() => transferIsolatedCommit(record, planted)).toThrow(
    /protected path/,
  );
  expect(git(parent, 'show-ref')).toBe(refs);
});

it('keeps protected pathspecs literal and allows a look-alike path', () => {
  const { parent, record, commit } = fixture();
  const tip = commit('.bakers-notes/file');
  transferIsolatedCommit(record, tip);
  expect(git(parent, 'rev-parse', 'ticket')).toBe(tip);
});

it('rejects a gitlink before changing the parent', () => {
  const { parent, record, run } = fixture();
  const refs = git(parent, 'show-ref');
  run(
    'update-index',
    '--add',
    '--cacheinfo',
    `160000,${record.expected},nested`,
  );
  const tip = run(
    ...ident,
    'commit-tree',
    run('write-tree'),
    '-p',
    record.expected,
    '-m',
    'submodule',
  );
  expect(() => transferIsolatedCommit(record, tip)).toThrow(/submodules/);
  expect(git(parent, 'show-ref')).toBe(refs);
});

it.each([
  'objects',
  'directory',
  'file',
])('rejects a symlinked %s in the run object store', (kind) => {
  const { root, parent, record, commit } = fixture();
  const tip = commit();
  const objects = join(record.gitDir, 'objects');
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
  const refs = git(parent, 'show-ref');
  expect(() => transferIsolatedCommit(record, tip)).toThrow();
  expect(git(parent, 'show-ref')).toBe(refs);
});

it('refuses a run tip read through a redirected HEAD or a symlinked ref', () => {
  const { root, record, commit } = fixture();
  const tip = commit();
  writeFileSync(join(record.gitDir, 'HEAD'), 'ref: refs/heads/sibling\n');
  expect(() => runCloneTip(record)).toThrow(/ticket branch/);
  writeFileSync(join(record.gitDir, 'HEAD'), 'ref: refs/heads/ticket\n');
  writeFileSync(join(root, 'outside'), `${tip}\n`);
  rmSync(join(record.gitDir, 'refs/heads/ticket'));
  symlinkSync(join(root, 'outside'), join(record.gitDir, 'refs/heads/ticket'));
  expect(() => runCloneTip(record)).toThrow();
});

it('refreshes the run target ref from the parent without running the run-owned config or hooks', () => {
  const { root, parent, record, run, plantHostileConfig } = fixture();
  writeFileSync(join(parent, 'newer'), 'newer');
  git(parent, 'checkout', '-q', '--detach', 'origin/next');
  git(parent, 'add', '.');
  git(parent, ...ident, 'commit', '-qm', 'newer target');
  const newer = git(parent, 'rev-parse', 'HEAD');
  git(parent, 'update-ref', 'refs/remotes/origin/next', newer);
  const ticket = run('rev-parse', 'refs/heads/ticket');
  plantHostileConfig();

  refreshRunTarget(record);

  rmSync(join(record.gitDir, 'config'));
  rmSync(join(record.gitDir, 'hooks'), { recursive: true });
  expect(run('rev-parse', 'origin/next')).toBe(newer);
  expect(run('show', 'origin/next:newer')).toBe('newer');
  expect(run('rev-parse', 'refs/heads/ticket')).toBe(ticket);
  expect(existsSync(join(root, 'executed'))).toBe(false);
});

it.skipIf(statSync(tmpdir()).dev === statSync(import.meta.dirname).dev)(
  'refreshes the run target when the repository and the temp dir are on different filesystems',
  () => {
    const { parent, record, run } = fixture(false, import.meta.dirname);
    writeFileSync(join(parent, 'newer'), 'newer');
    git(parent, 'checkout', '-q', '--detach', 'origin/next');
    git(parent, 'add', '.');
    git(parent, ...ident, 'commit', '-qm', 'newer target');
    git(parent, 'update-ref', 'refs/remotes/origin/next', 'HEAD');

    refreshRunTarget(record);

    expect(run('show', 'origin/next:newer')).toBe('newer');
  },
);

it('does not write the target ref through a symlinked refs directory', () => {
  const { root, parent, record } = fixture();
  git(parent, 'update-ref', 'refs/remotes/origin/next', 'refs/heads/main');
  const outside = join(root, 'outside');
  mkdirSync(outside);
  rmSync(join(record.gitDir, 'refs/remotes/origin'), { recursive: true });
  symlinkSync(outside, join(record.gitDir, 'refs/remotes/origin'));
  expect(() => refreshRunTarget(record)).toThrow();
  expect(existsSync(join(outside, 'next'))).toBe(false);
});

it('refuses a FIFO planted as an object or as the branch ref instead of waiting on it', () => {
  const { record, commit } = fixture();
  const tip = commit();
  mkdirSync(join(record.gitDir, 'objects/aa'), { recursive: true });
  execFileSync('mkfifo', [join(record.gitDir, 'objects/aa', 'b'.repeat(38))]);

  expect(() => transferIsolatedCommit(record, tip)).toThrow(
    /escaped its private store/,
  );

  const ref = join(record.gitDir, 'refs/heads/ticket');
  rmSync(ref);
  execFileSync('mkfifo', [ref]);
  expect(() => runCloneTip(record)).toThrow(/is not a file/);
});
