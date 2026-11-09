import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitWorkspace, removeGitWorktree } from '../src/index.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    const parent = join(r, '.bakers-worktrees');
    if (existsSync(parent)) chmodSync(parent, 0o755);
    rmSync(r, { recursive: true, force: true });
  }
});

function world() {
  const root = mkdtempSync(join(tmpdir(), 'git-rm-'));
  roots.push(root);
  return { root, path: join(root, '.bakers-worktrees', 'feat-x') };
}

function porcelain(root: string, ...worktrees: [string, string][]): string {
  return [
    `worktree ${root}\nbranch refs/heads/develop\n`,
    ...worktrees.map(([p, b]) => `worktree ${p}\nbranch refs/heads/${b}\n`),
  ].join('\n');
}

type Call = { args: string[]; cwd: string };

/** git fake: answers porcelain, records (args, cwd), deletes on remove. */
function fakeGit(listing: () => string) {
  const calls: Call[] = [];
  const git = async (args: string[], cwd: string) => {
    calls.push({ args, cwd });
    if (args.includes('--porcelain')) return listing();
    if (args[1] === 'remove') {
      rmSync(args[args.length - 1] as string, { recursive: true, force: true });
    }
    return '';
  };
  return { git, calls };
}

function spyLogger() {
  const lines: { level: string; msg?: string }[] = [];
  const at =
    (level: string) =>
    (_obj: object, msg?: string): void => {
      lines.push({ level, msg });
    };
  return {
    lines,
    logger: {
      debug: at('debug'),
      info: at('info'),
      warn: at('warn'),
      error: at('error'),
    },
  };
}

describe('removeGitWorktree', () => {
  it('refuses the main checkout and touches nothing', async () => {
    const { root } = world();
    const { git, calls } = fakeGit(() => porcelain(root));
    const { logger, lines } = spyLogger();
    await expect(
      removeGitWorktree(root, 'develop', `${root}/`, git, logger),
    ).resolves.toBe('unverified');
    expect(calls).toEqual([]);
    expect(existsSync(root)).toBe(true);
    expect(lines).toContainEqual({
      level: 'warn',
      msg: 'refusing to tear down the main checkout',
    });
  });

  it('reports already_absent when the worktree is neither registered nor on disk', async () => {
    const { root, path } = world();
    const { git, calls } = fakeGit(() => porcelain(root));
    await expect(
      removeGitWorktree(root, 'feat/x', path, git, spyLogger().logger),
    ).resolves.toBe('already_absent');
    // Asking git to remove a worktree it does not know is the bogus
    // `exec failed` the BB-293 probe exists to avoid.
    expect(calls.some((c) => c.args[1] === 'remove')).toBe(false);
  });

  it('sweeps a prunable admin entry whose directory is gone', async () => {
    const { root, path } = world();
    const { git, calls } = fakeGit(() => porcelain(root, [path, 'feat/x']));
    await expect(
      removeGitWorktree(root, 'feat/x', path, git, spyLogger().logger),
    ).resolves.toBe('removed');
    expect(calls.map((c) => c.args)).toContainEqual(['worktree', 'prune']);
    expect(calls.some((c) => c.args[1] === 'remove')).toBe(false);
  });

  it('removes a registered on-disk worktree: write bits, git remove, prune', async () => {
    const { root, path } = world();
    // Drupal hardens sites/default to 0555: the unlink needs owner-write back.
    const hardened = join(path, 'web', 'sites', 'default');
    mkdirSync(hardened, { recursive: true });
    writeFileSync(join(hardened, 'settings.php'), '<?php');
    chmodSync(hardened, 0o555);
    const { git, calls } = fakeGit(() => porcelain(root, [path, 'feat/x']));
    await expect(
      removeGitWorktree(root, 'feat/x', path, git, spyLogger().logger),
    ).resolves.toBe('removed');
    expect(existsSync(path)).toBe(false);
    expect(calls.slice(1)).toEqual([
      { args: ['worktree', 'remove', '--force', path], cwd: root },
      { args: ['worktree', 'prune'], cwd: root },
    ]);
  });

  it('reclaims an on-disk directory git does not know without asking git to remove it', async () => {
    const { root, path } = world();
    mkdirSync(path, { recursive: true });
    const { git, calls } = fakeGit(() => porcelain(root));
    await expect(
      removeGitWorktree(root, 'feat/x', path, git, spyLogger().logger),
    ).resolves.toBe('removed');
    expect(existsSync(path)).toBe(false);
    expect(calls.some((c) => c.args[1] === 'remove')).toBe(false);
  });

  it('resolves the path by branch when none was persisted, never the main checkout', async () => {
    const { root, path } = world();
    mkdirSync(path, { recursive: true });
    const { git } = fakeGit(() => porcelain(root, [path, 'feat/x']));
    await expect(
      removeGitWorktree(root, 'feat/x', undefined, git, spyLogger().logger),
    ).resolves.toBe('removed');
    expect(existsSync(path)).toBe(false);
    await expect(
      removeGitWorktree(root, 'develop', undefined, git, spyLogger().logger),
    ).resolves.toBe('unverified');
    expect(existsSync(root)).toBe(true);
  });

  it('reports unverified when nothing resolves a path', async () => {
    const { root } = world();
    const { git } = fakeGit(() => porcelain(root));
    await expect(
      removeGitWorktree(root, 'feat/x', undefined, git, spyLogger().logger),
    ).resolves.toBe('unverified');
  });

  // Root ignores the write bits that make the unlink fail, as in the herdr case.
  it.skipIf(process.getuid?.() === 0)(
    'reports unverified, not a throw, when the directory cannot be reclaimed',
    async () => {
      const { root, path } = world();
      mkdirSync(path, { recursive: true });
      const { logger, lines } = spyLogger();
      // A parent we may not write: rm fails like a foreign-owned leftover.
      chmodSync(dirname(path), 0o555);
      const git = async (args: string[]) =>
        args.includes('--porcelain') ? porcelain(root) : '';
      await expect(
        removeGitWorktree(undefined, 'feat/x', path, git, logger),
      ).resolves.toBe('unverified');
      expect(lines).toContainEqual({
        level: 'warn',
        msg: 'worktree directory reclaim failed',
      });
    },
  );
});

describe('GitWorkspace.remove', () => {
  it('tears down the ticket worktree it created, by its path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bakers-ws-'));
    roots.push(root);
    const path = join(`${root}-worktrees`, 'GL-9');
    mkdirSync(path, { recursive: true });
    roots.push(`${root}-worktrees`);
    const git: string[][] = [];
    const manager = new GitWorkspace({
      root,
      runGit: async (args) => {
        git.push(args);
        if (args.includes('--porcelain')) {
          return porcelain(root, [path, 'bakers/GL-9']);
        }
        if (args.includes('remove')) {
          rmSync(path, { recursive: true, force: true });
        }
        return '';
      },
    });

    await expect(manager.remove('bakers/GL-9', path)).resolves.toBe('removed');

    expect(git).toContainEqual([
      '-C',
      root,
      'worktree',
      'remove',
      '--force',
      path,
    ]);
    expect(existsSync(path)).toBe(false);
  });
});
