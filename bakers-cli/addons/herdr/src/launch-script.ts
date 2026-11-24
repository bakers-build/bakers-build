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
  /** How to start the wrapper: `[wrapPath]` when named after an agent, else `['sh', wrapPath]`. */
  argv: string[];
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
 *
 * With `agent` (the harness's herdr name) the wrapper is an executable named
 * after it and started directly, so herdr and hc identify the pane's agent by
 * its foreground process name while the agent itself runs in a sandbox.
 */
export function writeLaunchScript(
  command: string,
  agent?: string,
): LaunchScript {
  // The name becomes a file name in the launch directory.
  if (agent !== undefined && !/^[a-z0-9-]+$/.test(agent)) {
    throw new Error(`Invalid herdr agent name: ${JSON.stringify(agent)}`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'bakers-run-'));
  chmodSync(dir, 0o700);
  try {
    const commandPath = join(dir, 'command');
    const wrapPath = join(dir, agent ?? 'run.sh');
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
    // shortcut: a noexec tmpdir refuses the direct exec, move the launch dir if a host mounts /tmp noexec
    const mode = agent ? 0o700 : 0o600;
    writeFileSync(wrapPath, wrap, { encoding: 'utf8', mode });
    chmodSync(wrapPath, mode);
    const argv = agent ? [wrapPath] : ['sh', wrapPath];
    return {
      dir,
      wrapPath,
      commandPath,
      startedPath,
      exitPath,
      argv,
      typedCommand: agent ? shellQuote(wrapPath) : `sh ${shellQuote(wrapPath)}`,
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
