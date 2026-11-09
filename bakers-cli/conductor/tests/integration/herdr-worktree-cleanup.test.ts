/**
 * Layer 3 (ground truth) regression for the two worktree-cleanup defects
 * (ticket bakers-b53f5f89). Unlike the deterministic Layer 1/2 unit tests
 * (addons/herdr/tests/{executor,fs}.test.ts), this drives the REAL `herdr`
 * binary + a REAL git worktree hardened exactly like a Drupal install.
 *
 * It runs wherever a `herdr` binary is on PATH and skips cleanly otherwise —
 * no `HERDR_ENV` needed (BB-229). The daemon it drives is its OWN: a private
 * `herdr server` with its own socket and state directory, started by
 * `../helpers/herdr-test-server.ts`. The invariant that gate change relies on:
 * no call in this file can reach the developer's daemon, so the throwaway
 * `bakers-cleanup-*` repo below can never surface as a stale workspace in the
 * user's herdr UI.
 *
 * It reproduces both defects at once:
 *   Bug A — the run's workspace is closed (open_workspace_id = null), so the
 *           reattach `worktree open` must start from the PARENT repo root; the
 *           old code passed the linked worktree path and herdr rejected it with
 *           `linked_worktree_source`.
 *   Bug B — web/sites/default is 0555 and settings.php 0444, so the removal
 *           unlink hits EACCES unless write perms are restored first.
 * Both are confirmed live above; this asserts the fixed teardown (HerdrWorkspace.remove) fully
 * tears the worktree down where the pre-fix code left it on disk.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { HerdrWorkspace } from '@bakers-build/addon-herdr';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  herdrAvailable,
  type IsolatedHerdr,
  startIsolatedHerdr,
} from '../helpers/herdr-test-server.js';

const HAS_HERDR = herdrAvailable();

let server: IsolatedHerdr;

/** Every `herdr` call goes to the private daemon, never the developer's. */
function herdr(args: string[]): string {
  return server.herdr(args);
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

const BRANCH = 'bakers/cleanup-regression';

describe.skipIf(!HAS_HERDR)('HerdrWorkspace.remove (real herdr + git)', () => {
  let repo: string;
  let worktreePath: string;

  beforeAll(async () => {
    // FIRST — before any repo exists, so no `herdr … --cwd <tmp>` can precede
    // the isolation and select the throwaway repo in the developer's daemon.
    server = await startIsolatedHerdr();

    repo = mkdtempSync(join(tmpdir(), 'bakers-cleanup-'));
    // `afterAll` removes it on the normal path; this covers the hard exits
    // (Ctrl-C, uncaught throw) where `afterAll` never runs.
    server.alsoRemove(repo);
    git(repo, ['init', '-q']);
    git(repo, ['config', 'user.email', 'test@example.com']);
    git(repo, ['config', 'user.name', 'test']);
    await mkdir(join(repo, 'web', 'sites', 'default'), { recursive: true });
    await writeFile(
      join(repo, 'web', 'sites', 'default', 'settings.php'),
      '<?php\n',
    );
    await writeFile(join(repo, 'README.md'), 'x\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-qm', 'init']);

    // Create the linked worktree + herdr workspace (mirrors HerdrWorkspace).
    const created = JSON.parse(
      herdr([
        'worktree',
        'create',
        '--cwd',
        repo,
        '--branch',
        BRANCH,
        // ABSOLUTE, exactly as HerdrWorkspace passes it (workspace.ts): herdr
        // canonicalizes a relative `--path` against its OWN `current_dir()`,
        // not against `--cwd`. Relative, this materialised the worktree inside
        // the bakers checkout that happens to be vitest's cwd instead of inside
        // the throwaway repo — so a run that failed before `remove`
        // left it behind and the NEXT run died in `beforeAll` with
        // `worktree_create_failed … already exists`.
        '--path',
        resolve(repo, '.bakers-worktrees', BRANCH),
        '--label',
        'cleanup-regression',
        '--no-focus',
        '--json',
      ]),
    );
    worktreePath = created.result.worktree.path as string;

    // The throwaway repo must be genuinely self-contained: everything this file
    // creates has to sit under `repo`, so `afterAll` can unlink all of it and
    // the next run starts from nothing. Fails loudly if `--path` ever goes back
    // to being relative (herdr would resolve it against vitest's cwd — i.e.
    // inside the bakers checkout — and a red run would then block every run after
    // it).
    expect(resolve(worktreePath).startsWith(resolve(repo) + sep)).toBe(true);

    const workspaceId = created.result.worktree.open_workspace_id as string;

    // Reproduce the released state: close the workspace so the worktree's
    // open_workspace_id becomes null (the reattach path → Bug A).
    herdr(['workspace', 'close', workspaceId]);

    // Harden like Drupal: read-only sites/default (Bug B).
    chmodSync(
      join(worktreePath, 'web', 'sites', 'default', 'settings.php'),
      0o444,
    );
    chmodSync(join(worktreePath, 'web', 'sites', 'default'), 0o555);
  });

  afterAll(async () => {
    // Best-effort cleanup in case the assertions failed mid-way. The worktree
    // is removed EXPLICITLY, not just left to `rmSync(repo)`: a run that fails
    // before `remove` must not leave it on disk, or the next run cannot
    // even reach an assertion (`worktree create` refuses an existing path).
    try {
      if (worktreePath && existsSync(worktreePath)) {
        execFileSync('chmod', ['-R', 'u+w', worktreePath]);
        rmSync(worktreePath, { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }
    try {
      if (repo) {
        git(repo, ['worktree', 'prune']);
        rmSync(repo, { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }
    // BB-211 / BB-229: the re-anchor workaround that used to live here is
    // gone. It existed because every `herdr … --cwd repo` above re-selected the
    // now-deleted `bakers-cleanup-*` repo as the SHARED daemon's ambient context,
    // and a stale context breaks a later unanchored `worktree list` (BB-211).
    // With a private daemon there is no shared context to protect: the only
    // daemon that ever saw this repo is the one whose entire state directory is
    // unlinked on the next line. Guarded: a `beforeAll` that failed inside
    // `startIsolatedHerdr` never assigned `server` (it cleans up after itself).
    if (server) await server.stop();
  });

  it('tears down a closed, Drupal-hardened worktree (Bug A + Bug B)', async () => {
    const workspace = new HerdrWorkspace({ root: repo });

    // Must not throw: the fix reattaches from the parent root (no
    // linked_worktree_source) and restores write perms before the unlink.
    // Returns 'removed' — the worktree was present on this host and torn down.
    await expect(workspace.remove(BRANCH, worktreePath)).resolves.toBe(
      'removed',
    );

    // Directory gone on disk.
    expect(existsSync(worktreePath)).toBe(false);

    // herdr no longer lists the branch.
    const list = JSON.parse(
      herdr(['worktree', 'list', '--cwd', repo, '--json']),
    );
    const branches = (list.result.worktrees as Array<{ branch: string }>).map(
      (w) => w.branch,
    );
    expect(branches).not.toContain(BRANCH);

    // git worktree metadata pruned (only the main repo remains).
    const gitList = git(repo, ['worktree', 'list']);
    expect(gitList).not.toContain(join('.bakers-worktrees', BRANCH));
  });
});
