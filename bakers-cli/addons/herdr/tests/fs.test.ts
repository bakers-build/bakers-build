import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { forceRemoveDir, restoreWritable } from '../src/fs.js';

/**
 * Build a temp worktree hardened exactly like a real Drupal install:
 * `web/sites/default` at 0555 and `settings.php` at 0444. Returns the root.
 */
function hardenedWorktree(): string {
  const root = mkdtempSync(join(tmpdir(), 'herdr-fs-'));
  const sitesDefault = join(root, 'web', 'sites', 'default');
  mkdirSync(sitesDefault, { recursive: true });
  const settings = join(sitesDefault, 'settings.php');
  writeFileSync(settings, '<?php // hardened');
  // Order matters: harden the file before its directory (0555 dir blocks chmod
  // of contained entries on some platforms).
  chmodSync(settings, 0o444);
  chmodSync(sitesDefault, 0o555);
  return root;
}

const created: string[] = [];
afterEach(() => {
  for (const p of created.splice(0)) {
    try {
      restoreWritable(p);
      rmSync(p, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

// root ignores permission bits (CI runs as root in docker), so the raw-rm
// EACCES only reproduces for a non-root user.
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe('forceRemoveDir', () => {
  it('removes a Drupal-hardened worktree that a raw rm cannot', () => {
    const root = hardenedWorktree();
    // A raw recursive remove hits EACCES on the read-only sites/default — this
    // is exactly the failure the conductor cleanup hit in production. Only
    // asserted for a non-root user (root bypasses the permission check).
    if (!isRoot) {
      expect(() => rmSync(root, { recursive: true })).toThrow();
      expect(existsSync(root)).toBe(true);
    }

    forceRemoveDir(root);
    expect(existsSync(root)).toBe(false);
  });

  it('is a no-op for a path that does not exist', () => {
    const missing = join(tmpdir(), 'herdr-fs-does-not-exist-xyz');
    expect(() => forceRemoveDir(missing)).not.toThrow();
  });
});

describe('restoreWritable', () => {
  it('re-adds owner-write recursively so a subsequent rm succeeds', () => {
    const root = hardenedWorktree();
    created.push(root);

    restoreWritable(root);
    // After restoring write bits a plain rm must now succeed.
    rmSync(root, { recursive: true });
    expect(existsSync(root)).toBe(false);
    created.splice(0); // already removed
  });

  it('does not follow symlinks out of the tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'herdr-fs-'));
    created.push(root);
    const outside = mkdtempSync(join(tmpdir(), 'herdr-fs-outside-'));
    created.push(outside);
    const outsideFile = join(outside, 'keep.txt');
    writeFileSync(outsideFile, 'keep');
    chmodSync(outsideFile, 0o444);
    // symlink inside the tree pointing at the outside file
    symlinkSync(outsideFile, join(root, 'link'));

    restoreWritable(root);
    // The outside file's perms must be untouched (symlink not followed).
    const mode = statSync(outsideFile).mode & 0o200;
    expect(mode).toBe(0);
  });
});
