import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ConductorLogger } from './logger.js';

const execFileAsync = promisify(execFile);

export class ExecError extends Error {
  constructor(
    readonly file: string,
    readonly args: string[],
    readonly exitCode: number | null,
    readonly stderr: string,
    options?: { cause?: unknown },
  ) {
    // Include exitCode + stderr in the message so a stringified ExecError
    // (e.g. bb_run.error_log = String(err)) carries the ACTUAL cause, not a
    // bare "exec failed: herdr". Args are omitted on purpose — they can embed
    // secrets (herdr's `KEY='value' <agent>` pane-run string, BB-99); stderr
    // is the tool's own diagnostic output and is trimmed.
    const detail = stderr.trim();
    super(
      `exec failed: ${file} (exit ${exitCode ?? 'null'})${detail ? `: ${detail}` : ''}`,
      options,
    );
    this.name = 'ExecError';
  }
}

export interface ExecOpts {
  signal?: AbortSignal;
  cwd?: string;
  env?: Record<string, string>;
  /**
   * Rewrite the args used for *logging* (both the `exec ok` debug line and the
   * `exec failed` error line). The real args are always executed unchanged.
   * Use this when an arg embeds a secret — e.g. herdr's `pane run` command
   * string `KEY='value' claude` (BB-99) — so a failed exec never writes the
   * secret to the log.
   */
  redactArgs?: (args: string[]) => string[];
  /** Written to the child's stdin, which is then closed. */
  input?: string;
}

export class CommandRunner {
  constructor(private readonly logger: ConductorLogger) {}

  async run(
    file: string,
    args: string[],
    opts: ExecOpts = {},
  ): Promise<string> {
    // Args can themselves carry secrets (herdr embeds `KEY='value'` in the
    // pane-run command string — BB-99). `redactArgs` rewrites the args used
    // for logging only; the real args are still executed verbatim.
    const logArgs = opts.redactArgs ? opts.redactArgs(args) : args;
    try {
      const { env, redactArgs: _redact, input, ...rest } = opts;
      // Merge over process.env, never replace it: a caller-supplied env adds/
      // overrides keys but the child still inherits PATH etc. Values may be
      // sensitive (BB-99) — never log them; only cwd is logged below.
      const childEnv = env ? { ...process.env, ...env } : undefined;
      const pending = execFileAsync(file, args, {
        encoding: 'utf8',
        ...rest,
        ...(childEnv ? { env: childEnv } : {}),
      });
      if (input !== undefined) pending.child.stdin?.end(input);
      const { stdout } = await pending;
      this.logger.debug({ file, args: logArgs, cwd: opts.cwd }, 'exec ok');
      return stdout;
    } catch (err) {
      const e = err as { code?: string | number; stderr?: string };
      const exitCode = typeof e.code === 'number' ? e.code : null;
      const stderr = e.stderr ?? '';
      this.logger.error(
        { file, args: logArgs, cwd: opts.cwd, exitCode, stderr },
        'exec failed',
      );
      throw new ExecError(file, args, exitCode, stderr, { cause: err });
    }
  }
}

const noopLogger: ConductorLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

let defaultRunner = new CommandRunner(noopLogger);

/**
 * Replace the module-level singleton runner used by {@link exec}.
 *
 * Note: out-of-package plugins (e.g. `@bakers-build/addon-herdr`) import `exec` via
 * the `@bakers-build/bakers/plugin` barrel, which resolves to the built `dist/`
 * copy of this module. This means `setDefaultCommandRunner` only shares the
 * runner with those plugins when the conductor itself runs from `dist`
 * (production / after `pnpm build`). Under `tsx`/dev, the entry point loads
 * this module from source while the plugin loads it from dist — two separate
 * module instances — so plugin exec calls fall back to the noop logger.
 * This is functionally harmless; logging only.
 */
export function setDefaultCommandRunner(r: CommandRunner): void {
  defaultRunner = r;
}

export function exec(
  file: string,
  args: string[],
  opts: ExecOpts = {},
): Promise<string> {
  return defaultRunner.run(file, args, opts);
}
