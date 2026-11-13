import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConductorFileConfig } from '@bakers-build/conductor/contract';
import { loadRunClone } from '@bakers-build/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { GitWorkspace, gitWorkspace } from '../src/index.js';

let base: string;
let root: string;
let cacheHome: string | undefined;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const ident = ['-c', 'user.name=test', '-c', 'user.email=test@test'];

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'bakers-ws-clone-'));
  root = join(base, 'repo');
  mkdirSync(join(root, 'locked'), { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'WORKFLOW.md'), 'rules');
  writeFileSync(join(root, 'locked/settings.php'), 'one');
  git(root, 'add', '.');
  git(root, ...ident, 'commit', '-qm', 'base');
  git(root, 'update-ref', 'refs/remotes/origin/next', 'HEAD');
  cacheHome = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = join(base, 'cache');
});
afterEach(() => {
  if (cacheHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = cacheHome;
  rmSync(base, { recursive: true, force: true });
});

it('creates a run clone instead of a linked worktree and refreshes it on every ensure', async () => {
  const workspace = new GitWorkspace({ root, clone: true });

  const first = await workspace.ensure('GL-9', 'Title', 'origin/next');

  expect(first.created).toBe(true);
  expect(first.path).toBe(join(`${root}-worktrees`, 'GL-9'));
  expect(first.instructions?.text).toBe('rules');
  expect(readdirSync(join(first.path, '.git')).sort()).toEqual([
    'HEAD',
    'config',
    'objects',
    'refs',
  ]);
  expect(first.clone).toMatchObject({
    workspace: first.path,
    branch: 'bakers/GL-9-title',
    target: 'next',
    shared: false,
    expected: git(root, 'rev-parse', 'main'),
  });
  expect(git(root, 'worktree', 'list', '--porcelain')).not.toContain('GL-9');
  expect(git(root, 'rev-parse', 'bakers/GL-9-title')).toBe(
    git(root, 'rev-parse', 'main'),
  );

  writeFileSync(join(first.path, 'left-over'), 'uncommitted');
  const second = await workspace.ensure('GL-9', 'Title', 'origin/next');
  expect(second.created).toBe(false);
  expect(existsSync(join(second.path, 'left-over'))).toBe(false);
  expect(second.clone?.gitDir).toBe(first.clone?.gitDir);
});

it('keeps the ticket branch where it is when it already exists', async () => {
  git(root, 'checkout', '-qb', 'bakers/GL-9');
  writeFileSync(join(root, 'work'), 'done');
  git(root, 'add', '.');
  git(root, ...ident, 'commit', '-qm', 'work');
  const tip = git(root, 'rev-parse', 'HEAD');
  git(root, 'checkout', '-q', 'main');

  const ws = await new GitWorkspace({ root, clone: true }).ensure('GL-9');

  expect(ws.clone?.expected).toBe(tip);
  expect(readFileSync(join(ws.path, 'work'), 'utf8')).toBe('done');
});

it('borrows the parent objects with the shared option', async () => {
  const ws = await new GitWorkspace({ root, clone: true, shared: true }).ensure(
    'GL-9',
  );
  expect(ws.clone?.shared).toBe(true);
});

it('refreshes a tree the site hardened read-only', async () => {
  const workspace = new GitWorkspace({ root, clone: true });
  const first = await workspace.ensure('GL-9');
  chmodSync(join(first.path, 'locked/settings.php'), 0o444);
  chmodSync(join(first.path, 'locked'), 0o555);
  writeFileSync(join(root, 'locked/settings.php'), 'two');
  git(root, 'add', '.');
  git(root, ...ident, 'commit', '-qm', 'changed');
  git(root, 'branch', '-f', 'bakers/GL-9');

  const second = await workspace.ensure('GL-9');

  expect(readFileSync(join(second.path, 'locked/settings.php'), 'utf8')).toBe(
    'two',
  );
});

it('removes the clone directory and its Git directory', async () => {
  const workspace = new GitWorkspace({ root, clone: true });
  const ws = await workspace.ensure('GL-9');
  chmodSync(join(ws.path, 'locked'), 0o555);

  expect(await workspace.remove('bakers/GL-9', ws.path)).toBe('removed');

  expect(existsSync(ws.path)).toBe(false);
  expect(existsSync(ws.clone?.gitDir as string)).toBe(false);
  expect(loadRunClone(ws.path)).toBeUndefined();
  expect(await workspace.remove('bakers/GL-9', ws.path)).toBe('already_absent');
});

it('clones only under an isolating runtime', async () => {
  const config = (isolates: boolean) =>
    ({
      config_path: join(root, '.bakers/project.config.js'),
      runtime: { isolates },
    }) as unknown as ConductorFileConfig;
  mkdirSync(join(root, '.bakers'));
  const isolated = await gitWorkspace({ shared: true }).createWorkspace(
    config(true),
  );
  expect((await isolated.ensure('GL-1')).clone?.shared).toBe(true);
  const host = await gitWorkspace({ shared: true }).createWorkspace(
    config(false),
  );
  const ws = await host.ensure('GL-2');
  expect(ws.clone).toBeUndefined();
  expect(readFileSync(join(ws.path, '.git'), 'utf8')).toMatch(/^gitdir: /);
});
