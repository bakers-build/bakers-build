import type { Ticket } from './remote.js';

export interface SpawnedSession {
  sessionRef: string;
}

export interface ExecutorCapabilities {
  persistent: boolean;
}

export interface SpawnRunInput {
  ticket: {
    uuid: string;
    identifier: string;
    title: string;
    branchName: string;
    state: string;
    url?: string;
  };
  run: { uuid: string; id: number; handler: string };
  workspacePath: string;
  instructions: { path: string; sha256: string; text: string } | null;
  command?: string;
  env?: Record<string, string>;
}

/** The lifecycle-hook slots, keyed exactly like `config.hooks`. */
export type HookName =
  | 'after_create'
  | 'before_run'
  | 'after_run'
  | 'after_done'
  | 'on_freeze'
  | 'on_resume';

/**
 * What an addon hook listener receives (BB-599). One context object is
 * shared by every listener of one dispatch, so a key a `before_run` listener
 * adds to `env` reaches the next listener, that slot's shell hook and the
 * agent launch. Reserved keys (`BB_*`, `WORKSPACE_ROOT`, `TICKET_URL`) and
 * invalid entries are restored after each listener. `env` values may be
 * secret: never log them.
 *
 * At `after_run` and `after_done` the context is rebuilt from the current
 * ticket and the durable run record, not from a launch-time snapshot — a
 * listener must find what it started by `run.uuid`, not by a captured value.
 */
export interface HookListenerContext {
  /** Absolute path of the ticket's worktree (the hook's cwd). */
  worktreePath: string;
  ticket: Ticket;
  /** The run's state at start; at `after_done` the ticket's current state. */
  state: string;
  env: Record<string, string>;
  /** The run this slot belongs to; absent at `after_done` without a run. */
  run?: { uuid: string; id?: number };
}

/** A listener's callback for one slot. Awaited; a failure is logged, never fatal. */
export type HookListenerFn = (ctx: HookListenerContext) => void | Promise<void>;

/**
 * One addon contribution to the conductor `hooks` accumulator (BB-599): an
 * object with an optional function per lifecycle slot. Listeners run in
 * accumulator order, each before the slot's project shell hook.
 */
export type HookListener = { [K in HookName]?: HookListenerFn } & {
  /** Names the listener in conductor logs. */
  id?: string;
};

/** Context for a hook invocation — carries the ticket for observable logging. */
export interface HookContext {
  /** The ticket identifier/uuid the hook is running for (log context). */
  ticket: string;
}

/**
 * What a lifecycle hook invocation DID (BB-237). `runHook` still never throws,
 * but it no longer swallows the outcome silently: it reports it, so a caller can
 * record a failed provisioning hook against the run it is about to dispatch
 * instead of relying on a log line to survive (AC-6). Reporting — rather than
 * throwing — keeps the never-wedge property that the never-throw contract exists
 * for; boundedness stays with the conductor's circuit breaker.
 */
export interface HookResult {
  /** The hook slot that was invoked. */
  hook: HookName;
  /** false when no command is configured for the slot — nothing ran. */
  ran: boolean;
  /** false ONLY when a configured command actually failed. */
  ok: boolean;
  /** The stringified failure; present iff `ok` is false. */
  error?: string;
}

/**
 * Outcome of a worktree teardown (BB-293).
 *
 * - `removed`        — the worktree was torn down on this host, or the prunable
 *                      admin entry it left behind was swept.
 * - `already_absent` — nothing to tear down: neither git nor the filesystem
 *                      still has it. A FINISHED teardown, not a failure.
 * - `unverified`     — it could not be resolved or removed and may still be on
 *                      disk; the reaper leaves the ticket on its work list.
 *
 * Replaces the former `boolean`, which could not distinguish "gone because we
 * removed it" from "gone before we got here" — the distinction the reaper needs
 * in order to record the absence rather than swallow it. The mapping preserves
 * the old semantics exactly: `removed` is the old `true`, `unverified` the old
 * `false`.
 */
export type WorktreeTeardown = 'removed' | 'already_absent' | 'unverified';

export interface BbExecutor {
  id: string;
  capabilities(): ExecutorCapabilities;
  /**
   * Run the lifecycle hook `name` (command from `config.hooks[name]`) in `cwd`,
   * best-effort. This is the SINGLE catch point for all lifecycle hooks:
   *
   * - MUST NEVER throw. No configured command → silent no-op. A failing command
   *   → `logger.error({hook,worktree,ticket,err}, 'lifecycle hook failed')` then
   *   return. So a hook failure never aborts dispatch or wedges a run in
   *   `claimed`.
   * - The underlying shell command still fails honestly (a non-zero exit
   *   rejects); only the executor catches + logs + continues.
   * - MUST report the outcome as a {@link HookResult} (BB-237): never throwing
   *   is not the same as never telling. The caller decides what a failure means
   *   for the run it is dispatching; the executor only refuses to abort.
   *
   * `env`, when given, is the run's resolved environment (per-ticket env_vars
   * merged with the core BB_* vars, BB-99), merged over the hook process's
   * inherited env. Values may be sensitive — implementations must never log
   * them (log key names only).
   */
  runHook(
    name: HookName,
    cwd: string,
    ctx: HookContext,
    env?: Record<string, string>,
  ): Promise<HookResult>;
  startRun(input: SpawnRunInput): Promise<SpawnedSession>;
  /**
   * Signal the run's agent to stop. Called by the conductor's run-finalise pass
   * BEFORE it captures the agent transcript (BB-132), so a stop must not
   * destroy the log. For herdr this is a NO-OP: at finalise time the agent is
   * idle and its jsonl transcript is already fully written to disk, and the
   * subsequent {@link cleanupRun} tab-close kills the PTY (the agent dies with
   * it). The seam exists for executors whose agent outlives its UI surface.
   * Best-effort; gated by the conductor on `capabilities().persistent`.
   */
  stopRun(branch: string): Promise<void>;
  /**
   * Tear down ONE run's hosted UI surface — for herdr, close only the tab whose
   * label carries the `#<runId>` token (`startRun` labels every tab
   * `<identifier> · <state> #<run.id>`), via `herdr tab close <tab_id>` (killing
   * that PTY). Run-scoped by design (BB-183): a sibling run's tab in the same
   * branch workspace — a still-open prior-state run or a concurrent re-claim —
   * and any non-run tab are left untouched. Called as the LAST finalisation step,
   * strictly after the transcript is captured, and again at dispatch to clear a
   * reused workspace's leftover tab for the run being (re-)started. No matching
   * tab → a quiet no-op. Does NOT touch the branch worktree (that is the
   * reap/{@link removeWorktree} lifecycle). Best-effort: a failing tab-close is
   * swallowed and never aborts finalisation or dispatch. A no-op for
   * non-persistent executors.
   */
  cleanupRun(branch: string, runId: number): Promise<void>;
  /**
   * Tear down the branch's entire worktree (git worktree + hosted workspace),
   * reclaiming its disk. Called by the conductor's ticket-cleanup pass once a
   * ticket is done. A no-op for non-persistent executors (no hosted workspace);
   * the conductor gates the call on `capabilities().persistent`.
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
  removeWorktree(
    branch: string,
    worktreePath?: string,
  ): Promise<WorktreeTeardown>;
}
