import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createRefreshSignal,
  REFRESH_DEBOUNCE_MS,
  REFRESH_SIGNAL_FILE,
} from '../../src/lib/refresh-signal.js';
import type { Debounce, WatchDirectory } from '../../src/types.js';
import { timerDebounce } from '../../src/Widget/option-source.js';

// BB-376 — the watcher's logic, with the filesystem and the clock injected
// (spec D2/D3). What the DEFAULTS do is the separate real-tmpdir case in Task 2.

/** A debounce the test fires by hand, counting how often a pending call was cancelled. */
function manualDebounce() {
  const state = {
    armed: undefined as (() => void) | undefined,
    cancels: 0,
    ms: 0,
  };
  const debounce: Debounce = (fn, ms) => {
    state.armed = fn;
    state.ms = ms;
    return () => {
      state.cancels++;
      state.armed = undefined;
    };
  };
  return {
    debounce,
    get ms() {
      return state.ms;
    },
    get cancels() {
      return state.cancels;
    },
    fire() {
      const fn = state.armed;
      state.armed = undefined;
      fn?.();
    },
    get armed() {
      return state.armed !== undefined;
    },
  };
}

/** A watch the test drives, recording the directory it was given and its closes. */
function fakeWatch() {
  const state = {
    dir: undefined as string | undefined,
    closes: 0,
    emit: undefined as ((filename: string | null) => void) | undefined,
  };
  const watchDirectory: WatchDirectory = (dir, onEvent) => {
    state.dir = dir;
    state.emit = onEvent;
    return {
      close: () => {
        state.closes++;
      },
    };
  };
  return {
    watchDirectory,
    get dir() {
      return state.dir;
    },
    get closes() {
      return state.closes;
    },
    emit(filename: string | null) {
      state.emit?.(filename);
    },
  };
}

describe('BB-376 — createRefreshSignal (AC-2, AC-5)', () => {
  it('watches the DIRECTORY it was given, not the file (D2)', () => {
    const watch = fakeWatch();
    const timer = manualDebounce();
    const signal = createRefreshSignal({
      dir: '/tmp/project/.bakers',
      onSignal: vi.fn(),
      debounce: timer.debounce,
      watchDirectory: watch.watchDirectory,
      readToken: () => null,
    });
    expect(signal).toBeDefined();
    expect(watch.dir).toBe('/tmp/project/.bakers');
  });

  it('a changed token after an event on the signal file reloads ONCE', () => {
    const watch = fakeWatch();
    const timer = manualDebounce();
    const onSignal = vi.fn();
    let token: number | null = null;
    createRefreshSignal({
      dir: '/tmp/.bakers',
      onSignal,
      debounce: timer.debounce,
      watchDirectory: watch.watchDirectory,
      readToken: () => token,
    });
    token = 1000;
    watch.emit(REFRESH_SIGNAL_FILE);
    expect(timer.ms).toBe(REFRESH_DEBOUNCE_MS);
    expect(onSignal).not.toHaveBeenCalled();
    timer.fire();
    expect(onSignal).toHaveBeenCalledTimes(1);
  });

  it('an event for another file in the same directory is ignored', () => {
    const watch = fakeWatch();
    const timer = manualDebounce();
    const onSignal = vi.fn();
    createRefreshSignal({
      dir: '/tmp/.bakers',
      onSignal,
      debounce: timer.debounce,
      watchDirectory: watch.watchDirectory,
      readToken: () => 1000,
    });
    watch.emit('log.txt');
    watch.emit(null);
    expect(timer.armed).toBe(false);
    timer.fire();
    expect(onSignal).not.toHaveBeenCalled();
  });

  it('three events in one window cancel-and-rearm, so the reload runs ONCE (D3)', () => {
    const watch = fakeWatch();
    const timer = manualDebounce();
    const onSignal = vi.fn();
    let token: number | null = null;
    createRefreshSignal({
      dir: '/tmp/.bakers',
      onSignal,
      debounce: timer.debounce,
      watchDirectory: watch.watchDirectory,
      readToken: () => token,
    });
    token = 1000;
    watch.emit(REFRESH_SIGNAL_FILE);
    watch.emit(REFRESH_SIGNAL_FILE);
    watch.emit(REFRESH_SIGNAL_FILE);
    expect(timer.cancels).toBe(2);
    timer.fire();
    expect(onSignal).toHaveBeenCalledTimes(1);
  });

  it('an unchanged token reloads nothing, and the baseline at boot is not news (D1)', () => {
    const watch = fakeWatch();
    const timer = manualDebounce();
    const onSignal = vi.fn();
    createRefreshSignal({
      dir: '/tmp/.bakers',
      onSignal,
      debounce: timer.debounce,
      watchDirectory: watch.watchDirectory,
      readToken: () => 1000,
    });
    watch.emit(REFRESH_SIGNAL_FILE);
    timer.fire();
    expect(onSignal).not.toHaveBeenCalled();
  });

  it('a DELETED signal file is a bump too (D1)', () => {
    const watch = fakeWatch();
    const timer = manualDebounce();
    const onSignal = vi.fn();
    let token: number | null = 1000;
    createRefreshSignal({
      dir: '/tmp/.bakers',
      onSignal,
      debounce: timer.debounce,
      watchDirectory: watch.watchDirectory,
      readToken: () => token,
    });
    token = null;
    watch.emit(REFRESH_SIGNAL_FILE);
    timer.fire();
    expect(onSignal).toHaveBeenCalledTimes(1);
  });

  it('no dir means no watcher at all (D6)', () => {
    const watch = fakeWatch();
    const signal = createRefreshSignal({
      dir: undefined,
      onSignal: vi.fn(),
      debounce: manualDebounce().debounce,
      watchDirectory: watch.watchDirectory,
      readToken: () => null,
    });
    expect(signal).toBeUndefined();
    expect(watch.dir).toBeUndefined();
  });

  it('close() closes the watch and cancels a pending reload', () => {
    const watch = fakeWatch();
    const timer = manualDebounce();
    const onSignal = vi.fn();
    let token: number | null = null;
    const signal = createRefreshSignal({
      dir: '/tmp/.bakers',
      onSignal,
      debounce: timer.debounce,
      watchDirectory: watch.watchDirectory,
      readToken: () => token,
    });
    token = 1000;
    watch.emit(REFRESH_SIGNAL_FILE);
    signal?.close();
    expect(watch.closes).toBe(1);
    expect(timer.cancels).toBe(1);
    timer.fire();
    expect(onSignal).not.toHaveBeenCalled();
  });

  it('a watch that throws switches the feature off instead of throwing (D8)', () => {
    const signal = createRefreshSignal({
      dir: '/tmp/.bakers',
      onSignal: vi.fn(),
      debounce: manualDebounce().debounce,
      watchDirectory: () => {
        throw new Error('ENOSPC: inotify watch limit reached');
      },
      readToken: () => null,
    });
    expect(signal).toBeUndefined();
  });
});

// BB-376 R1 — the DEFAULTS, once. Everything above injects them; if `fs.watch`
// on a directory stopped reporting the filename, or `statSync` stopped seeing a
// fresh mtime, only this case would notice.
describe('BB-376 — the real filesystem defaults (AC-2)', () => {
  it('a real touch in a real directory reaches onSignal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bb-376-'));
    try {
      const fired = new Promise<void>((resolve) => {
        const signal = createRefreshSignal({
          dir,
          onSignal: () => {
            signal?.close();
            resolve();
          },
          debounce: timerDebounce,
          debounceMs: 10,
        });
        // Written AFTER the watcher exists, so the baseline is "absent" and the
        // write is a real change of the token.
        writeFileSync(join(dir, REFRESH_SIGNAL_FILE), '');
      });
      await fired;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 10_000);
});
