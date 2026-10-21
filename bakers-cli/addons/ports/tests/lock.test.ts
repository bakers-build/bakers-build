import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LockTimeoutError, withTunnelLock } from '../src/lock.js';

// Real `flock` child processes throughout — this is AC5's cross-PROCESS
// serialization, which a same-process Promise mutex cannot prove (plan
// review: "do not accept a same-process Promise-only lock test as AC5
// coverage"). Each `withTunnelLock` call below spawns its own real `flock`
// subprocess against the same lock file, so mutual exclusion comes from the
// OS, not from JS scheduling.

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'bakers-tunnel-lock-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('withTunnelLock', () => {
  it('serializes two concurrent real subprocess acquisitions', async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withTunnelLock(home, async () => {
      events.push('first:start');
      await gate;
      events.push('first:end');
      return 'first';
    });

    // Give the first lock a moment to actually acquire before starting the second.
    await new Promise((r) => setTimeout(r, 300));

    const second = withTunnelLock(home, async () => {
      events.push('second:start');
      return 'second';
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(events).toEqual(['first:start']);
    release();

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe('first');
    expect(b).toBe('second');
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  }, 15_000);

  it('times out without ever running the operation, changing nothing', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = withTunnelLock(home, async () => {
      await gate;
      return 'held';
    });
    await new Promise((r) => setTimeout(r, 300));

    let ran = false;
    const { withTunnelLock: withTunnelLockDirect } = await import(
      '../src/lock.js'
    );
    await expect(
      withTunnelLockDirect(
        home,
        async () => {
          ran = true;
        },
        undefined,
        undefined,
        1,
      ),
    ).rejects.toBeInstanceOf(LockTimeoutError);
    expect(ran).toBe(false);

    release();
    await held;
  }, 15_000);

  it('releases the lock when the holder is killed, so a later acquirer proceeds', async () => {
    // Acquire and hold indefinitely in a detached real subprocess, then kill it
    // mid-hold; a fresh withTunnelLock call must still be able to acquire.
    const { spawn } = await import('node:child_process');
    const lockPath = join(home, 'tunnels.lock');
    const holder = spawn('flock', ['--no-fork', lockPath, 'sleep', '30'], {
      stdio: 'ignore',
    });
    await new Promise((r) => setTimeout(r, 300));

    holder.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 300));

    const result = await withTunnelLock(
      home,
      async () => 'acquired-after-kill',
    );
    expect(result).toBe('acquired-after-kill');
  }, 15_000);
});

describe('macOS / non-Linux platform guard', () => {
  it('throws a clear diagnostic instead of a raw spawn ENOENT on a non-Linux platform', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      await expect(
        withTunnelLock(home, async () => 'unreachable'),
      ).rejects.toThrow(/requires Linux/);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});
