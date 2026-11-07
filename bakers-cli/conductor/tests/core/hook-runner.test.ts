import { describe, expect, it } from 'vitest';
import { shellHookRunner } from '../../src/core/hook-runner.js';

// The conductor owns lifecycle-hook invocation, best-effort. These cases moved
// here from the herdr and orca executors, which no longer run hooks.
describe('shellHookRunner (best-effort)', () => {
  interface ErrLog {
    obj: Record<string, unknown>;
    msg?: string;
  }
  function spyLogger() {
    const errors: ErrLog[] = [];
    return {
      errors,
      logger: {
        debug() {},
        info() {},
        warn() {},
        error(obj: object, msg?: string) {
          errors.push({ obj: obj as Record<string, unknown>, msg });
        },
      },
    };
  }

  it('logs an error (name+worktree+ticket) and does NOT throw when the command fails', async () => {
    const { logger, errors } = spyLogger();
    const ran: Array<{ command: string; cwd: string }> = [];
    const runShell = async (command: string, cwd: string) => {
      ran.push({ command, cwd });
      throw new Error('hook boom'); // the command fails honestly
    };
    const runHook = shellHookRunner(
      { after_create: 'make worktree' },
      logger,
      runShell,
    );

    // BB-237 AC-6: never throws, but REPORTS the outcome so the caller can
    // record the failure against the run.
    await expect(
      runHook('after_create', '/wt/x', { ticket: 'BB-1' }),
    ).resolves.toMatchObject({ hook: 'after_create', ran: true, ok: false });

    expect(ran).toEqual([{ command: 'make worktree', cwd: '/wt/x' }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.msg).toBe('lifecycle hook failed');
    expect(errors[0]?.obj).toMatchObject({
      hook: 'after_create',
      worktree: '/wt/x',
      ticket: 'BB-1',
    });
    expect(String(errors[0]?.obj.err)).toContain('hook boom');
  });

  it('is a silent no-op when no command is configured for the hook', async () => {
    const { logger, errors } = spyLogger();
    const ran: string[] = [];
    const runShell = async (command: string) => {
      ran.push(command);
    };
    const runHook = shellHookRunner({}, logger, runShell);

    const result = await runHook('before_run', '/wt/x', { ticket: 'BB-1' });

    expect(ran).toEqual([]);
    expect(errors).toEqual([]);
    // BB-237: "nothing configured" is reported as ran=false / ok=true, so the
    // caller can tell an unconfigured slot from a successful command.
    expect(result).toEqual({ hook: 'before_run', ran: false, ok: true });
  });

  it('is a silent no-op when the config has no hooks at all', async () => {
    const { logger } = spyLogger();
    const runHook = shellHookRunner(undefined, logger, async () => {
      throw new Error('must not run');
    });
    await expect(
      runHook('after_create', '/w', { ticket: 'BAKERS-1' }),
    ).resolves.toEqual({ hook: 'after_create', ran: false, ok: true });
  });

  it('runs the configured command in the given cwd on success', async () => {
    const { logger, errors } = spyLogger();
    const ran: Array<{ command: string; cwd: string }> = [];
    const runShell = async (command: string, cwd: string) => {
      ran.push({ command, cwd });
    };
    const runHook = shellHookRunner(
      { after_done: 'make clean' },
      logger,
      runShell,
    );

    const result = await runHook('after_done', '/wt/done', { ticket: 'BB-9' });

    expect(ran).toEqual([{ command: 'make clean', cwd: '/wt/done' }]);
    expect(errors).toEqual([]);
    expect(result).toEqual({ hook: 'after_done', ran: true, ok: true });
  });

  it('forwards the resolved run env to the shell runner (BB-99)', async () => {
    const { logger, errors } = spyLogger();
    const seen: Array<Record<string, string> | undefined> = [];
    const runShell = async (
      _command: string,
      _cwd: string,
      env?: Record<string, string>,
    ) => {
      seen.push(env);
    };
    const runHook = shellHookRunner(
      { before_run: 'echo hi' },
      logger,
      runShell,
    );

    await runHook(
      'before_run',
      '/wt/x',
      { ticket: 'BB-1' },
      { DRUPAL11_DB_URL: 'mysql://a' },
    );

    expect(seen).toEqual([{ DRUPAL11_DB_URL: 'mysql://a' }]);
    expect(errors).toEqual([]);
  });

  it('reports a failing hook without logging env values', async () => {
    const { logger, errors } = spyLogger();
    const runHook = shellHookRunner(
      { before_run: 'exit 3' },
      logger,
      async () => {
        throw new Error('hook exited 3');
      },
    );
    const result = await runHook(
      'before_run',
      '/w',
      { ticket: 'BAKERS-1' },
      { SECRET: 'hunter2' },
    );
    expect(result).toMatchObject({ hook: 'before_run', ran: true, ok: false });
    expect(result.error).toContain('hook exited 3');
    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors)).not.toContain('hunter2');
  });
});
