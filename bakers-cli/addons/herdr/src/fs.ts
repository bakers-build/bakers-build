import { rmSync } from 'node:fs';
import { restoreWritable } from '@bakers-build/addon-workspace-git';

// The write-bit restore lives with the shared git teardown; re-exported here
// for herdr's own callers and `@bakers-build/addon-herdr/shared`.
export { restoreWritable };

/**
 * Remove a directory tree that may be hardened read-only by Drupal:
 * {@link restoreWritable} first, then `rm -rf`. Used where the conductor owns
 * the unlink; when herdr performs the removal, call {@link restoreWritable}
 * alone beforehand. A missing path is a no-op.
 */
export function forceRemoveDir(path: string): void {
  restoreWritable(path);
  rmSync(path, { recursive: true, force: true });
}
