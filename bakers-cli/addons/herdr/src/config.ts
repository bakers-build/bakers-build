import type { OpenLayout } from './open-layout.js';
import type { RootGitExec } from './root-anchor.js';

export interface PaneSpec {
  direction: 'right' | 'down';
  command: string;
  focus?: boolean;
}

export interface StateConfig {
  /**
   * Tab label template. Must contain {identifier} — the conductor matches a
   * run's tab by its ticket identifier (stop/state), so the identifier is the
   * stable anchor in the visible name. Other vars: {title}, {titleSlug},
   * {runUuid}, {repoName}, {workspacePath}.
   */
  tabLabel?: string;
  workspaceLabel?: string;
  /**
   * Root-pane (panel) label template applied via `herdr pane rename` after the
   * state tab is created (BB-374). Default `{title}`. Distinct from
   * {@link tabLabel}: stop/state matching still anchors on the tab label.
   */
  panelLabel?: string;
  /** Extra layout panes (diff/logs); NOT the agent command. */
  panes?: PaneSpec[];
}

export interface HerdrExecutorOptions {
  /** Legacy fallback for input.command. */
  command?: string;
  /**
   * Startup layout for a fresh worktree's initial pane, applied by
   * `openWorkspace` (BB-139). Unset → `DEFAULT_OPEN_LAYOUT`
   * (`bakers ui --ticket <ID>`, BB-234); `{}` → the bare empty tab.
   */
  open?: OpenLayout;
  /**
   * The parent repo root (main clone) — herdr `--cwd` target for reattaching a
   * closed worktree. herdr rejects a `worktree open` whose --cwd is a linked
   * worktree (`linked_worktree_source`): open/new must start from the parent
   * workspace. When unset the factory derives it from the git common dir
   * (BB-177), exactly like the sibling `herdrWorkspace` plugin; this override
   * always wins.
   */
  root?: string;
  /** Overrideable git exec for root derivation (tests). */
  execGit?: RootGitExec;
  default?: StateConfig;
  states?: Record<string, StateConfig>;
  /**
   * Launch-watch windows. `startTimeoutMs` is how long startRun waits for the
   * wrapper to write `started` (default 60s, so a slow interactive shell can
   * finish rc). `timeoutMs` is the short window after `started` in which an
   * immediate agent exit fails the launch (default 4000 ms). Tests inject
   * shorter windows, including `timeoutMs: 0` to skip the exit wait.
   */
  launchWatch?: {
    timeoutMs?: number;
    startTimeoutMs?: number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<void>;
  };
}

export interface ResolvedConfig {
  tabLabel: string;
  workspaceLabel: string;
  panelLabel: string;
  panes: PaneSpec[];
}

export const BUILTIN_DEFAULTS: ResolvedConfig = {
  tabLabel: '{identifier} · {titleSlug}',
  workspaceLabel: '{repoName}',
  panelLabel: '{title}',
  panes: [],
};

export function resolveStateConfig(
  options: HerdrExecutorOptions,
  state: string,
): ResolvedConfig {
  const base = options.default ?? {};
  const stateCfg = options.states?.[state] ?? {};
  return {
    tabLabel: stateCfg.tabLabel ?? base.tabLabel ?? BUILTIN_DEFAULTS.tabLabel,
    workspaceLabel:
      stateCfg.workspaceLabel ??
      base.workspaceLabel ??
      BUILTIN_DEFAULTS.workspaceLabel,
    panelLabel:
      stateCfg.panelLabel ?? base.panelLabel ?? BUILTIN_DEFAULTS.panelLabel,
    panes: stateCfg.panes ?? base.panes ?? BUILTIN_DEFAULTS.panes,
  };
}

export function renderTemplate(
  tpl: string,
  vars: Record<string, string>,
): string {
  return tpl.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = vars[key];
    return value === undefined ? whole : value;
  });
}

export function assertTabLabelTemplate(tabLabel: string): void {
  if (!tabLabel.includes('{identifier}')) {
    throw new Error(
      `herdr tabLabel must contain {identifier} for stop/state matching: ${tabLabel}`,
    );
  }
}
