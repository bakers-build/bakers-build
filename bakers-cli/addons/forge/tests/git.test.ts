import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchBranches, localSha, pushBranch } from '../src/git.js';
import { git, gitFixture, markerRan } from './git-fixture.js';

const authOf = (remote: string) => ({
  url: `file://${remote}`,
  header: 'Authorization: Basic dG9rLVNFQ1JFVC0xMjM=',
});

describe('isolated git', () => {
  it('fetches the named branches into refs/remotes/origin, no tags, and skips missing ones', async () => {
    const f = gitFixture();
    const before = git(f.root, '--git-dir', f.remote, 'for-each-ref');
    const refs = await fetchBranches(f.clone, authOf(f.remote), [
      'next',
      'feat/bb-1-parent',
      'feat/bb-7-work',
    ]);
    expect(refs).toEqual([
      { name: 'next', sha: f.remoteSha('next') },
      { name: 'feat/bb-1-parent', sha: f.remoteSha('feat/bb-1-parent') },
    ]);
    expect(git(f.clone, 'rev-parse', 'origin/feat/bb-1-parent')).toBe(
      f.remoteSha('feat/bb-1-parent'),
    );
    expect(git(f.clone, 'tag')).toBe('');
    expect(git(f.root, '--git-dir', f.remote, 'for-each-ref')).toBe(before);
    expect(markerRan(f)).toBe(false);
  });

  it('pushes to the configured remote only; planted hooks, pushurl, insteadOf and sshCommand never act', async () => {
    const f = gitFixture();
    const sha = await pushBranch(f.clone, authOf(f.remote), 'feat/bb-7-work', {});
    expect(sha).toBe(await localSha(f.clone, 'feat/bb-7-work'));
    expect(f.remoteSha('feat/bb-7-work')).toBe(sha);
    expect(git(f.root, '--git-dir', f.evil, 'for-each-ref')).toBe('');
    expect(git(f.clone, 'rev-parse', 'origin/feat/bb-7-work')).toBe(sha);
    expect(markerRan(f)).toBe(false);
    // The token never lands in the clone's config.
    expect(readFileSync(join(f.clone, '.git', 'config'), 'utf8')).not.toContain(
      'dG9rLVNFQ1JFVC0xMjM',
    );
  });

  it('pushes from a linked worktree into the shared object store', async () => {
    const f = gitFixture();
    const sha = f.commit(f.worktree, 'variant');
    await pushBranch(f.worktree, authOf(f.remote), 'feat/bb-7-work-2', {});
    expect(f.remoteSha('feat/bb-7-work-2')).toBe(sha);
    expect(markerRan(f)).toBe(false);
  });

  it('refuses a non-fast-forward without lease and with a stale lease; a correct lease rewrites', async () => {
    const f = gitFixture();
    const auth = authOf(f.remote);
    const first = await pushBranch(f.clone, auth, 'feat/bb-7-work', {});
    git(f.clone, 'commit', '-q', '--amend', '-m', 'rewritten');
    await expect(pushBranch(f.clone, auth, 'feat/bb-7-work', {})).rejects.toThrow();
    await expect(
      pushBranch(f.clone, auth, 'feat/bb-7-work', {
        forceWithLease: true,
        expectedSha: '0'.repeat(40),
      }),
    ).rejects.toThrow();
    const rewritten = await pushBranch(f.clone, auth, 'feat/bb-7-work', {
      forceWithLease: true,
    });
    expect(rewritten).not.toBe(first);
    expect(f.remoteSha('feat/bb-7-work')).toBe(rewritten);
  });

  it('a lease without a remote-tracking ref requires the branch to be absent remotely', async () => {
    const f = gitFixture();
    git(f.root, '--git-dir', f.remote, 'update-ref', 'refs/heads/feat/bb-7-work', f.remoteSha('next')!);
    await expect(
      pushBranch(f.clone, authOf(f.remote), 'feat/bb-7-work', { forceWithLease: true }),
    ).rejects.toThrow();
  });

  it('fails for a branch the clone does not have', async () => {
    const f = gitFixture();
    await expect(pushBranch(f.clone, authOf(f.remote), 'feat/bb-7-work-9', {})).rejects.toThrow(
      /no local branch 'feat\/bb-7-work-9'/,
    );
  });
});
