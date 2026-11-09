import { type ConductorLogger, exec } from '@bakers-build/core';
import type { HookContext, HookName, HookResult } from '../plugins/executor.js';
import type { ConductorSettings } from '../types.js';

/** Runs a lifecycle-hook shell command in a cwd; rejects on non-zero exit. */
export type ShellRunner = (
  command: string,
  cwd: string,
  env?: Record<string, string>,
) => Promise<void>;

/**
 * Runs the project shell hook of one lifecycle slot. The SINGLE catch point for
 * all lifecycle hooks:
 *
 * - NEVER throws. No configured command → silent no-op. A failing command →
 *   `logger.error({hook,worktree,ticket,err}, 'lifecycle hook failed')`, so a
 *   hook failure never aborts dispatch or wedges a run in `claimed`.
 * - Reports the outcome as a {@link HookResult} (BB-237): the caller decides
 *   what a failure means for the run it is dispatching.
 *
 * `env`, when given, is the run's resolved environment, merged over the hook
 * process's inherited env. Values may be secret: only key names are ever logged.
 */
export type HookRunner = (
  name: HookName,
  cwd: string,
  ctx: HookContext,
  env?: Record<string, string>,
) => Promise<HookResult>;

/** Default shell runner: `sh -c <command>` in the worktree — fails honestly. */
export const defaultShellRunner: ShellRunner = async (command, cwd, env) => {
  await exec('sh', ['-c', command], { cwd, ...(env ? { env } : {}) });
};

/** The conductor's hook runner over the project's `hooks` commands. */
export function shellHookRunner(
  hooks: ConductorSettings['hooks'],
  logger: ConductorLogger,
  runShell: ShellRunner = defaultShellRunner,
): HookRunner {
  return async (name, cwd, ctx, env) => {
    const command = hooks?.[name];
    if (!command) {
      return { hook: name, ran: false, ok: true };
    }
    try {
      await runShell(command, cwd, env);
      return { hook: name, ran: true, ok: true };
    } catch (err) {
      logger.error(
        { hook: name, worktree: cwd, ticket: ctx.ticket, err: String(err) },
        'lifecycle hook failed',
      );
      return { hook: name, ran: true, ok: false, error: String(err) };
    }
  };
}
