// BB-676 Task 3 — the one exclusive machine lock a tunnel reconciliation
// runs under, covering read → desired-state update → DNS/ingress reconcile →
// persisted result, across CLI processes AND conductor tool calls.
//
// A JS `Promise`-based mutex only serializes within one process; two
// `bakers ports up` invocations from two worktrees are two OS processes, so the
// lock has to be real OS state. `flock(1)` (util-linux) is that: it forks the
// given argv as its child and holds the file lock for exactly that child's
// lifetime, so there is no separate "forgot to unlock" path. The child here is
// `node --input-type=module -e <source>` — an ARGV, not a shell string, so
// nothing from the lock path or the operation ever reaches a shell — which
// prints `ACQUIRED` the instant it starts (by then `flock` already holds the
// lock) and waits on stdin for `RELEASE`. If the parent that spawned `flock`
// dies, the pipe's write end closes, the child sees stdin end and exits, and
// the lock releases itself — "release on parent death" without any extra
// bookkeeping.

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const HELPER_SOURCE = [
  "process.stdout.write('ACQUIRED\\n');",
  'process.stdin.resume();',
  "process.stdin.on('data', (buf) => { if (buf.toString('utf8').includes('RELEASE')) process.exit(0); });",
  "process.stdin.on('end', () => process.exit(0));",
  "process.stdin.on('close', () => process.exit(0));",
].join('\n');

/** The spawn seam, injected so a test can fake a lock process when it wants
 *  to exercise error paths without `flock` — real locking tests use the
 *  default, which runs the real binary. */
export interface LockDeps {
  spawn: typeof spawn;
}

export const nodeLockDeps: LockDeps = { spawn };

export class LockTimeoutError extends Error {
  constructor() {
    super('tunnel lock timed out');
    this.name = 'LockTimeoutError';
  }
}

// macOS compatibility (ticket scope: "Linux discovery") — `flock(1)` is
// util-linux, not present on macOS/BSD userland at all. Without this check,
// `spawn('flock', …)` fails with a raw `ENOENT` the caller has to decode;
// this surfaces the real, actionable limitation instead. Container-routed
// discovery/sharing does not need this lock's host-level guarantee the same
// way — only cross-process machine-wide reconciliation (`up`/`reap`) does,
// so this scopes the degradation to exactly the Linux-only piece, not the
// whole addon.
export class UnsupportedPlatformError extends Error {
  constructor(feature: string) {
    super(
      `${feature} requires Linux (uses flock/ss//proc) — not available on ` +
        `${process.platform}. Container-routed services are still ` +
        'discoverable via Docker; only host-level discovery and the ' +
        'machine lock are Linux-only.',
    );
    this.name = 'UnsupportedPlatformError';
  }
}

function assertLinux(feature: string): void {
  if (process.platform !== 'linux') {
    throw new UnsupportedPlatformError(feature);
  }
}

export function tunnelLockPath(home: string): string {
  return join(home, 'tunnels.lock');
}

interface HeldLock {
  release(): Promise<void>;
}

async function acquire(
  home: string,
  deps: LockDeps,
  timeoutSeconds: number,
  signal?: AbortSignal,
): Promise<HeldLock> {
  assertLinux('the tunnel machine lock');
  await mkdir(home, { recursive: true });
  const lockPath = tunnelLockPath(home);
  const child = deps.spawn(
    'flock',
    [
      // `--no-fork`: flock EXECs the helper in place instead of forking it —
      // one process holds the lock's file descriptor, not two. Without this,
      // `flock` forks before exec, and `fork()` duplicates the locked fd into
      // the child it runs; killing the outer `flock` process then leaves the
      // lock held by that child, which defeats "release on parent death".
      '--no-fork',
      '--timeout',
      String(timeoutSeconds),
      lockPath,
      process.execPath,
      '--input-type=module',
      '-e',
      HELPER_SOURCE,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );

  const acquired = await new Promise<boolean>((resolve, reject) => {
    let settled = false;
    const onData = (buf: Buffer) => {
      if (buf.toString('utf8').includes('ACQUIRED')) {
        settled = true;
        child.stdout?.off('data', onData);
        resolve(true);
      }
    };
    child.stdout?.on('data', onData);
    child.once('exit', () => {
      if (!settled) resolve(false);
    });
    child.once('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    signal?.addEventListener('abort', () => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        resolve(false);
      }
    });
  });

  if (!acquired) {
    throw new LockTimeoutError();
  }

  return {
    async release() {
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            resolve();
          }
        };
        child.once('exit', finish);
        try {
          child.stdin?.write('RELEASE\n');
          child.stdin?.end();
        } catch {
          finish();
        }
        setTimeout(() => {
          child.kill('SIGKILL');
          finish();
        }, 2000).unref();
      });
    },
  };
}

/**
 * Run `operation` while holding the one machine-wide tunnel lock. A timed-out
 * acquisition throws {@link LockTimeoutError} and calls `operation` not at
 * all — so a lock timeout changes neither local nor remote configuration.
 */
export async function withTunnelLock<T>(
  home: string,
  operation: () => Promise<T>,
  signal?: AbortSignal,
  deps: LockDeps = nodeLockDeps,
  timeoutSeconds = 10,
): Promise<T> {
  const held = await acquire(home, deps, timeoutSeconds, signal);
  try {
    return await operation();
  } finally {
    await held.release();
  }
}
