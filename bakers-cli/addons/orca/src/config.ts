import type { LaunchWatchOptions } from '@bakers-build/addon-herdr/shared';
import type { RootGitExec } from '@bakers-build/core';
import type { OrcaOpenLayout } from './workspace.js';

export interface OrcaStateConfig {
  /**
   * Terminal title template; must contain `{identifier}`. Other vars:
   * `{state}` (the state the run was started for), `{title}`, `{title_slug}`,
   * `{run_uuid}`, `{workspace_path}`. `startRun`
   * appends ` #<run.id>`, the token `cleanupRun` finds the run's terminal by.
   */
  tab_label?: string;
}

export interface OrcaExecutorOptions {
  /** Fallback agent command when the conductor supplies none. */
  command?: string;
  /** Overview terminal of a fresh worktree. Unset → `DEFAULT_OPEN_LAYOUT`. */
  open?: OrcaOpenLayout;
  /** Main clone; otherwise derived from the git common dir by the factory. */
  root?: string;
  /** Overrideable git exec for root derivation (tests). */
  execGit?: RootGitExec;
  default?: OrcaStateConfig;
  states?: Record<string, OrcaStateConfig>;
  /** Same windows as herdr: wait for `started` (60 s), then an exit window (4 s). */
  launch_watch?: Omit<LaunchWatchOptions, 'readPane'>;
  /** How long `startRun` waits for Orca to adopt the worktree. Default 35 s. */
  adopt_timeout_ms?: number;
}

export const DEFAULT_TAB_LABEL = '{identifier} · {state}';

export function resolveTabLabel(
  options: OrcaExecutorOptions,
  state: string,
): string {
  const tabLabel =
    options.states?.[state]?.tab_label ??
    options.default?.tab_label ??
    DEFAULT_TAB_LABEL;
  if (!tabLabel.includes('{identifier}')) {
    throw new Error(`orca tab_label must contain {identifier}: ${tabLabel}`);
  }
  return tabLabel;
}
