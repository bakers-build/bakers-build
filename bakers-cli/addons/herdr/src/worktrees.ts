import { existsSync } from 'node:fs';
import {
  removeGitWorktree,
  removeRunCloneWorkspace,
  restoreWritable,
  type WorktreeGitExec,
} from '@bakers-build/addon-workspace-git';
import type { WorktreeTeardown } from '@bakers-build/conductor/contract';
import { type ConductorLogger, loadRunClone } from '@bakers-build/core';
import { type HerdrExec, isRecord, parseJson } from './pane-layout.js';
import { parseWorkspaceList } from './workspace-list.js';

export interface WorktreeEntry {
  /** herdr's reported git branch — null when the worktree HEAD is detached. */
  branch: string | null;
  path: string;
  open_workspace_id?: string;
}

export function parseWorktreeList(output: string): WorktreeEntry[] {
  const parsed = parseJson(output, 'worktree list');
  const worktrees = isRecord(parsed)
    ? (parsed.result as { worktrees?: unknown } | undefined)?.worktrees
    : undefined;
  if (!Array.isArray(worktrees)) {
    return [];
  }
  // Key on `path` only — herdr reports `branch: null` for a detached HEAD, and
  // the branch is mutable anyway (see resolveWorktreeEntry). Dropping such
  // entries is exactly the BB-114 defect: the worktree becomes invisible to
  // a path lookup.
  return worktrees
    .filter(isRecord)
    .filter((w) => typeof w.path === 'string')
    .map((w) => ({
      branch: typeof w.branch === 'string' ? w.branch : null,
      path: w.path as string,
      ...(typeof w.open_workspace_id === 'string' && w.open_workspace_id
        ? { open_workspace_id: w.open_workspace_id }
        : {}),
    }));
}

/** Normalise a worktree path for comparison (strip trailing slashes). */
export function normPath(path: string): string {
  return path.replace(/\/+$/, '');
}

/**
 * Resolve a worktree entry, preferring the stable `worktreePath` over `branch`.
 * The checked-out branch is mutable (the coding agent may rename/switch it), so
 * the path — deterministic and identifier-derived — is the reliable key. Fall
 * back to a branch match so a missing/renamed path still resolves. Returns null
 * only when neither key matches any listed worktree.
 */
export function resolveWorktreeEntry(
  entries: WorktreeEntry[],
  branch: string,
  worktreePath?: string,
): WorktreeEntry | null {
  if (worktreePath) {
    const want = normPath(worktreePath);
    const byPath = entries.find((e) => normPath(e.path) === want);
    if (byPath) {
      return byPath;
    }
  }
  return entries.find((e) => e.branch === branch) ?? null;
}

/**
 * List worktrees, ALWAYS anchored to the configured parent repo root
 * (BB-211). `herdr worktree list` is machine-global, but run WITHOUT
 * `--cwd` it resolves herdr's own ambient (previously selected / persisted /
 * process / shell / daemon) repository context. When a preceding
 * `bakers-cleanup-*` integration test selected then deleted a
 * `/tmp/bakers-cleanup-*` repo, that stale context survives and the unanchored
 * list exits (`cannot change to '/tmp/bakers-cleanup-…'`), aborting dispatch.
 * Anchoring every list with `--cwd root` makes listing independent of that
 * ambient context. This is the SINGLE choke point for all executor and
 * teardown `worktree list` call paths — {@link HerdrWorkspace.ensure} anchors
 * identically. The `--cwd` is only omitted when no root is configured
 * (rootless test callers).
 *
 * On a herdr failure it throws an error naming the explicit configured root
 * and the operation (AC-9) instead of surfacing herdr's raw stale-context
 * message, so a future context failure is diagnosable.
 */
export async function listWorktrees(
  execHerdr: HerdrExec,
  root: string | undefined,
): Promise<WorktreeEntry[]> {
  const args = ['worktree', 'list', ...(root ? ['--cwd', root] : []), '--json'];
  let output: string;
  try {
    output = await execHerdr(args);
  } catch (err) {
    throw new Error(
      `herdr worktree list failed for configured root ${
        root ?? '<unset>'
      }: ${String(err)}`,
    );
  }
  return parseWorktreeList(output);
}

/**
 * A run clone is no Git worktree on the host, so herdr lists none for it: its
 * plain workspace is found by its label, the ticket branch.
 */
export async function cloneWorkspaceId(
  execHerdr: HerdrExec,
  branch: string,
): Promise<string | null> {
  return (
    parseWorkspaceList(await execHerdr(['workspace', 'list'])).find(
      (workspace) => workspace.label === branch,
    )?.workspaceId ?? null
  );
}

/** The run clone's herdr workspace, created at `path` when none is open. */
export async function openCloneWorkspace(
  execHerdr: HerdrExec,
  branch: string,
  path: string,
): Promise<string> {
  const open = await cloneWorkspaceId(execHerdr, branch);
  if (open) return open;
  const output = await execHerdr([
    'workspace',
    'create',
    '--cwd',
    path,
    '--label',
    branch,
    '--no-focus',
  ]);
  let created: unknown;
  try {
    const parsed = parseJson(output, 'workspace create');
    created = isRecord(parsed)
      ? (parsed.result as { workspace?: { workspace_id?: unknown } })?.workspace
          ?.workspace_id
      : undefined;
  } catch {
    // Not JSON: fall back to the list below.
  }
  const id =
    typeof created === 'string' && created
      ? created
      : await cloneWorkspaceId(execHerdr, branch);
  if (!id)
    throw new Error(
      `herdr workspace create did not yield a workspace for ${path} (branch ${branch}): ${output.trim()}`,
    );
  return id;
}

/** What the herdr worktree teardown needs. */
export interface HerdrTeardownDeps {
  /** The parent repo root; absent only for rootless test callers. */
  root?: string;
  execHerdr: HerdrExec;
  runGit: WorktreeGitExec;
  logger: ConductorLogger;
}

/**
 * BB-166 focus guard. herdr's `worktree remove` deletes the ticket
 * worktree's on-disk directory; if that workspace is the CURRENTLY FOCUSED
 * one, the interactive client is left in a now-deleted `cwd` and herdr spawns
 * a stray empty workspace for the dead path. So before the remove, if the
 * target workspace is focused, switch focus to the main-checkout (non-linked)
 * workspace of the SAME repo. A background reap of a non-focused worktree
 * (or one herdr no longer lists) focuses nothing.
 *
 * Returns whether it is SAFE to proceed with the remove: `false` when a
 * required focus switch cannot be resolved or verified — the caller then
 * aborts (returns `unverified`) so the reaper retries later, rather than
 * deleting the focused path out from under the user.
 */
async function ensureFocusSafeToRemove(
  deps: HerdrTeardownDeps,
  workspaceId: string,
): Promise<boolean> {
  const workspaces = parseWorkspaceList(
    await deps.execHerdr(['workspace', 'list']),
  );
  const target = workspaces.find((w) => w.workspaceId === workspaceId);
  // Not focused (or not listed) → removing it strands no client.
  if (!target?.focused) {
    return true;
  }
  // Focused: resolve the main-checkout workspace for the SAME repo — the
  // non-linked workspace whose repo_root matches the target's (falling back
  // to the configured parent root when herdr reports no repo_root).
  const anchor = target.repoRoot ?? deps.root ?? null;
  const parent =
    anchor === null
      ? undefined
      : workspaces.find(
          (w) =>
            w.workspaceId !== workspaceId &&
            !w.isLinkedWorktree &&
            w.repoRoot !== null &&
            normPath(w.repoRoot) === normPath(anchor),
        );
  // No safe target → do NOT delete the focused path; retry later.
  if (!parent) {
    return false;
  }
  try {
    await deps.execHerdr(['workspace', 'focus', parent.workspaceId]);
  } catch {
    return false;
  }
  // Verify the switch actually took before deleting the (was-focused) dir.
  const after = parseWorkspaceList(await deps.execHerdr(['workspace', 'list']));
  const parentNow = after.find((w) => w.workspaceId === parent.workspaceId);
  const targetNow = after.find((w) => w.workspaceId === workspaceId);
  return parentNow?.focused === true && targetNow?.focused !== true;
}

/**
 * Tear down a ticket's entire worktree (git worktree + hosted workspace).
 * `herdr worktree remove` is keyed by an open workspace id, so resolve the
 * worktree first — by its stable `worktreePath`, falling back to `branch`
 * (see {@link resolveWorktreeEntry}): if its workspace is already open use
 * that id; otherwise open the on-disk worktree to obtain one.
 *
 * `herdr worktree list` is machine-global — it enumerates every repo's
 * worktrees on the host, most of which are not ours. So a no-match does NOT
 * mean "error"; it means herdr no longer tracks this ticket's worktree. Then
 * the teardown is git's alone: {@link removeGitWorktree} asks before acting
 * (BB-293) and removes git-awarely, so no `.git/worktrees/<name>` metadata is
 * orphaned (BB-141 RC-1).
 *
 * Reports what the teardown DID (BB-293): `removed`, `already_absent`, or
 * `unverified` when nothing was resolvable, the directory survived, or a
 * focus switch could not be made safely — the reaper then retries.
 */
export async function removeHerdrWorktree(
  deps: HerdrTeardownDeps,
  branch: string,
  worktreePath?: string,
): Promise<WorktreeTeardown> {
  const { root, execHerdr, logger } = deps;
  // BB-468 / BB-228: a ticket whose recorded `worktreePath` IS the configured
  // parent-repo root is refused before either branch below is reached — the
  // herdr-tracked path would retry `not_linked_worktree` forever, and the git
  // path would reclaim the MAIN CHECKOUT.
  if (root && worktreePath && normPath(worktreePath) === normPath(root)) {
    logger.warn(
      { branch, worktreePath, root },
      'refusing to tear down the main checkout',
    );
    return 'unverified';
  }
  if (worktreePath && loadRunClone(worktreePath)) {
    const open = await cloneWorkspaceId(execHerdr, branch);
    if (open) {
      if (!(await ensureFocusSafeToRemove(deps, open))) return 'unverified';
      await execHerdr(['workspace', 'close', open]);
    }
    return removeRunCloneWorkspace(worktreePath) ?? 'unverified';
  }
  const entry = resolveWorktreeEntry(
    await listWorktrees(execHerdr, root),
    branch,
    worktreePath,
  );
  if (!entry) {
    // herdr no longer tracks it. herdr still tracking the worktree is itself
    // evidence that something is there to release, which is why the git probe
    // governs only this lost-track path.
    return removeGitWorktree(root, branch, worktreePath, deps.runGit, logger);
  }
  let workspaceId = entry.open_workspace_id ?? null;
  if (!workspaceId) {
    // Reattach from the PARENT repo root, never the linked worktree itself:
    // herdr rejects an open whose --cwd is a linked worktree with
    // `linked_worktree_source` ("New and open actions start from the repo
    // parent workspace"), which then yields no workspace id and the remove
    // never runs. Fall back to the linked path only when no root is
    // configured (keeps the old behaviour for rootless test callers).
    await execHerdr([
      'worktree',
      'open',
      '--cwd',
      root ?? entry.path,
      '--branch',
      // entry.branch is null for a detached HEAD; fall back to the ticket
      // branch so `open` still gets a branch arg.
      entry.branch ?? branch,
      '--no-focus',
      '--json',
    ]);
    // Re-resolve by the same keys — open flips the entry's workspace id.
    const reopened = resolveWorktreeEntry(
      await listWorktrees(execHerdr, root),
      branch,
      worktreePath,
    );
    workspaceId = reopened?.open_workspace_id ?? null;
    if (!workspaceId) {
      throw new Error(
        `herdr worktree open did not yield a workspace id for path ${entry.path} (branch ${entry.branch})`,
      );
    }
  }
  // BB-166: before deleting the worktree's directory, if its workspace is
  // the focused one, move focus to the main checkout — else the client is
  // stranded in a deleted cwd. If a needed focus switch can't be made safely,
  // abort UNVERIFIED so the reaper retries rather than stranding the user.
  if (!(await ensureFocusSafeToRemove(deps, workspaceId))) {
    return 'unverified';
  }
  // Drupal hardens web/sites/default (0555) and settings.php/.htaccess (0444);
  // herdr's remove performs the actual unlink and would hit EACCES on those
  // read-only dirs. Restore owner-write on the on-disk worktree first.
  restoreWritable(entry.path);
  await execHerdr([
    'worktree',
    'remove',
    '--workspace',
    workspaceId,
    '--force',
    '--json',
  ]);
  // BB-166: verify the directory is actually gone on disk. If it survived,
  // report the teardown UNVERIFIED so the reaper retries instead of falsely
  // flagging the ticket cleaned.
  if (existsSync(entry.path)) {
    return 'unverified';
  }
  // Sweep any orphaned `.git/worktrees/<name>` admin entries at the parent
  // root (this teardown's and any pre-existing prunable ones — BB-141).
  if (root) {
    try {
      await deps.runGit(['worktree', 'prune'], root);
    } catch {
      // best-effort — pruning is a sweep, never the teardown's success gate
    }
  }
  return 'removed';
}
