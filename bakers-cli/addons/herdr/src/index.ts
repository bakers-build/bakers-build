import { rmSync } from 'node:fs';
import type {
  BbExecutor,
  ExecutorCapabilities,
  ExecutorPlugin,
  OpenWorkspaceContext,
  SpawnedSession,
  SpawnRunInput,
} from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { exec, shellQuote, slugify } from '@bakers-build/core';
import {
  type HerdrExecutorOptions,
  type ResolvedConfig,
  renderTemplate,
  resolveStateConfig,
} from './config.js';
import {
  type LaunchScript,
  watchLaunch,
  writeLaunchScript,
} from './launch-script.js';
import {
  applyOpenLayout,
  DEFAULT_OPEN_LAYOUT,
  isEmptyLayout,
  parseFirstPane,
  parseRootPane,
  type RootPane,
} from './open-layout.js';
import {
  applyPaneLayout,
  type HerdrExec,
  isRecord,
  parseJson,
} from './pane-layout.js';
import { AGENT_SHELL_ENV, envArgs } from './panes.js';
import { deriveHerdrRoot } from './root-anchor.js';
import {
  listWorktrees,
  resolveWorktreeEntry,
  type WorktreeEntry,
} from './worktrees.js';

export { DEFAULT_OPEN_LAYOUT, type OpenLayout } from './open-layout.js';
export type { HerdrExec } from './pane-layout.js';
export { envArgs } from './panes.js';
// BB-139: the herdr workspace lives in the same package now (the separate
// @bakers-build/addon-herdr-workspace was merged in). The package DEFAULT export
// stays the executor (below); herdrWorkspace + HerdrWorkspace are named exports.
export {
  HerdrWorkspace,
  type HerdrWorkspaceOptions,
  herdrWorkspace,
} from './workspace.js';
export { parseWorkspaceList, type WorkspaceEntry } from './workspace-list.js';

async function defaultExec(
  args: string[],
  opts?: { redactArgs?: (args: string[]) => string[] },
): Promise<string> {
  return exec('herdr', args, opts);
}

const noopLogger: ConductorLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

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

export class HerdrExecutor implements BbExecutor {
  readonly id = 'herdr';

  constructor(
    private readonly options: HerdrExecutorOptions,
    private readonly execHerdr: HerdrExec = defaultExec,
    private readonly logger: ConductorLogger = noopLogger,
  ) {}

  capabilities(): ExecutorCapabilities {
    return { persistent: true };
  }

  /** List worktrees anchored to the parent repo root (see {@link listWorktrees}). */
  private listWorktrees(): Promise<WorktreeEntry[]> {
    return listWorktrees(this.execHerdr, this.options.root);
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

  /**
   * Lay out a freshly created worktree's herdr workspace with the `open`
   * layout (BB-139/BB-234) — after `after_create`, which builds what the layout
   * command may name (BB-237). The worktree may come from any workspace: its
   * herdr workspace is found by path (falling back to `branch`), or opened from
   * the parent repo root when none is open yet. Best-effort: nothing resolvable
   * is a silent no-op, a failure is logged and swallowed.
   */
  async openWorkspace(path: string, ctx: OpenWorkspaceContext): Promise<void> {
    // `??`, not `||`: an explicit `open: {}` must survive as the opt-out.
    const open = this.options.open ?? DEFAULT_OPEN_LAYOUT;
    if (isEmptyLayout(open)) {
      return;
    }
    let root: RootPane | null = null;
    try {
      const entry = resolveWorktreeEntry(
        await this.listWorktrees(),
        ctx.branch,
        path,
      );
      if (entry?.open_workspace_id) {
        root = parseFirstPane(
          await this.execHerdr([
            'pane',
            'list',
            '--workspace',
            entry.open_workspace_id,
          ]),
        );
      } else {
        root = parseRootPane(
          await this.execHerdr([
            'worktree',
            'open',
            '--cwd',
            this.options.root ?? path,
            '--branch',
            ctx.branch,
            '--no-focus',
            '--json',
          ]),
          'worktree open',
        );
      }
    } catch (err) {
      this.logger.warn(
        { branch: ctx.branch, worktree: path, err: String(err) },
        'herdr open-layout failed (best-effort, ignored)',
      );
      return;
    }
    if (!root) {
      return;
    }
    await applyOpenLayout(this.execHerdr, this.logger, open, root, path, ctx);
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
    //    loop. Mirrors the teardown's reattach. Fall back to the linked path
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
   * The branch worktree is untouched (that is `HerdrWorkspace.remove`).
   */
  async cleanupRun(branch: string, runId: number): Promise<void> {
    const match = await this.runTab(branch, runId);
    if (!match) {
      return; // no tab for this run — quiet best-effort no-op (AC-4)
    }
    try {
      await this.execHerdr(['tab', 'close', match.tabId]);
    } catch {
      // ignore — best-effort: a failing tab-close must not abort finalisation
    }
  }

  /**
   * Whether a pane of the run's tab still runs the run's launch wrapper; a
   * failing `herdr` call throws. After a server restart herdr restores tabs as
   * bare shells, or resumes the agent itself without the run's flags and
   * tools, so an open tab alone does not mean the run lives.
   */
  async runAlive(branch: string, runId: number): Promise<boolean> {
    const tab = await this.runTab(branch, runId);
    if (!tab) {
      return false;
    }
    const listed = parseJson(
      await this.execHerdr(['pane', 'list', '--workspace', tab.workspaceId]),
      'pane list',
    );
    const panes = isRecord(listed)
      ? (listed.result as { panes?: unknown } | undefined)?.panes
      : undefined;
    for (const pane of Array.isArray(panes) ? panes.filter(isRecord) : []) {
      if (pane.tab_id !== tab.tabId || typeof pane.pane_id !== 'string') {
        continue;
      }
      const info = parseJson(
        await this.execHerdr(['pane', 'process-info', '--pane', pane.pane_id]),
        'pane process-info',
      );
      const procs = isRecord(info)
        ? (
            info.result as
              | { process_info?: { foreground_processes?: unknown } }
              | undefined
          )?.process_info?.foreground_processes
        : undefined;
      const wrapper = /\/bakers-run-[^/]+\/run\.sh$/;
      if (
        Array.isArray(procs) &&
        procs.some(
          (p) =>
            isRecord(p) &&
            Array.isArray(p.argv) &&
            p.argv.some((a) => typeof a === 'string' && wrapper.test(a)),
        )
      ) {
        return true;
      }
    }
    return false;
  }

  /** The branch workspace's tab labelled `#<runId>`, or null. */
  private async runTab(
    branch: string,
    runId: number,
  ): Promise<(HerdrTab & { workspaceId: string }) | null> {
    const workspaceId = await this.findWorkspaceByBranch(branch);
    if (!workspaceId) {
      return null;
    }
    const tabs = parseTabList(
      await this.execHerdr(['tab', 'list', '--workspace', workspaceId]),
    );
    const tab = tabs.find((t) => labelMatchesRun(t.label, runId));
    return tab ? { ...tab, workspaceId } : null;
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
      // Hooks used to ride on this addon's options; now only the conductor runs
      // them, so a leftover would drop silently. Fail loudly instead.
      if ((options as { hooks?: unknown }).hooks !== undefined) {
        throw new Error(
          "@bakers-build/addon-herdr no longer takes `with.hooks`: move them to the conductor config's top-level `hooks`",
        );
      }
      // Derive the parent repo root via the single shared anchor (BB-177) so
      // worktree open reattaches from the main clone, not the linked worktree
      // — identical derivation to the sibling herdrWorkspace.
      const root = await deriveHerdrRoot(config.config_path, {
        ...(options.root !== undefined ? { override: options.root } : {}),
        ...(options.execGit ? { execGit: options.execGit } : {}),
      });
      return new HerdrExecutor(
        {
          command: options.command ?? 'claude',
          root,
          ...(options.open ? { open: options.open } : {}),
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
