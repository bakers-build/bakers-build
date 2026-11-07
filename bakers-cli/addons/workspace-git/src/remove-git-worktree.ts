import { existsSync, rmSync } from 'node:fs';
import type { WorktreeTeardown } from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { restoreWritable } from './fs.js';

/** Runs `git <args>` in `cwd`; resolves with stdout, rejects on non-zero exit. */
export type WorktreeGitExec = (args: string[], cwd: string) => Promise<string>;

function normPath(path: string): string {
  return path.replace(/\/+$/, '');
}

/**
 * The ticket worktrees of `git worktree list --porcelain` (record 0, the main
 * checkout, and `root` are never one). A `prunable` entry still carries its
 * `worktree <path>` line, so it parses too.
 */
function ticketWorktrees(
  output: string,
  root: string | undefined,
): { path: string; branch: string | null }[] {
  const entries: { path: string; branch: string | null }[] = [];
  for (const record of output.split(/\n\s*\n/)) {
    const path = record.match(/^worktree (.+)$/m)?.[1]?.trim();
    if (!path) continue;
    const branch =
      record
        .match(/^branch (.+)$/m)?.[1]
        ?.trim()
        .replace(/^refs\/heads\//, '') ?? null;
    entries.push({ path, branch });
  }
  return entries
    .slice(1)
    .filter((e) => !root || normPath(e.path) !== normPath(root));
}

/**
 * Tear down one ticket worktree with git alone — the shared teardown of every
 * workspace, and the fallback of a tool workspace whose tool lost track of it.
 *
 * It ASKS before acting (BB-293): git's registration and the directory on disk
 * can come apart, so both are read and each case is handled explicitly:
 *   - the main checkout → refused, `unverified`;
 *   - nothing resolves a path → `unverified` (absence can only be claimed about
 *     a worktree that was actually located — BB-141 RC-2);
 *   - neither registered nor on disk → `already_absent`;
 *   - registered but gone from disk → `git worktree prune` sweeps the admin
 *     entry → `removed`;
 *   - on disk → restore Drupal's write bits, `git worktree remove --force`
 *     (only when registered, else git exits 128 on a handled condition),
 *     `rm -rf`, `prune` → `removed`, or `unverified` when the directory cannot
 *     be reclaimed (a foreign-owned leftover) — reported, never thrown.
 *
 * `worktreePath` is the stable key and wins over the mutable `branch`. git runs
 * at `root` when given, else inside the worktree itself (the list is the same).
 */
export async function removeGitWorktree(
  root: string | undefined,
  branch: string,
  worktreePath: string | undefined,
  execGit: WorktreeGitExec,
  logger: ConductorLogger,
): Promise<WorktreeTeardown> {
  if (root && worktreePath && normPath(worktreePath) === normPath(root)) {
    logger.warn(
      { branch, worktreePath, root },
      'refusing to tear down the main checkout',
    );
    return 'unverified';
  }
  const prune = async (cwd: string) => {
    try {
      await execGit(['worktree', 'prune'], cwd);
    } catch {
      // best-effort — pruning is a sweep, never the teardown's success gate
    }
  };
  const cwd = root ?? worktreePath;
  let known: { path: string; branch: string | null }[] = [];
  if (cwd) {
    try {
      known = ticketWorktrees(
        await execGit(['worktree', 'list', '--porcelain'], cwd),
        root,
      );
    } catch {
      // Degrade to the on-disk answer below.
    }
  }
  const gitPath = worktreePath
    ? known.find((e) => normPath(e.path) === normPath(worktreePath))?.path
    : known.find((e) => e.branch === branch)?.path;
  const path = worktreePath ?? gitPath;
  if (!path) {
    if (root) await prune(root);
    return 'unverified';
  }
  const registered = gitPath !== undefined;
  const gitCwd = root ?? path;
  if (!existsSync(path)) {
    if (!registered) {
      logger.info(
        { branch, worktreePath: path },
        'worktree already absent — nothing to tear down',
      );
      return 'already_absent';
    }
    await prune(gitCwd);
    return 'removed';
  }
  // Drupal hardens web/sites/default (0555): restore owner-write first.
  restoreWritable(path);
  if (registered) {
    try {
      await execGit(['worktree', 'remove', '--force', path], gitCwd);
    } catch (err) {
      logger.warn(
        { path, err: String(err) },
        'git worktree remove failed on a registered worktree',
      );
    }
  }
  if (existsSync(path)) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch (err) {
      logger.warn(
        { path, err: String(err) },
        'worktree directory reclaim failed',
      );
      return 'unverified';
    }
  }
  await prune(gitCwd);
  return 'removed';
}
