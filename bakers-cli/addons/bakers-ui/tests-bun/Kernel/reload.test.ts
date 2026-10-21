import { describe, expect, it } from 'bun:test';
import type {
  Collection,
  DropshClient,
  RendererServices,
} from '../../src/types.js';
import { bootTui, settle } from '../tui-harness.js';

// BB-285 — the shared reload: the kernel binds `R` for every screen that
// DECLARES `reload`, and says so in the one home spec D1 chose, the footer row.

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
    // The Dashboard's `n` only navigates to the New-ticket form when an agent
    // host is injected; the form guard below needs that route reachable.
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

async function bootDashboard(columns?: number) {
  const counter = { statisticsReads: 0 };
  const tui = await bootTui({
    services: countingServices(counter),
    ...(columns === undefined ? {} : { columns }),
  });
  return { tui, counter };
}

/** Quit the way a user does, and wait for the kernel to wind itself up. */
async function quit(tui: Awaited<ReturnType<typeof bootTui>>): Promise<void> {
  tui.mockInput.pressKey('q');
  await tui.running;
  await tui.stop();
}

describe('BB-285 — the shared reload affordance (AC-1, AC-2)', () => {
  it('the footer names `R reload` on a screen that can re-read its data', async () => {
    const { tui } = await bootDashboard();
    expect(tui.frame()).toContain('R:reload');
    await quit(tui);
  });

  it('pressing R re-reads the data', async () => {
    const { tui, counter } = await bootDashboard();
    const before = counter.statisticsReads;
    await tui.press('R');
    expect(counter.statisticsReads).toBe(before + 1);
    expect(tui.frame()).toContain('R:reload');
    await quit(tui);
  });

  it('the footer keeps the key row while a reload is in flight', async () => {
    const { tui } = await bootDashboard();
    tui.mockInput.pressKey('R');
    // No settle(): the frame composed synchronously on the keypress must already
    // mark busy (spec D4 — the draw() right after reload()). Only the PAINT is
    // pumped, so the assertion still reads the frame that keypress produced.
    await tui.renderOnce();
    expect(tui.frame()).toContain('R:reload');
    expect(tui.frame()).not.toContain('Loading…');
    await settle();
    await tui.renderOnce();
    expect(tui.frame()).toContain('R:reload');
    await quit(tui);
  });

  it('the hint leads the footer, so a 40-column terminal cannot cut it (R1)', async () => {
    const { tui } = await bootDashboard(40);
    expect(tui.frame()).toContain('R:reload');
    await quit(tui);
  });
});

describe('BB-285 — screens without reload show no affordance (AC-3, AC-5)', () => {
  it('the New-ticket form renders no hint and types R as text', async () => {
    const { tui } = await bootDashboard();
    // `n` (actionForInput → ticket.create modal), then wait out its option load.
    await tui.press('n');
    expect(tui.frame()).toContain('New ticket');
    // BB-664 AC-8: no project in scope ⇒ the popup opens on the new Project
    // field, one row ahead of Title.
    await tui.press('\x1b[B');

    await tui.press('R');
    expect(tui.frame()).not.toContain('R:reload'); // modal chrome: no hint
    // The character landed in the form — asserted on the VALUE ROW of the
    // active field, not as a bare `toContain('R')` over the frame. The old
    // assertion could be answered by any capital R anywhere in the transcript,
    // including the `R` of `R reload` it had just denied.
    const rows = tui.rows();
    const titleRow = rows.findIndex((row) => row.includes('▸ Title:'));
    expect(titleRow).toBeGreaterThan(-1);
    expect(rows[titleRow + 1]?.replace(/[│\s]/g, '')).toBe('R');

    await tui.press('\x1b'); // Esc cancels the form
    await quit(tui);
  });
});
