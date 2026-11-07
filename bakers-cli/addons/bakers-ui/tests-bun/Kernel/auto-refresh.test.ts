import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REFRESH_SIGNAL_FILE } from '../../src/lib/refresh-signal.js';
import type {
  Collection,
  Debounce,
  DropshClient,
  RendererServices,
  WatchDirectory,
} from '../../src/types.js';
import { bootTui, settle } from '../tui-harness.js';

// BB-376 — the kernel end: a signal on the watched `.bakers` dir runs the SAME
// reload `R` runs (AC-2), and a screen that declares none is untouched (AC-4).
//
// The WATCH is injected so a signal is a function call rather than an inotify
// event, and the DEBOUNCE is made synchronous so there is no timer to wait out.
// The TOKEN is deliberately real: the fixture writes an actual file into an
// actual tmpdir, so the one thing this file does not fake is the question
// "did anything change?".

function countingServices(counter: { ticketReads: number }): RendererServices {
  const collection = (): Collection => {
    const c: Collection = {
      where: () => c,
      sort: () => c,
      page: () => c,
      first: async () => null,
      list: async () => [],
    };
    return c;
  };
  const client: DropshClient = {
    collection,
    get: async (path: string) => {
      if (path === 'user/user') return { data: [{ id: 'u-cw' }] };
      if (path === 'bb_ticket/bb_ticket') counter.ticketReads++;
      return { data: [] };
    },
    update: async () => ({}),
  };
  return {
    client,
    baseUrl: 'https://bakers.example',
    currentUser: 'cw',
  };
}

/** Fire the reload in the same tick — there is no timer to wait for. */
const syncDebounce: Debounce = (fn) => {
  fn();
  return () => {};
};

async function bootWatched() {
  const dir = mkdtempSync(join(tmpdir(), 'bb-376-kernel-'));
  const counter = { ticketReads: 0 };
  let emit: ((filename: string | null) => void) | undefined;
  const watchDirectory: WatchDirectory = (_dir, onEvent) => {
    emit = onEvent;
    return {
      close: () => {
        emit = undefined;
      },
    };
  };
  const tui = await bootTui({
    services: countingServices(counter),
    tui: { bakersDir: dir, watchDirectory, debounce: syncDebounce },
  });
  return {
    tui,
    counter,
    /** Touch the signal file, then hand the watcher its event. */
    async bump(): Promise<void> {
      writeFileSync(join(dir, REFRESH_SIGNAL_FILE), '');
      emit?.(REFRESH_SIGNAL_FILE);
      await settle();
      await tui.renderOnce();
    },
    async done(): Promise<void> {
      tui.mockInput.pressKey('q');
      await tui.running;
      await tui.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('BB-376 — a signal reloads the active screen (AC-2)', () => {
  it('a bump re-reads My work exactly once', async () => {
    const w = await bootWatched();
    const before = w.counter.ticketReads;
    await w.bump();
    expect(w.counter.ticketReads).toBe(before + 1);
    await w.done();
  });

  it('R still reloads after the signal path exists (AC-3)', async () => {
    const w = await bootWatched();
    const before = w.counter.ticketReads;
    await w.tui.press('R');
    expect(w.counter.ticketReads).toBe(before + 1);
    await w.done();
  });
});

describe('BB-376 — a screen without reload is untouched (AC-4)', () => {
  it('a bump with the project picker open re-reads nothing', async () => {
    const w = await bootWatched();
    await w.tui.press('r');
    expect(w.tui.frame()).toContain('Filter by project');
    const before = w.counter.ticketReads;
    await w.bump();
    expect(w.counter.ticketReads).toBe(before);
    expect(w.tui.frame()).toContain('Filter by project');
    await w.tui.press('\x1b');
    await w.done();
  });
});

describe('BB-376 — no dir, no watcher (AC-4)', () => {
  it('a cockpit with no bakersDir never builds a watch', async () => {
    let watched = false;
    const watchDirectory: WatchDirectory = (_dir, onEvent) => {
      watched = true;
      onEvent(null);
      return { close: () => {} };
    };
    const tui = await bootTui({
      services: countingServices({ ticketReads: 0 }),
      tui: { watchDirectory, debounce: syncDebounce },
    });
    expect(watched).toBe(false);
    tui.mockInput.pressKey('q');
    await tui.running;
    await tui.stop();
  });
});

describe('BB-376 — the footer marks a live watcher (D7)', () => {
  it('the My work footer says (auto) when the signal is watched', async () => {
    const w = await bootWatched();
    expect(w.tui.frame()).toContain('R:reload (auto)');
    await w.done();
  });

  it('and stays the plain hint with no bakersDir', async () => {
    const tui = await bootTui({
      services: countingServices({ ticketReads: 0 }),
      tui: { debounce: syncDebounce },
    });
    expect(tui.frame()).toContain('R:reload');
    expect(tui.frame()).not.toContain('(auto)');
    tui.mockInput.pressKey('q');
    await tui.running;
    await tui.stop();
  });
});
