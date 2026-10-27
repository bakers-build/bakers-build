import type { RootGitExec } from '@bakers-build/core';

export interface OrcaStateConfig {
  /**
   * Terminal title template; must contain `{identifier}`. Other vars:
   * `{title}`, `{titleSlug}`, `{runUuid}`, `{workspacePath}`. `startRun`
   * appends ` #<run.id>`, the token `cleanupRun` finds the run's terminal by.
   */
  tabLabel?: string;
}

export interface OrcaExecutorOptions {
  /** Fallback agent command when the conductor supplies none. */
  command?: string;
  /** Lifecycle-hook commands, copied from `config.hooks` by the factory. */
  hooks?: {
    after_create?: string;
    before_run?: string;
    after_run?: string;
    after_done?: string;
    on_freeze?: string;
    on_resume?: string;
  };
  /** Main clone; otherwise derived from the git common dir by the factory. */
  root?: string;
  /** Overrideable git exec for root derivation (tests). */
  execGit?: RootGitExec;
  default?: OrcaStateConfig;
  states?: Record<string, OrcaStateConfig>;
  /** Same windows as herdr: wait for `started` (60 s), then an exit window (4 s). */
  launchWatch?: {
    timeoutMs?: number;
    startTimeoutMs?: number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<void>;
  };
  /** How long `startRun` waits for Orca to adopt the worktree. Default 35 s. */
  adoptTimeoutMs?: number;
}

export const DEFAULT_TAB_LABEL = '{identifier} · {titleSlug}';

export function resolveTabLabel(
  options: OrcaExecutorOptions,
  state: string,
): string {
  const tabLabel =
    options.states?.[state]?.tabLabel ??
    options.default?.tabLabel ??
    DEFAULT_TAB_LABEL;
  if (!tabLabel.includes('{identifier}')) {
    throw new Error(`orca tabLabel must contain {identifier}: ${tabLabel}`);
  }
  return tabLabel;
}
