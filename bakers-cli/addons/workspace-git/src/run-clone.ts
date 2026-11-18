import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { WorktreeTeardown } from '@bakers-build/conductor/contract';
import {
  createRunClone,
  loadRunClone,
  type RunClone,
  type RunCloneOptions,
  registerRunCloneWorktree,
  removeRunClone,
  saveRunClone,
  transferIsolatedCommit,
} from '@bakers-build/core';
import { restoreWritable } from './fs.js';

/**
 * {@link createRunClone}, once more after restoring owner-write when the first
 * refresh fails: a site may have hardened directories it must rewrite.
 */
export function ensureRunClone(options: RunCloneOptions): RunClone {
  try {
    return createRunClone(options);
  } catch (err) {
    if (!existsSync(options.workspace)) throw err;
    restoreWritable(options.workspace);
    return createRunClone(options);
  }
}

/** `origin/<branch>` → `<branch>`: the ref a run clone carries as its target. */
export const targetOf = (baseRef: string | undefined) =>
  baseRef?.replace(/^origin\//, '');

/**
 * Remove a run clone's directory and Git directory. `undefined` when
 * `worktreePath` is no run clone, so the caller tears down a linked worktree.
 */
export function removeRunCloneWorkspace(
  worktreePath: string | undefined,
): WorktreeTeardown | undefined {
  if (!worktreePath || !loadRunClone(worktreePath)) return undefined;
  restoreWritable(worktreePath);
  rmSync(worktreePath, { recursive: true, force: true });
  if (existsSync(worktreePath)) return 'unverified';
  removeRunClone(worktreePath);
  return 'removed';
}

/**
 * Leave a run clone for a run that does not isolate: bring its commits to the
 * ticket branch, refuse uncommitted work, then remove the clone so the caller
 * adds a linked worktree at the same path. No-op when `workspace` is no clone.
 */
export function leaveRunClone(workspace: string): void {
  const record = loadRunClone(workspace);
  if (!record) return;
  const tip = transferIsolatedCommit(record);
  saveRunClone({ ...record, expected: tip });
  // Registered, host Git reads the work tree with the host's overrides, never the run's config.
  registerRunCloneWorktree({ ...record, expected: tip });
  const changes = execFileSync(
    'git',
    ['--git-dir', join(workspace, '.git'), 'status', '--porcelain'],
    { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
  if (changes)
    throw new Error(
      `run clone: ${workspace} has uncommitted work; commit or remove it, then dispatch again`,
    );
  if (removeRunCloneWorkspace(workspace) !== 'removed')
    throw new Error(`run clone: ${workspace} could not be removed`);
}
