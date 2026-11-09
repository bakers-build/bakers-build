import { chmodSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Recursively re-add the owner-write bit to a directory tree.
 *
 * A bakers.build worktree is a Drupal install, and Drupal hardens `web/sites/default`
 * to `0555` and `settings.php` / `files/.htaccess` to `0444`. A directory
 * without its write bit cannot have its entries unlinked, so removing the
 * worktree (`git worktree remove --force` / `rm -rf`, however a tool does it)
 * gets EACCES. Restoring `u+w` on every dir/file first is what makes removal
 * succeed — this is not an ownership problem, only the permission bits.
 *
 * Best-effort per entry: a single un-chmod-able entry (already gone, foreign
 * owner) must not abort the walk. Symlinks are never followed — chmod would
 * touch the link target, which may live outside the tree.
 */
export function restoreWritable(path: string): void {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch {
    return; // gone / inaccessible — nothing to restore
  }
  if (stat.isSymbolicLink()) {
    return; // don't follow: the target lives elsewhere
  }
  try {
    // Add owner-write, preserving every other bit (read/execute stay intact so
    // a directory remains traversable and readable for the recursion below).
    chmodSync(path, stat.mode | 0o200);
  } catch {
    // best-effort: one un-chmod-able entry must not abort the walk
  }
  if (stat.isDirectory()) {
    let entries: string[];
    try {
      entries = readdirSync(path);
    } catch {
      return;
    }
    for (const entry of entries) {
      restoreWritable(join(path, entry));
    }
  }
}
