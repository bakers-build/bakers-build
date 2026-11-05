export interface EnsuredWorkspace {
  path: string;
  instructions: { path: string; sha256: string; text: string } | null;
  /**
   * Whether this call CREATED the worktree (true) or reused an existing one
   * (false). The core runs the `after_create` lifecycle hook on a fresh
   * worktree, or on a reused one with no recorded successful `after_create`
   * (BB-663), so it needs to know which happened. Lifecycle hooks themselves
   * are no longer a workspace concern (BB-84): the executor owns and runs
   * them best-effort.
   */
  created: boolean;
  /**
   * Variables the run needs from its workspace backend (e.g. Git config via
   * `GIT_CONFIG_COUNT`). The conductor adds them to the run env; core `BB_*`
   * keys still win.
   */
  env?: Record<string, string>;
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
   * Lifecycle-hook invocation is NOT a workspace responsibility
   * anymore — the executor owns all hooks (BB-84).
   */
  ensure(
    identifier: string,
    branch?: string,
    baseRef?: string,
  ): Promise<EnsuredWorkspace>;

  /**
   * Apply the workspace's "open" layout — for a hosted workspace, the startup
   * command(s) of the freshly created workspace's initial pane.
   *
   * OPTIONAL: a workspace with no layout concept (git, fake) simply omits it and
   * the conductor calls it with `?.`.
   *
   * BB-237 — why this is a SEPARATE call and not part of `ensure()`. The
   * layout's startup command typically names the bakers CLI, which the
   * `after_create` lifecycle hook builds. Applied inside `ensure()` it
   * necessarily ran BEFORE that hook, so in a self-hosting checkout the command
   * fired minutes before the binary it names existed. The only remedy available
   * to a config author was a cross-process handshake — a sentinel wait loop
   * inside the pane command itself. Splitting the call lets the conductor order
   * the two correctly (`after_create` → `applyOpenLayout`), which removes the
   * need for any handshake.
   *
   * The conductor calls this ONLY on a freshly created workspace
   * ({@link EnsuredWorkspace.created}), because only a fresh create has an
   * initial pane to lay out; re-applying on reuse would start a duplicate editor
   * process on every reattach. Deliberately a NARROWER gate than the one on
   * `after_create`, which runs again on a reuse with no recorded success
   * (BB-663), not on every dispatch.
   *
   * Best-effort by contract: implementations log and swallow a failing layout so
   * it can never wedge dispatch.
   */
  applyOpenLayout?(
    path: string,
    ctx: { identifier: string; branch: string; title: string },
  ): Promise<void>;
}
