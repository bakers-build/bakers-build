import { resolve } from 'node:path';
import {
  loadInstructions,
  runBranchGit,
} from '@bakers-build/addon-workspace-git';
import type {
  BbWorkspace,
  ConductorFileConfig,
  EnsuredWorkspace,
  ExecutorDeps,
  WorkspacePlugin,
} from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { exec } from '@bakers-build/core';
import { type PaneSpec, renderTemplate } from './config.js';
import { applyPaneLayout, isRecord, parseJson } from './pane-layout.js';
import { deriveHerdrRoot, type RootGitExec } from './root-anchor.js';
import { resolveBaseRef } from './shared.js';

export type HerdrExec = (args: string[]) => Promise<string>;
export type GitExec = (args: string[]) => Promise<string>;

/**
 * Layout applied to the workspace's initial (root) pane on a FRESH worktree open
 * (BB-139): `command` launches a tool in the main pane (e.g. `spiceedit`) so
 * the human lands in an editor instead of a bare shell; `panes[]` are optional
 * splits off it. Same shape as the executor's per-state layout minus `tabLabel`
 * — there is only ONE open layout, not a per-ticket-state map.
 *
 * BB-234: `{identifier}`, `{branch}` and `{worktreePath}` expand in `command`
 * **and** in every `panes[].command`. The root command is rendered here, by
 * `ensure`, before the finished layout reaches `applyPaneLayout` — that shared
 * helper types its root command VERBATIM on purpose, because its other caller
 * (the executor) pre-assembles `KEY='value' <agent>` env prefixes whose values
 * may legitimately contain braces (spec D2).
 *
 * BB-374: `tabLabel` / `panelLabel` are chrome strings applied after the
 * layout via `herdr tab rename` / `herdr pane rename` ("panel label" = pane
 * label). Defaults ship when keys are absent on an active layout; `open: {}`
 * remains the full opt-out (no command, no splits, no labels). The overview
 * **tab** default is `{identifier} · {title}` with `{title}` capped at
 * {@link OPEN_TAB_TITLE_MAX} so the always-visible tab bar stays readable;
 * the pane/panel label still gets the full title.
 *
 * Unset → {@link DEFAULT_OPEN_LAYOUT}, the ticket deep link. `{}` → the bare
 * empty tab (`applyPaneLayout` issues no calls for an empty layout).
 */
export interface OpenLayout {
  command?: string;
  panes?: PaneSpec[];
  /**
   * Overview tab label template. Default: `{identifier} · {title}` (title
   * truncated to {@link OPEN_TAB_TITLE_MAX} when rendering).
   */
  tabLabel?: string;
  /**
   * Overview root-pane label template (`herdr pane rename`). Default:
   * `{identifier} · {title}` (full title).
   */
  panelLabel?: string;
}

/** Max `{title}` length substituted into the overview **tab** label (BB-374). */
export const OPEN_TAB_TITLE_MAX = 30;

/** Cap overview-tab `{title}` and append `...` when truncated. */
export function truncateOpenTabTitle(title: string): string {
  if (title.length <= OPEN_TAB_TITLE_MAX) {
    return title;
  }
  return `${title.slice(0, OPEN_TAB_TITLE_MAX)}...`;
}

/** Default overview tab chrome (BB-374) — always-visible tab bar identity. */
export const DEFAULT_OPEN_TAB_LABEL = '{identifier} · {title}';
/** Default overview pane/panel label template (BB-374). */
export const DEFAULT_OPEN_PANEL_LABEL = '{identifier} · {title}';

/**
 * The shipped default open layout (BB-234): a fresh worktree's initial pane
 * renders the ticket it belongs to instead of an anonymous shell prompt.
 *
 * It lives in **code, not config**, because a default each repo has to opt into
 * would leave the defect in place for every other consumer of this addon; the
 * addon already ships opinionated defaults of this kind (`BUILTIN_DEFAULTS` in
 * `./config.js`), and `bakers ui` is a command of the very host that ships it.
 *
 * `open: {}` is the documented opt-out back to the pre-BB-234 bare tab, so
 * the default is not a one-way door.
 */
export const DEFAULT_OPEN_LAYOUT: OpenLayout = {
  command: 'bakers ui --ticket {identifier}',
  tabLabel: DEFAULT_OPEN_TAB_LABEL,
  panelLabel: DEFAULT_OPEN_PANEL_LABEL,
};

export interface HerdrWorkspaceOptions {
  /** Main clone (a git repo): herdr `--cwd` target + worktree base. */
  root: string;
  /** Relative dir (under root) for new worktrees. Default: `.bakers-worktrees`. */
  worktreeDir?: string;
  /**
   * Base ref new worktree branches are created from. Default: the remote
   * tracking branch of the repo's checked-out branch (e.g. `origin/develop`),
   * so runs start from the pushed remote state, not the host's local branch.
   */
  baseBranch?: string;
  /**
   * Startup layout for the initial pane, applied on a FRESH worktree open only
   * (BB-139). Unset → {@link DEFAULT_OPEN_LAYOUT} (`bakers ui --ticket <ID>`,
   * BB-234); `{}` → the bare empty tab is left unchanged.
   */
  open?: OpenLayout;
  /** Overrideable herdr exec fn — defaults to the real `herdr` binary. */
  execHerdr?: HerdrExec;
  /** Overrideable git exec fn — defaults to the real `git` binary. */
  execGit?: GitExec;
  /** Optional logger for the best-effort open-layout path (defaults to noop). */
  logger?: ConductorLogger;
  /**
   * Default `false`: before creating a worktree, set `branch.autoSetupMerge=false`
   * in `root`, and give runs `push.default=current`. `true` leaves Git alone.
   */
  autoSetupMerge?: boolean;
}

const defaultExec: HerdrExec = (args) => exec('herdr', args);
const defaultGitExec: GitExec = (args) => exec('git', args);

const noopLogger: ConductorLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

interface WorktreeEntry {
  branch: string;
  path: string;
  open_workspace_id?: string;
}

/** Parse `herdr worktree list --json` → array of on-disk worktrees. */
function parseWorktreeList(output: string): WorktreeEntry[] {
  const parsed = parseJson(output, 'worktree list');
  const worktrees = isRecord(parsed)
    ? (parsed.result as { worktrees?: unknown } | undefined)?.worktrees
    : undefined;
  if (!Array.isArray(worktrees)) {
    throw new Error('herdr worktree list returned invalid schema');
  }
  return worktrees
    .filter(isRecord)
    .filter((w) => typeof w.branch === 'string' && typeof w.path === 'string')
    .map((w) => ({
      branch: w.branch as string,
      path: w.path as string,
      ...(typeof w.open_workspace_id === 'string'
        ? { open_workspace_id: w.open_workspace_id }
        : {}),
    }));
}

/** Parse `worktree create`/`worktree open` → the created/opened worktree path. */
function parseWorktreePath(output: string, command: string): string {
  const parsed = parseJson(output, command);
  const path = isRecord(parsed)
    ? (parsed.result as { worktree?: { path?: unknown } } | undefined)?.worktree
        ?.path
    : undefined;
  if (typeof path !== 'string') {
    throw new Error(`herdr ${command} returned invalid schema`);
  }
  return path;
}

interface PendingRootPane {
  paneId: string;
  tabId?: string;
}

/**
 * Parse `worktree create` → root pane id (+ optional tab id for BB-374
 * overview tab rename). Sibling of {@link parseWorktreePath}. Returns null when
 * the create JSON carries no pane id, so the open-layout caller can skip
 * silently rather than throw (best-effort).
 */
function parseWorktreeRootPane(output: string): PendingRootPane | null {
  const parsed = parseJson(output, 'worktree create');
  if (!isRecord(parsed) || !isRecord(parsed.result)) return null;
  const result = parsed.result as {
    root_pane?: { pane_id?: unknown; tab_id?: unknown };
    tab?: { tab_id?: unknown };
  };
  const paneId = result.root_pane?.pane_id;
  if (typeof paneId !== 'string' || !paneId) return null;
  const tabIdRaw = result.root_pane?.tab_id ?? result.tab?.tab_id;
  const tabId = typeof tabIdRaw === 'string' && tabIdRaw ? tabIdRaw : undefined;
  return tabId !== undefined ? { paneId, tabId } : { paneId };
}

/** Git-safe branch validation: safe ref chars only, no leading dot, no `..`. */
export function validateBranch(branch: string): void {
  if (
    !/^[A-Za-z0-9._/-]+$/.test(branch) ||
    branch.startsWith('.') ||
    branch.includes('..')
  ) {
    throw new Error(`invalid workspace branch: ${branch}`);
  }
}

export class HerdrWorkspace implements BbWorkspace {
  private readonly execHerdr: HerdrExec;
  private readonly execGit: GitExec;
  private readonly root: string;
  private readonly worktreeDir: string;
  private readonly open: OpenLayout;
  private readonly logger: ConductorLogger;
  /**
   * Root panes captured by a FRESH `ensure` create, keyed by worktree path,
   * awaiting {@link applyOpenLayout} (BB-237). One-shot: consumed on apply.
   * Optional `tabId` powers the BB-374 overview tab rename.
   */
  private readonly pendingRootPanes = new Map<string, PendingRootPane>();

  constructor(private readonly options: HerdrWorkspaceOptions) {
    this.execHerdr = options.execHerdr ?? defaultExec;
    this.execGit = options.execGit ?? defaultGitExec;
    this.root = resolve(options.root);
    this.worktreeDir = options.worktreeDir ?? '.bakers-worktrees';
    // `??`, not `||`: an explicit `open: {}` must survive as the opt-out.
    this.open = options.open ?? DEFAULT_OPEN_LAYOUT;
    this.logger = options.logger ?? noopLogger;
  }

  /**
   * Ensure the branch's worktree + herdr workspace exist.
   *
   * `_identifier` is unused HERE: the worktree is located by branch, and since
   * BB-237 the open layout — the one thing that consumed the identifier, to
   * render `{identifier}` (BB-234) — is applied by {@link applyOpenLayout},
   * which takes it on its own `ctx`. The parameter stays because it is the
   * `BbWorkspace.ensure` contract position (the git workspace does use it).
   * It is still taken as-passed rather than parsed back out of `branch`, which
   * remains the reason the contract carries it at all.
   */
  async ensure(
    _identifier: string,
    branch?: string,
    baseRefOverride?: string,
  ): Promise<EnsuredWorkspace> {
    if (branch === undefined) {
      throw new Error('herdr workspace requires a branch name');
    }
    validateBranch(branch);
    const extra = this.options.autoSetupMerge
      ? {}
      : { env: await runBranchGit(this.root, this.logger) };

    const worktrees = parseWorktreeList(
      await this.execHerdr(['worktree', 'list', '--cwd', this.root, '--json']),
    );
    const existing = worktrees.find((w) => w.branch === branch);

    if (existing) {
      // Reuse: an existing worktree is never re-created, so created=false — the
      // core skips after_create only when a success is recorded for it. The open layout is NOT
      // re-applied on reuse (BB-139): no duplicate editor process on reattach.
      let path = existing.path;
      if (!existing.open_workspace_id) {
        // On-disk worktree with no open herdr workspace — open it.
        path = parseWorktreePath(
          await this.execHerdr([
            'worktree',
            'open',
            '--cwd',
            this.root,
            '--branch',
            branch,
            '--no-focus',
            '--json',
          ]),
          'worktree open',
        );
      }
      return {
        path,
        instructions: loadInstructions(path),
        created: false,
        ...extra,
      };
    }

    // Fresh: create the git worktree + herdr workspace in one call. Base the
    // new branch on the (freshly fetched) remote tracking branch, not the
    // host's local checked-out branch. A ticket passes its `origin/<base_branch>`
    // as the override; use it only when it resolves on the remote, else fall
    // back to the default base.
    const baseRef = await resolveBaseRef(this.root, this.execGit, {
      ...(this.options.baseBranch
        ? { baseBranch: this.options.baseBranch }
        : {}),
      ...(baseRefOverride !== undefined ? { override: baseRefOverride } : {}),
    });
    const createOutput = await this.execHerdr([
      'worktree',
      'create',
      '--cwd',
      this.root,
      '--branch',
      branch,
      ...(baseRef !== undefined ? ['--base', baseRef] : []),
      '--label',
      branch,
      // ABSOLUTE, never relative: herdr canonicalizes a relative `--path`
      // against its own `current_dir()`, which fails with
      // `Os { code: 2, kind: NotFound }` whenever the CALLER's cwd has been
      // deleted — e.g. a conductor still polling from a reaped worktree. That
      // killed every dispatch with an unattributable herdr exit 1. `resolve`
      // (not `join`) so an absolute `worktreeDir` override still wins.
      '--path',
      resolve(this.root, this.worktreeDir, branch),
      '--no-focus',
      '--json',
    ]);
    const path = parseWorktreePath(createOutput, 'worktree create');

    // BB-237: CAPTURE the fresh root pane here, but do NOT lay it out yet.
    // The layout's startup command names the bakers CLI, which the `after_create`
    // hook builds — and that hook runs after `ensure()` returns. Applying the
    // layout here fired the command before its binary existed, which is why the
    // pane command needed a sentinel wait loop. The conductor now calls
    // `applyOpenLayout` after the hook; a create with no root pane in its output
    // stores nothing, so the layout is a no-op exactly as before.
    const pending = parseWorktreeRootPane(createOutput);
    if (pending) {
      this.pendingRootPanes.set(path, pending);
    }

    // The `after_create` hook is run by the executor (BB-84), not here — the
    // workspace only reports that it created a fresh worktree.
    return {
      path,
      instructions: loadInstructions(path),
      created: true,
      ...extra,
    };
  }

  /**
   * Apply the open layout to the root pane captured by the most recent
   * {@link ensure} create for `path` — by default (BB-234) the ticket's
   * `bakers ui` deep link, so the tab shows the ticket instead of a bare shell.
   * The pane's cwd is the worktree checkout, passed explicitly on the splits
   * (the root pane's cwd is already the checkout).
   *
   * BB-374 then renames the overview tab (`{identifier} · {title}` with title
   * capped at {@link OPEN_TAB_TITLE_MAX}) and root pane (full
   * `{identifier} · {title}`) — fresh-create only, same gate as the layout.
   *
   * NO stored pane ⇒ silent no-op. That is the reused-worktree case: `ensure`
   * took the reuse branch, there is no fresh root pane, and re-applying would
   * start a duplicate editor process on reattach (BB-139). The capture is
   * one-shot — consumed here — so a repeat call cannot double-apply and the map
   * cannot grow without bound.
   *
   * Best-effort — mirrors the `fetchBaseRef` pattern: a broken layout is logged
   * and swallowed so a startup-command failure can NEVER wedge dispatch.
   */
  async applyOpenLayout(
    path: string,
    ctx: { identifier: string; branch: string; title: string },
  ): Promise<void> {
    const pending = this.pendingRootPanes.get(path);
    if (!pending) {
      return;
    }
    this.pendingRootPanes.delete(path);
    const { paneId: rootPaneId } = pending;
    try {
      // Render the ROOT command here (spec D2). `applyPaneLayout` types its
      // root command verbatim for the executor's brace-bearing env-prefixed
      // agent command, so templating it there would corrupt that; the split
      // commands it already renders from the same `vars`.
      const vars = {
        identifier: ctx.identifier,
        branch: ctx.branch,
        title: ctx.title,
        worktreePath: path,
      };
      const layout: OpenLayout = {
        ...this.open,
        ...(this.open.command !== undefined
          ? { command: renderTemplate(this.open.command, vars) }
          : {}),
      };
      await applyPaneLayout(this.execHerdr, rootPaneId, layout, path, vars);
      await this.applyOverviewLabels(rootPaneId, pending.tabId, vars);
    } catch (err) {
      this.logger.warn(
        { branch: ctx.branch, worktree: path, err: String(err) },
        'herdr open-layout failed (best-effort, ignored)',
      );
    }
  }

  /**
   * Best-effort overview tab + pane renames (BB-374). Skipped for the
   * `open: {}` opt-out. A missing create-time tab id falls back to `pane get`.
   */
  private async applyOverviewLabels(
    rootPaneId: string,
    createTabId: string | undefined,
    vars: Record<string, string>,
  ): Promise<void> {
    const emptyOptOut =
      this.open.command === undefined &&
      !this.open.panes?.length &&
      this.open.tabLabel === undefined &&
      this.open.panelLabel === undefined;
    if (emptyOptOut) {
      return;
    }

    // Tab bar is always visible; cap title length and mark truncation with
    // `...`. Pane/panel label keeps the full title for pane borders.
    const tabVars = {
      ...vars,
      title: truncateOpenTabTitle(vars.title ?? ''),
    };
    const tabLabel = renderTemplate(
      this.open.tabLabel ?? DEFAULT_OPEN_TAB_LABEL,
      tabVars,
    );
    const panelLabel = renderTemplate(
      this.open.panelLabel ?? DEFAULT_OPEN_PANEL_LABEL,
      vars,
    );

    let tabId = createTabId;
    if (!tabId) {
      try {
        tabId = (await this.resolveTabIdForPane(rootPaneId)) ?? undefined;
      } catch (err) {
        this.logger.warn(
          { paneId: rootPaneId, err: String(err) },
          'herdr overview tab id lookup failed (best-effort, ignored)',
        );
      }
    }
    if (tabId) {
      try {
        await this.execHerdr(['tab', 'rename', tabId, tabLabel]);
      } catch (err) {
        this.logger.warn(
          { tabId, err: String(err) },
          'herdr overview tab rename failed (best-effort, ignored)',
        );
      }
    }

    try {
      await this.execHerdr(['pane', 'rename', rootPaneId, panelLabel]);
    } catch (err) {
      this.logger.warn(
        { paneId: rootPaneId, err: String(err) },
        'herdr overview pane rename failed (best-effort, ignored)',
      );
    }
  }

  /** `pane get <id>` → `result.pane.tab_id` when present. */
  private async resolveTabIdForPane(paneId: string): Promise<string | null> {
    const output = await this.execHerdr(['pane', 'get', paneId, '--json']);
    const parsed = parseJson(output, 'pane get');
    const tabId = isRecord(parsed)
      ? (parsed.result as { pane?: { tab_id?: unknown } } | undefined)?.pane
          ?.tab_id
      : undefined;
    return typeof tabId === 'string' && tabId ? tabId : null;
  }
}

export function herdrWorkspace(
  opts: {
    /**
     * Explicit repo-root override; wins over the git-derived anchor. Otherwise
     * the main clone is derived from the git common dir (BB-177).
     */
    root?: string;
    worktreeDir?: string;
    baseBranch?: string;
    open?: OpenLayout;
    autoSetupMerge?: boolean;
    /** Overrideable git exec for root derivation (tests). */
    execGit?: RootGitExec;
    /** Overrideable herdr exec (tests) — sibling of `execGit`. */
    execHerdr?: HerdrExec;
  } = {},
): WorkspacePlugin {
  return {
    kind: 'workspace',
    id: 'herdr',
    requiredModules: [],
    // BB-234: `deps` carries the conductor logger, so the best-effort
    // open-layout failure is actually logged instead of vanishing into the noop
    // logger. Optional per the contract — absent, the noop default stays.
    async createWorkspace(config: ConductorFileConfig, deps?: ExecutorDeps) {
      const root = await deriveHerdrRoot(config.config_path, {
        ...(opts.root !== undefined ? { override: opts.root } : {}),
        ...(opts.execGit ? { execGit: opts.execGit } : {}),
      });
      return new HerdrWorkspace({
        root,
        ...(opts.worktreeDir ? { worktreeDir: opts.worktreeDir } : {}),
        ...(opts.baseBranch ? { baseBranch: opts.baseBranch } : {}),
        ...(opts.open ? { open: opts.open } : {}),
        ...(opts.execHerdr ? { execHerdr: opts.execHerdr } : {}),
        ...(opts.autoSetupMerge ? { autoSetupMerge: true } : {}),
        ...(deps?.logger ? { logger: deps.logger } : {}),
      });
    },
  };
}

export default herdrWorkspace;
