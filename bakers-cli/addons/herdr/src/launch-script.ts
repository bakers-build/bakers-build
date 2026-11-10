import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shellQuote } from '@bakers-build/core';

export interface LaunchScript {
  dir: string;
  wrapPath: string;
  commandPath: string;
  startedPath: string;
  exitPath: string;
  typedCommand: string;
}

/**
 * Write a run-scoped launch script so a fresh pane is typed only `sh '<file>'`.
 *
 * The assembled command (env prefixes + agent argv) lives in a `0600` file
 * inside a fresh `0700` directory under the OS temp dir. The typed line stays
 * well under the tty canonical cap (macOS 1024, Linux 4096). The wrapper
 * deletes the command file as its first step so secrets never linger in the
 * pane's shell history or on disk after launch.
 */
export function writeLaunchScript(command: string): LaunchScript {
  const dir = mkdtempSync(join(tmpdir(), 'bakers-run-'));
  chmodSync(dir, 0o700);
  try {
    const commandPath = join(dir, 'command');
    const wrapPath = join(dir, 'run.sh');
    const startedPath = join(dir, 'started');
    const exitPath = join(dir, 'exit');
    writeFileSync(commandPath, command, { encoding: 'utf8', mode: 0o600 });
    chmodSync(commandPath, 0o600);
    const wrap = `#!/bin/sh
dir=${shellQuote(dir)}
cmd=$(cat -- "$dir/command")
rm -f -- "$dir/command" "$0"
printf started > "$dir/started"
trap : INT QUIT
( eval "$cmd" )
code=$?
printf 'exit %s\\n' "$code" > "$dir/exit"
exit "$code"
`;
    writeFileSync(wrapPath, wrap, { encoding: 'utf8', mode: 0o600 });
    chmodSync(wrapPath, 0o600);
    return {
      dir,
      wrapPath,
      commandPath,
      startedPath,
      exitPath,
      typedCommand: `sh ${shellQuote(wrapPath)}`,
    };
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_START_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_MS = 50;

export interface LaunchWatchOptions {
  /** Window after `started` in which an immediate agent exit fails the launch. */
  timeout_ms?: number;
  /** How long to wait for the wrapper to write `started`. Default 60s. */
  start_timeout_ms?: number;
  poll_ms?: number;
  sleep?: (ms: number) => Promise<void>;
  readPane?: () => Promise<string>;
}

/**
 * Poll the launch markers in two phases. Wait up to `start_timeout_ms` for
 * `started` (shell start-up), then apply a short `timeout_ms` exit window from
 * that moment. An immediate exit or a script that never starts fails the
 * launch; an agent still running at the exit deadline is treated as started.
 */
export async function watchLaunch(
  script: LaunchScript,
  opts: LaunchWatchOptions = {},
): Promise<void> {
  const timeoutMs = opts.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const startTimeoutMs = opts.start_timeout_ms ?? DEFAULT_START_TIMEOUT_MS;
  const pollMs = opts.poll_ms ?? DEFAULT_POLL_MS;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const startDeadline = Date.now() + startTimeoutMs;
  let exitDeadline = 0;
  let sawStarted = false;
  for (;;) {
    if (existsSync(script.exitPath)) {
      const line = readFileSync(script.exitPath, 'utf8').trim();
      if (line) {
        throw new Error(await launchFailure(line, opts.readPane));
      }
    }
    if (!sawStarted && existsSync(script.startedPath)) {
      sawStarted = true;
      exitDeadline = Date.now() + timeoutMs;
      if (timeoutMs === 0) return;
    }
    const now = Date.now();
    if (sawStarted) {
      if (now >= exitDeadline) return;
    } else if (now >= startDeadline) {
      throw new Error(
        await launchFailure('agent did not start', opts.readPane),
      );
    }
    await sleep(pollMs);
  }
}

async function launchFailure(
  reason: string,
  readPane: LaunchWatchOptions['readPane'],
): Promise<string> {
  const tail = readPane ? await readPane().catch(() => '') : '';
  const trimmed = tail.trim();
  return trimmed
    ? `Launch failed: ${reason}\n${trimmed}`
    : `Launch failed: ${reason}`;
}

/** How long after the launch a login or credential screen still fails the run. */
export const AUTH_WATCH_MS = 180_000;

/**
 * Read the pane until one of `patterns` shows (its reason) or `windowMs`
 * passes (undefined). An unreadable pane is retried, never a failure.
 */
export async function watchAuth(
  readPane: () => Promise<string>,
  patterns: readonly { pattern: RegExp; reason: string }[],
  opts: {
    windowMs?: number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<string | undefined> {
  const now = opts.now ?? Date.now;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const deadline = now() + (opts.windowMs ?? AUTH_WATCH_MS);
  while (now() < deadline) {
    const text = await readPane().catch(() => '');
    const hit = patterns.find(({ pattern }) => pattern.test(text));
    if (hit) return hit.reason;
    await sleep(opts.pollMs ?? 2000);
  }
  return undefined;
}
