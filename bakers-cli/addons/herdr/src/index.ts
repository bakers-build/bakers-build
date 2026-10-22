import { existsSync, rmSync } from 'node:fs';
import type {
  BbExecutor,
  ExecutorCapabilities,
  ExecutorPlugin,
  HookContext,
  HookName,
  HookResult,
  SpawnedSession,
  SpawnRunInput,
  WorktreeTeardown,
} from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { exec, shellQuote, slugify } from '@bakers-build/core';
import {
  type HerdrExecutorOptions,
  type ResolvedConfig,
  renderTemplate,
  resolveStateConfig,
} from './config.js';
import { forceRemoveDir, restoreWritable } from './fs.js';
import {
  type LaunchScript,
  watchLaunch,
  writeLaunchScript,
} from './launch-script.js';
import {
  applyPaneLayout,
  type HerdrExec,
  isRecord,
  parseJson,
} from './pane-layout.js';
import { AGENT_SHELL_ENV, envArgs } from './panes.js';
import { deriveHerdrRoot } from './root-anchor.js';
import { parseWorkspaceList } from './workspace-list.js';

export type {
  AgentLaunchHost,
  AgentLaunchHostProvider,
  HostedAgent,
} from './agent-host.js';
export { herdrAgentHost } from './agents.js';
export type { HerdrExec } from './pane-layout.js';
export {
  envArgs,
  findTabIdByLabel,
  parsePaneInfo,
  parsePanesInTab,
  parseTabCreate,
} from './panes.js';
// BB-139: the herdr workspace lives in the same package now (the separate
// @bakers-build/addon-herdr-workspace was merged in). The package DEFAULT export
// stays the executor (below); herdrWorkspace + HerdrWorkspace are named exports.
export { herdrProcessHost } from './process-host.js';
export {
  HerdrWorkspace,
  type HerdrWorkspaceOptions,
  herdrWorkspace,
  type OpenLayout,
} from './workspace.js';
export {
  parseWorkspaceList,
  type WorkspaceEntry,
} from './workspace-list.js';

/** Runs a lifecycle-hook shell command in a cwd; rejects on non-zero exit. */
export type ShellRunner = (
  command: string,
  cwd: string,
  env?: Record<string, string>,
) => Promise<void>;

/** Runs `git <args>` in a cwd; resolves with stdout, rejects on non-zero exit. */
export type GitRunner = (args: string[], cwd: string) => Promise<string>;

async function defaultExec(
  args: string[],
  opts?: { redactArgs?: (args: string[]) => string[] },
): Promise<string> {
  return exec('herdr', args, opts);
}

/** Default git runner: real `git` in the given cwd (the parent repo root). */
const defaultGitRunner: GitRunner = (args, cwd) => exec('git', args, { cwd });

/** One `git worktree list --porcelain` record: on-disk path + branch (if any). */
interface GitWorktreeEntry {
  path: string;
  branch: string | null;
}

/**
 * Parse `git worktree list --porcelain`. Records are blank-line separated; each
 * has a `worktree <path>` line and, for an attached HEAD, a `branch
 * refs/heads/<branch>` line (a detached HEAD has none). `prunable <reason>`
 * entries (a `.git/worktrees/<name>` admin entry whose dir has vanished) still
 * carry their `worktree <path>` line, so they parse too — the caller decides
 * what to do with a path no longer on disk.
 */
function parseGitWorktreePorcelain(output: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let path: string | null = null;
  let branch: string | null = null;
  const flush = () => {
    if (path) {
      entries.push({ path, branch });
    }
    path = null;
    branch = null;
  };
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush(); // a new record begins — commit the previous one
      path = line.slice('worktree '.length).trim();
    } else if (line.startsWith('branch ')) {
      branch = line
        .slice('branch '.length)
        .trim()
        .replace(/^refs\/heads\//, '');
    }
  }
  flush();
  return entries;
}

/** Default hook runner: `sh -c <command>` in the worktree — fails honestly. */
const defaultShellRunner: ShellRunner = async (command, cwd, env) => {
  await exec('sh', ['-c', command], { cwd, ...(env ? { env } : {}) });
};

const noopLogger: ConductorLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

interface WorktreeEntry {
  /** herdr's reported git branch — null when the worktree HEAD is detached. */
  branch: string | null;
  path: string;
  open_workspace_id?: string;
}

function parseWorktreeList(output: string): WorktreeEntry[] {
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

/**
 * Extract the open workspace id from `herdr worktree open`'s own JSON. herdr
 * returns it in the result envelope under any of these keys (herdr 0.7.x):
 * `workspace.workspace_id`, `worktree.open_workspace_id`, or
 * `root_pane.workspace_id`. Returns null when the payload carries none (e.g. an
 * error envelope), so the caller can fall back to a list lookup or surface the
 * failure. This is the reliable success path — no branch match involved.
 */
function parseWorkspaceOpen(output: string): string | null {
  const parsed = parseJson(output, 'worktree open');
  const result = isRecord(parsed)
    ? (parsed.result as
        | {
            workspace?: { workspace_id?: unknown };
            worktree?: { open_workspace_id?: unknown };
            root_pane?: { workspace_id?: unknown };
          }
        | undefined)
    : undefined;
  const candidates = [
    result?.workspace?.workspace_id,
    result?.worktree?.open_workspace_id,
    result?.root_pane?.workspace_id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c) {
      return c;
    }
  }
  return null;
}

interface HerdrTab {
  tabId: string;
  label: string;
}

function parseTabList(output: string): HerdrTab[] {
  const parsed = parseJson(output, 'tab list');
  const tabs = isRecord(parsed)
    ? (parsed.result as { tabs?: unknown } | undefined)?.tabs
    : undefined;
  if (!Array.isArray(tabs)) {
    return [];
  }
  return tabs
    .filter(isRecord)
    .filter((t) => typeof t.tab_id === 'string' && typeof t.label === 'string')
    .map((t) => ({
      tabId: t.tab_id as string,
      label: t.label as string,
    }));
}

/**
 * Whether a tab label carries the exact `#<runId>` token that `startRun` emits
 * (`<identifier> · <state> #<run.id>`). Anchored on the trailing token and
 * compared numerically, so `#4339` never matches `#43390` / `#433` (BB-183
 * AC-3). A label with no trailing `#<digits>` token (a non-run tab) never
 * matches.
 */
function labelMatchesRun(label: string, runId: number): boolean {
  const m = label.match(/#(\d+)$/);
  return m !== null && Number(m[1]) === runId;
}

function parseTabCreate(output: string): { paneId: string; tabId: string } {
  const parsed = parseJson(output, 'tab create');
  const result = isRecord(parsed)
    ? (parsed.result as
        | {
            root_pane?: { pane_id?: unknown };
            tab?: { tab_id?: unknown };
          }
        | undefined)
    : undefined;
  const paneId = result?.root_pane?.pane_id;
  const tabId = result?.tab?.tab_id;
  if (typeof paneId !== 'string' || typeof tabId !== 'string') {
    throw new Error('herdr tab create returned invalid schema');
  }
  return { paneId, tabId };
}

/** Passive verdict about a worktree's existence, in both dimensions (BB-293). */
interface WorktreeProbe {
  /** The parent repo still registers it in `git worktree list --porcelain`. */
  registered: boolean;
  /** Its directory is still on disk. */
  onDisk: boolean;
  /** The path the verdict is about, or null when nothing resolved one. */
  path: string | null;
}

/** Normalise a worktree path for comparison (strip trailing slashes). */
function normPath(path: string): string {
  return path.replace(/\/+$/, '');
}

/**
 * Resolve a worktree entry, preferring the stable `worktreePath` over `branch`.
 * The checked-out branch is mutable (the coding agent may rename/switch it), so
 * the path — deterministic and identifier-derived — is the reliable key. Fall
 * back to a branch match so a missing/renamed path still resolves. Returns null
 * only when neither key matches any listed worktree.
 */
function resolveWorktreeEntry(
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

export class HerdrExecutor implements BbExecutor {
  readonly id = 'herdr';

  constructor(
    private readonly options: HerdrExecutorOptions,
    private readonly execHerdr: HerdrExec = defaultExec,
    private readonly logger: ConductorLogger = noopLogger,
    private readonly runShell: ShellRunner = defaultShellRunner,
    private readonly runGit: GitRunner = defaultGitRunner,
  ) {}

  capabilities(): ExecutorCapabilities {
    return { persistent: true };
  }

  /**
   * Run the lifecycle hook `name` best-effort — the single catch point for all
   * lifecycle hooks (see {@link BbExecutor.runHook}). No configured command →
   * silent no-op. A failing command → log loudly (hook + worktree + ticket +
   * err) and return. NEVER throws, so a hook failure can't abort dispatch or
   * wedge a run.
   *
   * BB-237: it also RETURNS what happened ({@link HookResult}). Not throwing
   * kept a hook from wedging a run, but swallowing the outcome entirely left the
   * caller unable to tell a provisioned worktree from a broken one — so an agent
   * was dispatched into a worktree whose bootstrap had aborted, with nothing but
   * a log line (which, on a TTY, went nowhere) to say so.
   */
  async runHook(
    name: HookName,
    cwd: string,
    ctx: HookContext,
    env?: Record<string, string>,
  ): Promise<HookResult> {
    const command = this.options.hooks?.[name];
    if (!command) {
      return { hook: name, ran: false, ok: true };
    }
    try {
      await this.runShell(command, cwd, env);
      return { hook: name, ran: true, ok: true };
    } catch (err) {
      this.logger.error(
        { hook: name, worktree: cwd, ticket: ctx.ticket, err: String(err) },
        'lifecycle hook failed',
      );
      return { hook: name, ran: true, ok: false, error: String(err) };
    }
  }

  /**
   * List worktrees, ALWAYS anchored to the configured parent repo root
   * (BB-211). `herdr worktree list` is machine-global, but run WITHOUT
   * `--cwd` it resolves herdr's own ambient (previously selected / persisted /
   * process / shell / daemon) repository context. When a preceding
   * `bakers-cleanup-*` integration test selected then deleted a
   * `/tmp/bakers-cleanup-*` repo, that stale context survives and the unanchored
   * list exits (`cannot change to '/tmp/bakers-cleanup-…'`), aborting dispatch.
   * Anchoring every list with `--cwd this.options.root` makes listing
   * independent of that ambient context. This is the SINGLE choke point for
   * all executor `worktree list` call paths — the sibling
   * {@link HerdrWorkspace.ensure} anchors identically. The `--cwd` is only
   * omitted when no root is configured (rootless test callers).
   *
   * On a herdr failure it throws an error naming the explicit configured root
   * and the operation (AC-9) instead of surfacing herdr's raw stale-context
   * message, so a future context failure is diagnosable.
   */
  private async listWorktrees(): Promise<WorktreeEntry[]> {
    const args = [
      'worktree',
      'list',
      ...(this.options.root ? ['--cwd', this.options.root] : []),
      '--json',
    ];
    let output: string;
    try {
      output = await this.execHerdr(args);
    } catch (err) {
      throw new Error(
        `herdr worktree list failed for configured root ${
          this.options.root ?? '<unset>'
        }: ${String(err)}`,
      );
    }
    return parseWorktreeList(output);
  }

  /**
   * Find the worktree entry (path + open_workspace_id) for a branch via
   * worktree list. Returns null if the branch has no worktree.
   */
  private async findWorktreeByBranch(
    branch: string,
  ): Promise<WorktreeEntry | null> {
    const entries = await this.listWorktrees();
    return entries.find((e) => e.branch === branch) ?? null;
  }

  /**
   * Find the open_workspace_id for a branch via worktree list.
   * Returns null if no workspace is open for that branch.
   */
  private async findWorkspaceByBranch(branch: string): Promise<string | null> {
    const entry = await this.findWorktreeByBranch(branch);
    return entry?.open_workspace_id ?? null;
  }

  /**
   * Find the open_workspace_id for a worktree by its stable `worktreePath`
   * (falling back to `branch`; see {@link resolveWorktreeEntry}). Unlike
   * {@link findWorkspaceByBranch}, this does not rely on the mutable branch —
   * it is the startRun lookup the BB-114 fix hangs on. Returns null when the
   * worktree is not listed as open.
   */
  private async findOpenWorkspace(
    branch: string,
    worktreePath?: string,
  ): Promise<string | null> {
    const entries = await this.listWorktrees();
    return (
      resolveWorktreeEntry(entries, branch, worktreePath)?.open_workspace_id ??
      null
    );
  }

  /** Parent repo root for git worktree admin ops (falls back to `fallback`). */
  private gitRoot(fallback: string): string {
    return this.options.root ?? fallback;
  }

  /**
   * Sweep orphaned `.git/worktrees/<name>` admin entries at the parent repo
   * root — the ones whose on-disk dir has vanished (BB-141: they show up as
   * `prunable` in `git worktree list`). Best-effort: a prune failure must never
   * fail teardown.
   */
  private async pruneWorktrees(root: string): Promise<void> {
    try {
      await this.runGit(['worktree', 'prune'], root);
    } catch {
      // best-effort — pruning is a sweep, never the teardown's success gate
    }
  }

  /**
   * Remove an on-disk worktree GIT-AWARELY (BB-141 RC-1). The old fallback
   * raw-`rm`'d the directory and left the parent repo's `.git/worktrees/<name>`
   * admin entry behind → a `prunable` orphan. This:
   *   1. restores owner-write (Drupal hardens web/sites/default 0555 +
   *      settings.php 0444 — chmod-restorable by the owning user, no sudo);
   *   2. `git worktree remove --force <path>` from the PARENT repo root, which
   *      unlinks the directory AND drops the `.git/worktrees/<name>` entry —
   *      but ONLY when the path really is a registered worktree (BB-293):
   *      against an unregistered path git exits 128 and the shared exec helper
   *      logs `ERROR: exec failed` for a condition this code expects and
   *      handles. The guard lives here rather than at the caller because this
   *      method has a second call site (the path resolved via
   *      {@link findGitWorktree});
   *   3. guarantees the directory is gone (a raw force-remove) in case git
   *      refused or was skipped — a no-op if git already removed it;
   *   4. prunes the repo so any now-stale admin entry is swept.
   *
   * Returns whether the directory is gone afterwards. A reclaim that cannot
   * remove it REPORTS instead of throwing (BB-293, spec D5): the raw EACCES
   * used to propagate all the way out of {@link removeWorktree} and reach the
   * reaper as an opaque exception.
   */
  private async gitAwareRemove(
    path: string,
    registered: boolean,
  ): Promise<boolean> {
    restoreWritable(path);
    const root = this.gitRoot(path);
    if (registered) {
      try {
        await this.runGit(['worktree', 'remove', '--force', path], root);
      } catch (err) {
        // Registered yet refused — genuinely unexpected. Say so, then reclaim
        // the directory directly below.
        this.logger.warn(
          { path, err: String(err) },
          'git worktree remove failed on a registered worktree',
        );
      }
    }
    if (existsSync(path)) {
      try {
        forceRemoveDir(path);
      } catch (err) {
        // BB-293 (spec D5): a leftover we cannot unlink — most likely
        // foreign-owned (a container wrote it under another uid), which chmod
        // cannot repair. Name the failing step; the reaper retries.
        this.logger.warn(
          { path, err: String(err) },
          'worktree directory reclaim failed',
        );
        return false;
      }
    }
    await this.pruneWorktrees(root);
    return true;
  }

  /**
   * When herdr has lost track of a worktree and its `worktreePath` was never
   * persisted, the PARENT repo's `git worktree list` still knows it (BB-141
   * RC-2 — the ~28 never-touched leftovers). Resolve the lost worktree's on-disk
   * path there, preferring an exact `worktreePath` match, then a branch match;
   * never the main worktree. Returns null when nothing matches. Best-effort: a
   * git failure resolves to null.
   *
   * `cwd` is only where git is RUN. The main worktree is excluded by git's own
   * porcelain ordering (it is always the first record) rather than by comparing
   * against `cwd`, because the two coincide only when a parent root is
   * configured. Without one the probe falls back to running git inside the
   * worktree itself, and a `path !== cwd` filter then dropped the very entry
   * being asked about — so `registered: true` was unreachable for a rootless
   * executor (BB-293 review, finding 1). The configured root is excluded too,
   * belt and braces, so a caller that anchors elsewhere still never resolves the
   * main checkout as a ticket worktree.
   */
  private async findGitWorktree(
    cwd: string,
    branch: string,
    worktreePath?: string,
  ): Promise<string | null> {
    let output: string;
    try {
      output = await this.runGit(['worktree', 'list', '--porcelain'], cwd);
    } catch {
      return null;
    }
    const mainRoot = this.options.root;
    const candidates = parseGitWorktreePorcelain(output).filter(
      (e, i) => i > 0 && (!mainRoot || normPath(e.path) !== normPath(mainRoot)),
    );
    if (worktreePath) {
      const want = normPath(worktreePath);
      const byPath = candidates.find((e) => normPath(e.path) === want);
      if (byPath) {
        return byPath.path;
      }
    }
    return candidates.find((e) => e.branch === branch)?.path ?? null;
  }

  /**
   * Ask — passively — whether this worktree still exists, in BOTH dimensions
   * that can come apart (BB-293): git's registration, and the directory on
   * disk. The reported failure was exactly a case where they disagreed — the
   * directory was there, the registration was not — so a single-dimension
   * check cannot decide what to do.
   *
   * Passive by construction: it writes nothing, calls no herdr, and NEVER
   * throws. A git failure yields `registered: false`, degrading the verdict to
   * the on-disk answer rather than failing the teardown.
   *
   * The persisted `worktreePath` is the stable key and wins when given;
   * `registered` then describes THAT path, never a branch match pointing
   * somewhere else (the checked-out branch is mutable — BB-114).
   *
   * git is run at the configured parent root when there is one, else inside the
   * worktree itself — `git worktree list` enumerates the whole repo from any of
   * its worktrees, so the rootless answer is the same list.
   */
  private async probeWorktree(
    branch: string,
    worktreePath?: string,
  ): Promise<WorktreeProbe> {
    const cwd = this.options.root ?? worktreePath ?? null;
    const gitPath = cwd
      ? await this.findGitWorktree(cwd, branch, worktreePath)
      : null;
    const path = worktreePath ?? gitPath;
    const registered =
      gitPath !== null && path !== null && normPath(gitPath) === normPath(path);
    return { registered, onDisk: path !== null && existsSync(path), path };
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
   * aborts (returns `false` → `cleaned_up=0`) so the reaper retries later,
   * rather than deleting the focused path out from under the user.
   */
  private async ensureFocusSafeToRemove(workspaceId: string): Promise<boolean> {
    const workspaces = parseWorkspaceList(
      await this.execHerdr(['workspace', 'list']),
    );
    const target = workspaces.find((w) => w.workspaceId === workspaceId);
    // Not focused (or not listed) → removing it strands no client.
    if (!target?.focused) {
      return true;
    }
    // Focused: resolve the main-checkout workspace for the SAME repo — the
    // non-linked workspace whose repo_root matches the target's (falling back
    // to the configured parent root when herdr reports no repo_root).
    const anchor = target.repoRoot ?? this.options.root ?? null;
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
      await this.execHerdr(['workspace', 'focus', parent.workspaceId]);
    } catch {
      return false;
    }
    // Verify the switch actually took before deleting the (was-focused) dir.
    const after = parseWorkspaceList(
      await this.execHerdr(['workspace', 'list']),
    );
    const parentNow = after.find((w) => w.workspaceId === parent.workspaceId);
    const targetNow = after.find((w) => w.workspaceId === workspaceId);
    return parentNow?.focused === true && targetNow?.focused !== true;
  }

  /**
   * Tear down a ticket's entire worktree (git worktree + hosted workspace).
   * `herdr worktree remove` is keyed by an open workspace id, so resolve the
   * worktree first — by its stable `worktreePath`, falling back to `branch`
   * (see {@link resolveWorktreeEntry}): if its workspace is already open use
   * that id; otherwise open the on-disk worktree to obtain one (mirrors
   * startRun's open-if-needed).
   *
   * `herdr worktree list` is machine-global — it enumerates every repo's
   * worktrees on the host, most of which are not ours. So a no-match does NOT
   * mean "error"; it means herdr no longer tracks this ticket's worktree. When
   * herdr has lost track, teardown is resolved off git itself (never a foreign
   * worktree), git-awarely so no `.git/worktrees/<name>` metadata is orphaned
   * (BB-141 RC-1). Since BB-293 that resolution starts by ASKING — a passive
   * {@link probeWorktree} reads both dimensions of existence and the four cases
   * branch explicitly:
   *   - neither registered nor on disk → nothing to do at all;
   *   - registered but gone from disk → sweep the prunable admin entry;
   *   - on disk but not registered → reclaim the directory, WITHOUT asking git
   *     to remove a worktree it does not know (the bogus `ERROR: exec failed`);
   *   - both → reclaim it git-awarely, `git worktree remove` included.
   * A path that resolves in NEITHER dimension is not "absent" — it is
   * unresolved, and still reported `unverified` (BB-141 RC-2).
   *
   * Reports what the teardown DID (BB-293): `removed` when the worktree is
   * gone because this host removed it (or reclaimed an on-disk orphan, or swept
   * the prunable admin entry it left behind), `already_absent` when a RESOLVED
   * worktree existed in neither dimension, and `unverified` ONLY when nothing
   * was resolvable or the directory could not be reclaimed — the reaper then
   * leaves the ticket on its work list for a later retry instead of falsely
   * flagging it cleaned (BB-141 RC-2).
   */
  async removeWorktree(
    branch: string,
    worktreePath?: string,
  ): Promise<WorktreeTeardown> {
    // BB-468 / BB-228 (superseded MR !258, trigger folded in here): a
    // ticket whose recorded `worktreePath` IS the configured parent-repo root
    // must be refused rather than acted on. BB-293 already excludes the main
    // checkout on the git side (`findGitWorktree` drops porcelain record 0 and
    // the configured root), but neither `resolveWorktreeEntry` (herdr-tracked
    // path) nor the probe fallback below carried the same filter, leaving two
    // live branches: herdr tracks the workspace → `herdr worktree remove
    // --force` throws `not_linked_worktree`, caught by the reaper and retried
    // forever; herdr does NOT track it → the probe resolves `worktreePath`
    // itself (unfiltered), `registered: false`, `onDisk: true`, and
    // `gitAwareRemove` calls `forceRemoveDir` on the MAIN CHECKOUT. Refusing
    // here, before either branch is reached, closes both without touching the
    // git-side exclusion or the executor's `unverified`/`already_absent`
    // contract for every other path.
    if (this.options.root && worktreePath) {
      const root = normPath(this.options.root);
      if (normPath(worktreePath) === root) {
        this.logger.warn(
          { branch, worktreePath, root: this.options.root },
          'refusing to tear down the main checkout',
        );
        return 'unverified';
      }
    }
    const entries = await this.listWorktrees();
    const entry = resolveWorktreeEntry(entries, branch, worktreePath);
    if (!entry) {
      // herdr no longer tracks it. BB-293: ask before acting. An
      // already-absent worktree is a FINISHED teardown, not a failure to retry
      // — and running `git worktree remove` against an unregistered path is
      // what produced the bogus `ERROR: exec failed` (git exits 128 on an
      // expected, handled condition). herdr still tracking the worktree is
      // itself evidence that something is there to release, which is why the
      // probe governs only this lost-track path and the tracked path below
      // keeps its behaviour unchanged.
      const probe = await this.probeWorktree(branch, worktreePath);
      if (probe.path) {
        if (!probe.onDisk) {
          if (!probe.registered) {
            this.logger.info(
              { branch, worktreePath: probe.path },
              'worktree already absent — nothing to tear down',
            );
            return 'already_absent';
          }
          // A prunable admin entry whose directory has vanished: the metadata
          // sweep IS the teardown here (BB-141).
          await this.pruneWorktrees(this.gitRoot(probe.path));
          return 'removed';
        }
        return (await this.gitAwareRemove(probe.path, probe.registered))
          ? 'removed'
          : 'unverified';
      }
      // Nothing resolvable in either dimension — the path was never persisted
      // and git does not know the branch either. Sweep pre-existing orphans,
      // then report the teardown UNVERIFIED so the reaper retries rather than
      // falsely cleaning (BB-141 RC-2). NOT `already_absent`: absence can
      // only be claimed about a worktree that was actually located.
      if (this.options.root) {
        await this.pruneWorktrees(this.options.root);
      }
      return 'unverified';
    }
    let workspaceId = entry.open_workspace_id ?? null;
    if (!workspaceId) {
      // Reattach from the PARENT repo root, never the linked worktree itself:
      // herdr rejects an open whose --cwd is a linked worktree with
      // `linked_worktree_source` ("New and open actions start from the repo
      // parent workspace"), which then yields no workspace id and the remove
      // never runs. Fall back to the linked path only when no root is
      // configured (keeps the old behaviour for rootless test callers).
      await this.execHerdr([
        'worktree',
        'open',
        '--cwd',
        this.options.root ?? entry.path,
        '--branch',
        // entry.branch is null for a detached HEAD; fall back to the ticket
        // branch so `open` still gets a branch arg.
        entry.branch ?? branch,
        '--no-focus',
        '--json',
      ]);
      // Re-resolve by the same keys — open flips the entry's workspace id.
      const reopened = resolveWorktreeEntry(
        await this.listWorktrees(),
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
    if (!(await this.ensureFocusSafeToRemove(workspaceId))) {
      return 'unverified';
    }
    // Drupal hardens web/sites/default (0555) and settings.php/.htaccess (0444);
    // herdr's remove performs the actual unlink and would hit EACCES on those
    // read-only dirs. Restore owner-write on the on-disk worktree first.
    restoreWritable(entry.path);
    await this.execHerdr([
      'worktree',
      'remove',
      '--workspace',
      workspaceId,
      '--force',
      '--json',
    ]);
    // BB-166: verify the directory is actually gone on disk. If it survived,
    // report the teardown UNVERIFIED (false) so the reaper retries instead of
    // falsely flagging the ticket cleaned.
    if (existsSync(entry.path)) {
      return 'unverified';
    }
    // Sweep any orphaned `.git/worktrees/<name>` admin entries at the parent
    // root (this teardown's and any pre-existing prunable ones — BB-141).
    if (this.options.root) {
      await this.pruneWorktrees(this.options.root);
    }
    return 'removed';
  }

  async startRun(input: SpawnRunInput): Promise<SpawnedSession> {
    const branchName = input.ticket.branchName;
    const workspacePath = input.workspacePath;
    const cfg: ResolvedConfig = resolveStateConfig(
      this.options,
      input.ticket.state,
    );
    // 1. Already-open workspace for THIS worktree, keyed by the stable
    //    identifier-derived PATH — never the branch (BB-114): the checked-out
    //    branch is mutable (a coding agent may switch/rename it) and herdr
    //    reports `null` for a detached HEAD, so a branch match is unreliable.
    let workspaceId = await this.findOpenWorkspace(branchName, workspacePath);

    // 2. Open workspace if not already open. Reattach from the PARENT repo
    //    root, never the linked worktree path: herdr rejects an open whose
    //    --cwd is a linked worktree with `linked_worktree_source` ("New and
    //    open actions start from the repo parent workspace"), so passing
    //    input.workspacePath (the linked path) makes every first dispatch of a
    //    closed-on-disk worktree fail — the run is released and re-claimed in a
    //    loop. Mirrors removeWorktree's reattach. Fall back to the linked path
    //    only when no root is configured (rootless test callers).
    if (!workspaceId) {
      const openOutput = await this.execHerdr([
        'worktree',
        'open',
        '--cwd',
        this.options.root ?? workspacePath,
        '--branch',
        branchName,
        '--no-focus',
        '--json',
      ]);
      // Take the id from `open`'s OWN output — the reliable success path, with
      // no branch match. Only if it carries none do we re-derive from the list
      // (matched by the stable path, not the branch).
      workspaceId = parseWorkspaceOpen(openOutput);
      if (!workspaceId) {
        const entries = await this.listWorktrees();
        workspaceId =
          resolveWorktreeEntry(entries, branchName, workspacePath)
            ?.open_workspace_id ?? null;
        if (!workspaceId) {
          // Surface the ACTUAL cause (AC #3): herdr's own open output and the
          // worktree state it listed — not just the generic per-branch message.
          throw new Error(
            `herdr worktree open did not yield a workspace id for path ${workspacePath} (branch ${branchName}). ` +
              `open output: ${openOutput.trim()}; listed worktrees: ${JSON.stringify(entries)}`,
          );
        }
      }
    }

    const vars: Record<string, string> = {
      identifier: input.ticket.identifier,
      title: input.ticket.title,
      titleSlug: slugify(input.ticket.title),
      runUuid: input.run.uuid,
      workspacePath: input.workspacePath,
    };

    // 3. Create tab — NO --json flag; label includes the run-id token. The tab's
    // root pane IS the agent pane, so it is created carrying the agent-shell
    // marker: the interactive shell must see it at startup for the user's opt-in
    // history isolation to fire (BB-64). The run's own env (BB-99) stays out
    // of here — it travels inside a 0600 launch script, so no secret moves into
    // the pane environment or the typed line.
    const { paneId: rootPaneId, tabId } = parseTabCreate(
      await this.execHerdr([
        'tab',
        'create',
        '--workspace',
        workspaceId,
        '--label',
        `${input.ticket.identifier} · ${input.ticket.state} #${input.run.id}`,
        '--no-focus',
        ...envArgs(AGENT_SHELL_ENV),
      ]),
    );

    // BB-374: panel label on the state root pane (best-effort). Tab --label
    // above stays the stop/state matching string and is intentionally not the
    // resolved StateConfig.tabLabel path.
    await this.execHerdr([
      'pane',
      'rename',
      rootPaneId,
      renderTemplate(cfg.panelLabel, vars),
    ]).catch(() => {});

    let launch: LaunchScript | undefined;
    try {
      // 4+5. Run the agent via a short `sh '<script>'` line in the root pane,
      // then split each configured pane — the shared pane-layout primitive
      // (same code path as the workspace open pane). The assembled command
      // (env prefixes + agent argv) lives in a 0600 file, so the typed line
      // stays under the tty canonical cap and secrets never appear in the
      // pane scrollback or exec log. startRun then waits for `started`
      // (slow shells) and a short exit window after that (immediate death).
      // The layout panes belong to the run's tab too, so they are marked as
      // agent shells as well — the executor opts in, the workspace's open-layout
      // caller does not (BB-64). commandFor / writeLaunchScript sit inside
      // the try so an invalid env key or a temp-dir write error still closes
      // the tab.
      launch = writeLaunchScript(this.commandFor(input));
      await applyPaneLayout(
        this.execHerdr,
        rootPaneId,
        { command: launch.typedCommand, panes: cfg.panes },
        input.workspacePath,
        vars,
        { env: AGENT_SHELL_ENV },
      );
      await watchLaunch(launch, {
        ...(this.options.launchWatch ?? {}),
        readPane: () =>
          this.execHerdr(['pane', 'read', rootPaneId, '--lines', '40']),
      });

      // 6. Return branch as sessionRef (for logging)
      return { sessionRef: branchName };
    } catch (err) {
      // 7. Drop the 0600 command file (secrets) then close only the new tab.
      if (launch) {
        rmSync(launch.dir, { recursive: true, force: true });
      }
      await this.rollback(tabId);
      throw err;
    }
  }

  /** Best-effort cleanup: close only the just-created tab. Swallows errors. */
  private async rollback(tabId: string): Promise<void> {
    try {
      await this.execHerdr(['tab', 'close', tabId]);
    } catch {
      // ignore — best-effort
    }
  }

  /**
   * No-op: at finalise time the agent is idle and its transcript is already on
   * disk; the {@link cleanupRun} tab-close kills the PTY, so the agent dies
   * implicitly. Kept to satisfy the run lifecycle seam.
   */
  async stopRun(_branch: string): Promise<void> {}

  /**
   * Close ONLY the branch-workspace tab whose label carries the `#<runId>`
   * token (`herdr tab close <tab_id>`), killing that PTY (BB-183). The run
   * identity lives in the tab label, so teardown is run-scoped: a sibling run's
   * tab and any non-run tab in the same workspace are left untouched, and a
   * missing match is a quiet no-op. Best-effort: a failing close is swallowed.
   * No `/exit`/C-c and no `(done)` rename — the matched tab simply goes away.
   * The branch worktree is untouched (that is the reap/{@link removeWorktree}
   * lifecycle).
   */
  async cleanupRun(branch: string, runId: number): Promise<void> {
    const workspaceId = await this.findWorkspaceByBranch(branch);
    if (!workspaceId) {
      return;
    }
    const tabs = parseTabList(
      await this.execHerdr(['tab', 'list', '--workspace', workspaceId]),
    );
    const match = tabs.find((tab) => labelMatchesRun(tab.label, runId));
    if (!match) {
      return; // no tab for this run — quiet best-effort no-op (AC-4)
    }
    try {
      await this.execHerdr(['tab', 'close', match.tabId]);
    } catch {
      // ignore — best-effort: a failing tab-close must not abort finalisation
    }
  }

  private commandFor(input: SpawnRunInput): string {
    const env = Object.entries(input.env ?? {}).map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`invalid environment variable name for herdr: ${key}`);
      }
      return `${key}=${shellQuote(value)}`;
    });
    // herdr is agent-agnostic: it runs the command the conductor (via the agent
    // plugin) provides, falling back to the configured default. No prompt build
    // and no agent-specific flags here. Non-interactive `sh` eval's the line,
    // so the binary must resolve through PATH (aliases are not loaded).
    const command = input.command ?? this.options.command ?? 'claude';
    return [...env, command].join(' ');
  }
}

export function herdrExecutor(
  options: HerdrExecutorOptions = {},
): ExecutorPlugin {
  return {
    kind: 'executor',
    id: 'herdr',
    requiredModules: [],
    async createExecutor(config, deps) {
      // Derive the parent repo root via the single shared anchor (BB-177) so
      // removeWorktree / worktree open reattach from the main clone, not the
      // linked worktree — identical derivation to the sibling herdrWorkspace.
      const root = await deriveHerdrRoot(config.config_path, {
        ...(options.root !== undefined ? { override: options.root } : {}),
        ...(options.execGit ? { execGit: options.execGit } : {}),
      });
      // Lifecycle hooks are top-level config (BB-84); the executor runs them
      // best-effort through its injected logger.
      return new HerdrExecutor(
        {
          command: options.command ?? 'claude',
          root,
          ...(options.hooks ? { hooks: options.hooks } : {}),
          ...(config.hooks ? { hooks: config.hooks } : {}),
          ...(options.default ? { default: options.default } : {}),
          ...(options.states ? { states: options.states } : {}),
          ...(options.launchWatch ? { launchWatch: options.launchWatch } : {}),
        },
        defaultExec,
        deps.logger,
      );
    },
  };
}

// Default export: this module also exports the `HerdrExecutor` class, so the
// config resolver's auto-pick (no `export:`) sees 2 function exports and
// would otherwise throw "specify export" — see conductor/src/config.ts
// `loadNamedPlugin`. The default export makes the factory win.
export default herdrExecutor;
