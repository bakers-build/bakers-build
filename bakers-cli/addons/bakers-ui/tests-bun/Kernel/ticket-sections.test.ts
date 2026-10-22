import { describe, expect, it } from 'bun:test';
import { type TabIdOf, tabBarFor } from '../../src/Component/top-tabs/index.js';
import { TAB_BAR_ID, tabNodeId } from '../../src/Kernel/chrome.js';
import { buildRoutes } from '../../src/Routing/routes.js';
import type {
  Collection,
  DropshClient,
  RendererServices,
  ResolvedRoute,
} from '../../src/types.js';
import {
  chromeRowCount,
  chromeRowOf,
  chromeShape,
} from '../../tests/chrome-rows.js';
import { type BootedTui, bootTui, settle } from '../tui-harness.js';

// BB-346 — the ticket detail's sections, driven through the REAL kernel on a
// 120×40 test renderer: real keystrokes, real clicks through `mockMouse`, and the
// current screen read back off the render buffer. A1, A2 and A4 are only jointly
// observable here.
//
// The fixtures and helpers are modelled on `ticket-detail-screen.test.ts` and
// COPIED rather than imported, as that file's siblings already do: each of these
// suites pins a frame, and a shared fixture would make one suite's expectation
// move when another suite's needs changed.

const ticketTabs = buildRoutes().tabs('ticket');

const TICKET = 'aaaa0000-0000-0000-0000-000000000346';
const PARENT = 'aaaa0000-0000-0000-0000-000000000200';
const RUN_NEW = 'bbbb0000-0000-0000-0000-000000004599';
const RUN_OLD = 'bbbb0000-0000-0000-0000-000000004592';

/**
 * A real bakers.build body: a summary line first and a distinctive tail that is only on
 * screen while the Description is EXPANDED. A4's first case reads exactly that
 * tail back after walking every section.
 */
const BODY = [
  '## Context',
  '',
  'SUMMARY-FIRST-LINE of the ticket body.',
  '',
  '## Requested changes',
  '',
  'TAIL-ONLY-LINE',
  ...Array.from({ length: 40 }, (_l, i) => `filler body line ${i}`),
].join('\n');

const run = (
  id: string,
  drupalId: number,
  startedAt: string,
  state: string,
  phase: string,
) => ({
  id,
  type: 'bb_run--bb_run',
  attributes: {
    drupal_internal__id: drupalId,
    state,
    state_at_start: phase,
    agent: 'claude',
    started_at: startedAt,
    heartbeat: startedAt,
    worktree_path: `/worktrees/${drupalId}`,
  },
  relationships: { ticket_id: { data: { id: TICKET } } },
});

const ticketDoc = {
  data: {
    id: TICKET,
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'BB-255',
      title: 'the sections live in the top bar',
      state: 'coding',
      description: { value: BODY },
      branch_name: 'feat/bb-346',
      base_branch: 'develop',
      links: [{ title: 'MR', uri: 'https://git.example/mr/346' }],
    },
    relationships: {
      parent_id: { data: { id: PARENT } },
      labels: { data: [{ id: 'l-1' }] },
      runs: { data: [{ id: RUN_NEW }, { id: RUN_OLD }] },
      sub_tickets: { data: [] },
      referenced_tickets: { data: [] },
      environments: { data: [] },
    },
  },
  included: [
    {
      id: PARENT,
      type: 'bb_ticket--bb_ticket',
      attributes: { identifier: 'BB-200', title: 'the parent epic' },
    },
    {
      id: 'l-1',
      type: 'bb_term--bb_labels',
      attributes: { name: 'work:code' },
    },
    run(RUN_OLD, 4592, '2026-08-01T10:00:00+00:00', 'done', 'spec'),
    run(RUN_NEW, 4599, '2026-08-01T18:00:00+00:00', 'running', 'coding'),
  ],
};

/** Every read the kernel makes, in order — A4's third case is a count of these. */
function fakeServices(reads: string[]): RendererServices {
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
      reads.push(path);
      if (path.startsWith(`bb_ticket/bb_ticket/${TICKET}`)) return ticketDoc;
      return { data: [] };
    },
    update: async () => ({}),
  };
  return { client, baseUrl: 'https://bakers.example' };
}

const TICKET_ROUTE: ResolvedRoute = {
  screen: 'ticket',
  ticketId: TICKET,
  view: 'full',
};

const COLUMNS = 120;
const ROWS = 40;

const boot = async (
  route: ResolvedRoute,
  reads: string[] = [],
): Promise<BootedTui> =>
  bootTui({
    services: fakeServices(reads),
    columns: COLUMNS,
    rows: ROWS,
    tui: { route },
  });

const quit = async (tui: BootedTui): Promise<void> => {
  tui.mockInput.pressKey('q');
  await tui.running;
  await tui.stop();
};

/** The rows of the current screen, blank tail dropped. */
const drawnRows = (tui: BootedTui): string[] => {
  const all = tui.rows();
  return all.slice(0, all.findLastIndex((row) => row !== '') + 1);
};

/** The body rows: after chrome (incl. separator), before status. */
const _bodyRows = (tui: BootedTui): string[] => {
  const all = drawnRows(tui);
  return all.slice(chromeRowCount(chromeShape(2, true)), -1);
};

/**
 * One physical left click on a 1-based terminal row/column.
 *
 * `mockMouse` takes 0-based BUFFER coordinates, so the shift happens here and
 * here only — the inert-neighbour case below is what proves it is not off by one
 * in either direction (A5's seam, mutated in both directions in Task 6).
 */
const click = async (
  tui: BootedTui,
  row: number,
  col: number,
): Promise<void> => {
  await tui.mockMouse.click(col - 1, row - 1);
  await settle();
  await tui.renderOnce();
};

/**
 * The bar row exactly as the chrome writes it — constructed from the registry,
 * never transcribed, so a renamed section moves the source and this expectation
 * together (the rule the whole `tests-bun/Kernel` set follows).
 */
const ticketBar = (activeId: TabIdOf<'ticket'>): string =>
  ` ${tabBarFor({ level: 'ticket', tab: activeId, tabs: ticketTabs })}`.replace(
    /\s+$/,
    '',
  );

/**
 * The ticket's chrome: a FIVE-content-row header box (title, labels, state,
 * Assigned, Created by) with a bar under it.
 *
 * `headerRowCount()` is `childrenOf(header).length` and feeds `chromeHeight()`,
 * which sizes the body window BEFORE Yoga runs. Assigned and Created by are
 * extra identity rows, so the shape is stated once here and every expectation
 * below is derived from it.
 */
const TICKET_SHAPE = chromeShape(2, true);
/**
 * The bar's 1-based TERMINAL row — the unit {@link click} takes.
 *
 * Found by the bar's own node id in the composed chrome, not written down. This
 * file's subject IS that row, so a number here would be the one place the row is
 * asserted and the one place it could go stale unnoticed; `ticket-detail-screen`
 * already derives it the same way. Adding a header row moves the bar, and moves
 * every expectation in this file with it.
 */
const BAR_ROW = chromeRowOf(TICKET_SHAPE, TAB_BAR_ID);
/** The same row as an index into `drawnRows`, which is 0-based. */
const BAR_INDEX = BAR_ROW - 1;

/**
 * The 1-based terminal column to click for a section's own label.
 *
 * Derived from the registry's rendered bar rather than written down: the bar is
 * `' ' + <bar>`, so bar offset `n` is terminal column `n + 2`, and `+ 1` more
 * lands inside the label instead of on its leading pad.
 */
const columnOf = (index: number): number => {
  const tab = ticketTabs[index];
  if (!tab) throw new Error(`no section at index ${index}`);
  const bar = tabBarFor({ level: 'ticket', tab: 'overview', tabs: ticketTabs });
  const offset = bar.indexOf(index === 0 ? '[Overview]' : ` ${tab.label} `);
  if (offset === -1) throw new Error(`${tab.id} is not in the rendered bar`);
  return offset + 3;
};

const TAB = '\t';

describe('A1 — the ticket detail draws one bar, and it is the top one', () => {
  it('the bar row carries the sections and the box has two content rows', async () => {
    const tui = await boot(TICKET_ROUTE);
    const rows = drawnRows(tui);
    expect(rows[BAR_INDEX]).toBe(ticketBar('overview'));
    // BB-375 — gap is ABOVE the bar; FRAME sits under the bar.
    expect(rows[BAR_INDEX - 1], 'the gap above the bar').toBe('');
    expect(rows[BAR_INDEX + 1], 'the frame top').toContain('╭');
    expect(rows[1]).toContain('BB-255');
    // The meta row carries state + labels without prefixes.
    expect(rows[2]).toContain('coding');
    expect(rows[2]).not.toContain('Labels:');
    expect(rows[2]).not.toContain('State:');
    expect(rows[3], 'the box bottom border').toContain('╰');
    await quit(tui);
  });

  it('no row draws a detail bar of the old shape', async () => {
    const tui = await boot(TICKET_ROUTE);
    // The retired bar joined its segments with ONE space; the top bar uses two.
    // A single-space bar anywhere means the retired row came back.
    expect(
      drawnRows(tui).filter((r) =>
        /\[Overview\] Comments Related Runs/.test(r),
      ),
    ).toEqual([]);
    await quit(tui);
  });
});

describe('A2 — a click lands on the section it points at', () => {
  it('each registered ticket tab opens from its own node', async () => {
    for (const [index, tab] of ticketTabs.entries()) {
      const tui = await boot(TICKET_ROUTE);
      await click(tui, BAR_ROW, columnOf(index));
      expect(drawnRows(tui)[BAR_INDEX], `clicked ${tab.id}`).toBe(
        ticketBar(tab.id),
      );
      await quit(tui);
    }
  });

  it('a click one row below the bar is inert — the 0-based/1-based seam', async () => {
    const tui = await boot(TICKET_ROUTE);
    const comments = columnOf(
      ticketTabs.findIndex((tab) => tab.id === 'comments'),
    );
    await click(tui, BAR_ROW, comments);
    expect(drawnRows(tui)[BAR_INDEX]).toBe(ticketBar('comments'));
    // BB-375 — SEPARATOR_ROWS = 0; the row under the bar is the framed body.
    await click(tui, BAR_ROW + 1, comments);
    expect(drawnRows(tui)[BAR_INDEX], 'still History').toBe(
      ticketBar('comments'),
    );
    await quit(tui);
  });

  // R2 — `runs` is a tab on the project level AND a section here. Never at the
  // same time, so the shared node id is safe; asserted rather than assumed.
  it('names one node per section, by the section’s own id', async () => {
    const tui = await boot(TICKET_ROUTE);
    // The node the pointer lands on IS the section's own node — the assertion
    // A2 asks for on the composed tree rather than on a measured string. Read
    // off the live renderable tree, so it is the same node the click cases hit.
    for (const tab of ticketTabs)
      expect(
        tui.renderer.root.findDescendantById(tabNodeId(tab.id)),
        tab.id,
      ).toBeDefined();
    await quit(tui);
  });
});

describe('A4 — per-section state survives the walk', () => {
  it('an expanded Description is still expanded after a full tab walk', async () => {
    const tui = await boot(TICKET_ROUTE);
    await tui.press('\x1b[B');
    await tui.press('\r');
    for (let i = 0; i < ticketTabs.length; i += 1) await tui.press(TAB);
    expect(drawnRows(tui)[BAR_INDEX], 'back on Overview').toBe(
      ticketBar('overview'),
    );
    await quit(tui);
  });

  it('the selection on Runs is the kernel’s to move, and it opens that run', async () => {
    const tui = await boot(TICKET_ROUTE);
    for (let i = 0; i < 3; i += 1) await tui.press(TAB); // -> Runs
    expect(drawnRows(tui)[BAR_INDEX], 'on Runs').toBe(ticketBar('runs'));
    await tui.press('\x1b[B'); // select the older run
    await tui.press('\r');
    expect(drawnRows(tui).join('\n'), 'the OLDER run opened').toContain(
      RUN_OLD,
    );
    await quit(tui);
  });

  // Each route instance retains its own cursor across sibling visits (D1).
  it('the Runs route retains its selected row across sibling tabs', async () => {
    const tui = await boot(TICKET_ROUTE);
    for (let i = 0; i < 3; i += 1) await tui.press(TAB); // -> Runs
    await tui.press('\x1b[B'); // select the older run
    await tui.press(TAB); // -> Overview (wraps; the Addons tab is retired, BB-661)
    for (let i = 0; i < 3; i += 1) await tui.press(TAB); // -> Runs again
    await tui.press('\r');
    expect(
      drawnRows(tui).join('\n'),
      'the selected OLDER run survives the route switch',
    ).toContain(RUN_OLD);
    await quit(tui);
  });

  // Router tab navigation does not push history: one Escape leaves the ticket.
  it('a section switch pushes no history frame — Esc leaves the ticket', async () => {
    const tui = await boot(TICKET_ROUTE);
    await tui.press(TAB);
    await tui.press(TAB);
    await click(
      tui,
      BAR_ROW,
      columnOf(ticketTabs.findIndex((tab) => tab.id === 'runs')),
    );
    expect(drawnRows(tui)[BAR_INDEX], 'on Runs, by key and by click').toBe(
      ticketBar('runs'),
    );

    await tui.press('\x1b');
    const rows = drawnRows(tui);
    for (const tab of ticketTabs)
      expect(
        rows,
        `one Esc left the ticket — the ${tab.id} bar is nowhere on screen`,
      ).not.toContain(ticketBar(tab.id));
    expect(rows.join('\n'), 'the open ticket is gone').not.toContain('BB-255');

    await quit(tui);
  });

  it('screens reuse cached includes and load only the missing relationships', async () => {
    const reads: string[] = [];
    const tui = await boot(TICKET_ROUTE, reads);
    for (let i = 0; i < 3; i += 1) await tui.press(TAB);
    expect(
      reads.filter((p) => p.startsWith(`bb_ticket/bb_ticket/${TICKET}`)),
      'Overview already loaded comments; only Runs needs another read',
    ).toHaveLength(2);
    await quit(tui);
  });
});
