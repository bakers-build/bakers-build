import { join } from 'node:path';
import pino from 'pino';
import pretty from 'pino-pretty';
import { resolveCliVersion } from '../cli/version-check.js';
import { configHomeOf } from './checkout-root.js';

export type LogSink =
  | { kind: 'stdout' }
  | { kind: 'file'; path: string }
  /**
   * Tee: pretty stdout AND the durable `log.txt`. The DEFAULT on a TTY since
   * BB-237 — see {@link resolveSink}.
   */
  | { kind: 'both'; path: string };

export interface ConductorLogger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/**
 * Pick the log sink. Precedence: explicit CLI override (`sink`) > the
 * BB_CONDUCTOR_LOG env var > default (`both` on a TTY, `file` otherwise).
 *
 * BB-237: the TTY default used to be stdout-ONLY, which made the conductor's
 * own diagnostics non-durable exactly where it normally runs — inside a herdr
 * pane, which IS a TTY. A well-formed `lifecycle hook failed` record (hook +
 * worktree + ticket + err) was therefore written nowhere and died with the pane,
 * so an aborting worktree bootstrap left no trace to find. The default now tees:
 * the operator keeps pretty stdout AND the record lands in `log.txt`. An
 * EXPLICIT `stdout` / `file` (CLI flag or BB_CONDUCTOR_LOG) keeps its exact
 * previous meaning — one stream, chosen deliberately.
 *
 * BB-450 D4: `checkoutRoot` is now genuinely the checkout root (its `.bakers`
 * config directory used to be stored under that name and is widened here), so
 * the log path appends `.bakers/log.txt` itself rather than taking a caller's
 * `.bakers`-flavoured root as `log.txt`'s direct parent — the physical file stays
 * the same one on a standard layout.
 */
export function resolveSink(
  env: NodeJS.ProcessEnv,
  isTTY: boolean,
  checkoutRoot: string,
  override?: string,
): LogSink {
  const path = join(configHomeOf(checkoutRoot), 'log.txt');
  const choice = override ?? env.BB_CONDUCTOR_LOG;
  if (choice === 'stdout') return { kind: 'stdout' };
  if (choice === 'file') return { kind: 'file', path };
  if (choice === 'both') return { kind: 'both', path };
  return isTTY ? { kind: 'both', path } : { kind: 'file', path };
}

/**
 * Pick the log level. Precedence: explicit CLI override (`level`) >
 * the BB_LOG_LEVEL env var > info.
 */
export function resolveLevel(
  env: NodeJS.ProcessEnv,
  override?: string,
): string {
  return override ?? env.BB_LOG_LEVEL ?? 'info';
}

export function createLogger(opts: {
  checkoutRoot: string;
  isTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  /** CLI override for the level — beats env + default. */
  level?: string;
  /** CLI override for the sink — beats env + default. */
  sink?: string;
  /** Pretty-output destination; test seam, defaults to stdout. */
  prettyDestination?: NodeJS.WritableStream;
}): ConductorLogger {
  const env = opts.env ?? process.env;
  const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY);
  const level = resolveLevel(env, opts.level);
  const sink = resolveSink(env, isTTY, opts.checkoutRoot, opts.sink);
  const loggerOptions = {
    level,
    base: { bb_version: resolveCliVersion() },
  };
  const prettyOptions = opts.prettyDestination
    ? { colorize: true, sync: true, destination: opts.prettyDestination }
    : { colorize: true, sync: true };
  if (sink.kind === 'stdout') {
    return pino(loggerOptions, pretty(prettyOptions));
  }
  const file = () =>
    pino.destination({
      dest: sink.path,
      append: true,
      mkdir: true,
      sync: true,
    });
  if (sink.kind === 'file') {
    return pino(loggerOptions, file());
  }
  // 'both' — tee via multistream so the pane stays readable AND the record is
  // durable (BB-237). `level` is enforced by the logger, so each stream takes
  // everything that got through.
  // multistream filters per stream and defaults each entry to `info`, which
  // would silently drop `--log-level debug` from BOTH streams — so each entry
  // carries the resolved level and the logger stays the single gate.
  const at = level as pino.Level;
  return pino(
    loggerOptions,
    pino.multistream([
      { level: at, stream: pretty(prettyOptions) },
      { level: at, stream: file() },
    ]),
  );
}
