import type { RunClone } from '@bakers-build/core';
import type { WorktreeTeardown } from './executor.js';

export interface EnsuredWorkspace {
  path: string;
  instructions: { path: string; sha256: string; text: string } | null;
  /**
   * Whether this call CREATED the worktree (true) or reused an existing one
   * (false). The core runs the `after_create` lifecycle hook on a fresh
   * worktree, or on a reused one with no recorded successful `after_create`
   * (BB-663), so it needs to know which happened. Lifecycle hooks themselves
   * are not a workspace concern: the conductor runs them best-effort.
   */
  created: boolean;
  /**
   * Variables the run needs from its workspace backend (e.g. Git config via
   * `GIT_CONFIG_COUNT`). The conductor adds them to the run env; core `BAKERS_*`
   * keys still win.
   */
  env?: Record<string, string>;
  /**
   * Set when the workspace is a fresh clone for an isolated run instead of a
   * linked worktree: its Git directory lies outside `path`, which has no
   * `.git` on the host.
   */
  clone?: RunClone;
}

export interface BbWorkspace {
  /**
   * Ensure a per-ticket worktree exists. `branch`, when given, is the branch
   * name the dispatcher computed for the ticket. The git plugin treats it as a
   * readable title to slug into its branch template; the herdr plugin uses it
   * verbatim as the worktree branch. The worktree directory key/path stays
   * identifier- or branch-derived so reuse is stable across runs.
   *
   * `baseRef`, when given, overrides the base the new branch is created from
   * (e.g. `origin/<base_branch>` so a sub-ticket stacks on its parent); if it
   * does not resolve on the remote the implementation falls back to its default
   * base — never a hard error.
   *
   * Reports `created` so the caller can decide whether `after_create` needs to
   * run (fresh worktree, or no recorded success for this one — BB-663).
   * Lifecycle-hook invocation is NOT a workspace responsibility — the
   * conductor runs all hooks.
   */
  ensure(
    identifier: string,
    branch?: string,
    baseRef?: string,
  ): Promise<EnsuredWorkspace>;

  /**
   * Tear down the branch's worktree, reclaiming its disk. Called by the
   * conductor's ticket-cleanup pass once a ticket is done, after `after_done`,
   * for every workspace and executor kind.
   *
   * `worktreePath` is the stable, identifier-derived worktree path (from the
   * ticket's latest run). Prefer it over `branch` to resolve the worktree: the
   * checked-out branch is mutable (the coding agent may rename/switch it), the
   * path is not.
   *
   * Reports what the teardown DID as a {@link WorktreeTeardown} (BB-293):
   * `removed` when the worktree was present on this host and torn down (or its
   * prunable admin entry swept), `already_absent` when there was nothing to
   * tear down at all, and `unverified` when nothing matched here and the
   * worktree may still be on disk (another conductor's host, or a path that
   * could not be resolved). The reaper flags a ticket `cleaned_up` for the
   * first two and leaves it on the work list for `unverified`, so it never
   * false-teardowns a worktree another host physically holds. A genuine
   * failure still throws (surfaced as a teardown miss).
   */
  remove(branch: string, worktreePath?: string): Promise<WorktreeTeardown>;
}
