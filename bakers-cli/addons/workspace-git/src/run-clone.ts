import { existsSync, rmSync } from 'node:fs';
import type { WorktreeTeardown } from '@bakers-build/conductor/contract';
import {
  createRunClone,
  loadRunClone,
  type RunClone,
  type RunCloneOptions,
  removeRunClone,
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
