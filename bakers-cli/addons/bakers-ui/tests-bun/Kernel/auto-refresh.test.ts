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

// One complete atomic figure returned by grouped discovery.
const STATISTICS_DOCUMENT = {
  data: {
    attributes: {
      groups: [
        {
          id: 'overview',
          label: 'Overview',
          figures: [
            {
              id: 'user_overview',
              label: 'Overview',
              description: '',
              widget: 'matrix',
              generated: '2026-08-05T07:00:00+00:00',
              filters: {},
              categories: [
                { key: 'day', label: 'Last 24 hours' },
                { key: 'week', label: 'Last 7 days' },
                { key: 'month', label: 'Last 30 days' },
              ],
              measurements: [
                {
                  id: 'closed_tickets',
                  label: 'Closed tickets',
                  value_type: 'integer',
                  unit: 'tickets',
                  values: { day: 1, week: 2, month: 3 },
                },
              ],
              empty: { is_empty: false, message: null },
              cache: { max_age: 0, contexts: [], tags: [] },
            },
          ],
        },
      ],
    },
  },
};

function countingServices(counter: {
  statisticsReads: number;
}): RendererServices {
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
      if (path === 'bakers/statistics') {
        counter.statisticsReads++;
        return STATISTICS_DOCUMENT;
      }
      return { data: [] };
    },
    update: async () => ({}),
  };
  return {
    client,
    baseUrl: 'https://bakers.example',
    currentUser: 'cw',
    // The Dashboard's `n` only reaches the New-ticket form with an agent host.
    agents: {
      launch: async () => {
        throw new Error('not under test');
      },
      list: async () => [],
      focus: async () => {},
      hide: async () => {},
      kill: async () => {},
    },
  };
}

/** Fire the reload in the same tick — there is no timer to wait for. */
const syncDebounce: Debounce = (fn) => {
  fn();
  return () => {};
};

async function bootWatched() {
  const dir = mkdtempSync(join(tmpdir(), 'bb-376-kernel-'));
  const counter = { statisticsReads: 0 };
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
  it('a bump re-reads the Dashboard exactly once', async () => {
    const w = await bootWatched();
    const before = w.counter.statisticsReads;
    await w.bump();
    expect(w.counter.statisticsReads).toBe(before + 1);
    await w.done();
  });

  it('R still reloads after the signal path exists (AC-3)', async () => {
    const w = await bootWatched();
    const before = w.counter.statisticsReads;
    await w.tui.press('R');
    expect(w.counter.statisticsReads).toBe(before + 1);
    await w.done();
  });
});

describe('BB-376 — a screen without reload is untouched (AC-4)', () => {
  it('a bump with the New-ticket popup open re-reads nothing', async () => {
    const w = await bootWatched();
    await w.tui.press('n');
    expect(w.tui.frame()).toContain('New ticket');
    const before = w.counter.statisticsReads;
    await w.bump();
    expect(w.counter.statisticsReads).toBe(before);
    expect(w.tui.frame()).toContain('New ticket');
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
      services: countingServices({ statisticsReads: 0 }),
      tui: { watchDirectory, debounce: syncDebounce },
    });
    expect(watched).toBe(false);
    tui.mockInput.pressKey('q');
    await tui.running;
    await tui.stop();
  });
});

describe('BB-376 — the footer marks a live watcher (D7)', () => {
  it('the Dashboard footer says (auto) when the signal is watched', async () => {
    const w = await bootWatched();
    expect(w.tui.frame()).toContain('R:reload (auto)');
    await w.done();
  });

  it('and stays the plain hint with no bakersDir', async () => {
    const tui = await bootTui({
      services: countingServices({ statisticsReads: 0 }),
      tui: { debounce: syncDebounce },
    });
    expect(tui.frame()).toContain('R:reload');
    expect(tui.frame()).not.toContain('(auto)');
    tui.mockInput.pressKey('q');
    await tui.running;
    await tui.stop();
  });
});
