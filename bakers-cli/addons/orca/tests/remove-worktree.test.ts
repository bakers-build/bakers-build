import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OrcaExecutor } from '../src/index.js';
import { executors, workspaces } from '../src/preset.js';
import { fakeOrca, notFound } from './fakes.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function world() {
  const root = mkdtempSync(join(tmpdir(), 'orca-rm-'));
  roots.push(root);
  const path = join(root, '.bakers-worktrees', 'feat/x');
  return { root, path };
}

function porcelain(root: string, ...worktrees: [string, string][]): string {
  return [
    `worktree ${root}\nbranch refs/heads/develop\n`,
    ...worktrees.map(([p, b]) => `worktree ${p}\nbranch refs/heads/${b}\n`),
  ].join('\n');
}

/** git fake: answers porcelain, records calls, optionally deletes on remove. */
function fakeGit(listing: () => string) {
  const calls: string[][] = [];
  const git = async (args: string[]) => {
    calls.push(args);
    if (args.includes('--porcelain')) return listing();
    if (args.includes('remove')) {
      rmSync(args[args.length - 1] as string, { recursive: true, force: true });
    }
    return '';
  };
  return { git, calls };
}

function executor(
  root: string,
  orca: ReturnType<typeof fakeOrca>['orca'],
  git: ReturnType<typeof fakeGit>['git'],
) {
  return new OrcaExecutor({ root }, orca, undefined, undefined, git);
}

describe('OrcaExecutor.removeWorktree', () => {
  it('refuses to tear down the main checkout', async () => {
    const { root } = world();
    const { orca, calls } = fakeOrca();
    const { git, calls: gitCalls } = fakeGit(() => porcelain(root));
    await expect(
      executor(root, orca, git).removeWorktree('develop', `${root}/`),
    ).resolves.toBe('unverified');
    expect(calls).toEqual([]);
    expect(gitCalls).toEqual([]);
  });

  it('removes a worktree Orca knows through orca worktree rm', async () => {
    const { root, path } = world();
    mkdirSync(path, { recursive: true });
    const { orca, calls } = fakeOrca({
      'worktree rm': () => {
        rmSync(path, { recursive: true, force: true });
        return { removed: true };
      },
    });
    const { git } = fakeGit(() => porcelain(root, [path, 'feat/x']));
    await expect(
      executor(root, orca, git).removeWorktree('feat/x', path),
    ).resolves.toBe('removed');
    expect(calls).toContainEqual([
      'worktree',
      'rm',
      '--worktree',
      `path:${path}`,
      '--force',
    ]);
  });

  it('reports unverified when the directory survives orca worktree rm', async () => {
    const { root, path } = world();
    mkdirSync(path, { recursive: true });
    const { orca } = fakeOrca();
    const { git } = fakeGit(() => porcelain(root, [path, 'feat/x']));
    await expect(
      executor(root, orca, git).removeWorktree('feat/x', path),
    ).resolves.toBe('unverified');
  });

  it('reports already_absent for a worktree neither Orca nor git knows', async () => {
    const { root, path } = world();
    const { orca } = fakeOrca({ 'worktree show': () => notFound() });
    const { git } = fakeGit(() => porcelain(root));
    await expect(
      executor(root, orca, git).removeWorktree('feat/x', path),
    ).resolves.toBe('already_absent');
  });

  it('falls back to git remove when Orca does not know an on-disk worktree', async () => {
    const { root, path } = world();
    mkdirSync(path, { recursive: true });
    const { orca, calls } = fakeOrca({ 'worktree show': () => notFound() });
    const { git, calls: gitCalls } = fakeGit(() =>
      porcelain(root, [path, 'feat/x']),
    );
    await expect(
      executor(root, orca, git).removeWorktree('feat/x', path),
    ).resolves.toBe('removed');
    expect(gitCalls).toContainEqual([
      '-C',
      root,
      'worktree',
      'remove',
      '--force',
      path,
    ]);
    expect(calls.some((c) => c[1] === 'rm')).toBe(false);
  });

  it('falls back to git when the Orca runtime is not reachable', async () => {
    const { root, path } = world();
    mkdirSync(path, { recursive: true });
    const { orca } = fakeOrca({
      status: () => ({ runtime: { reachable: false, state: 'not_running' } }),
    });
    const { git } = fakeGit(() => porcelain(root, [path, 'feat/x']));
    await expect(
      executor(root, orca, git).removeWorktree('feat/x', path),
    ).resolves.toBe('removed');
  });

  it('resolves the path by branch when none was persisted', async () => {
    const { root, path } = world();
    mkdirSync(path, { recursive: true });
    const { orca } = fakeOrca({ 'worktree show': () => notFound() });
    const { git } = fakeGit(() => porcelain(root, [path, 'feat/x']));
    await expect(
      executor(root, orca, git).removeWorktree('feat/x'),
    ).resolves.toBe('removed');
  });

  it('reports unverified when nothing resolves a path', async () => {
    const { root } = world();
    const { git } = fakeGit(() => porcelain(root));
    await expect(
      executor(root, fakeOrca().orca, git).removeWorktree('feat/x'),
    ).resolves.toBe('unverified');
  });
});

describe('preset', () => {
  it('contributes one orca executor and one orca workspace', () => {
    expect(executors?.([], {}).map((p) => p.id)).toEqual(['orca']);
    expect(workspaces?.([], {}).map((p) => p.id)).toEqual(['orca']);
  });
});
