import { describe, expect, it } from 'bun:test';
import { chromeRowCount, chromeShape } from '../../tests/chrome-rows.js';

// BB-255 D8: the chrome height is a function of the SHAPE — the header box's
// own content rows plus the bar — because the ticket screen's box grew a labels
// row. BB-340 Task 11 counts those rows off the COMPOSED TREE, since
// `lib/hit-test.ts`'s `chromeRows` was deleted with the click mapping that
// needed it (spec D6); the values are unchanged (6 with a bar, 5 without).
//
// BB-346 — THE TICKET SCREEN HAD NO SHAPE OF ITS OWN, which is why the third
// constant this block used to declare was deleted. `TICKET_CHROME` read
// `chromeRowCount(chromeShape(3, false))`: three box content rows — title,
// labels, and the bar the ticket screen drew for itself — and no bar row under
// the box. Its sections became the `ticket` level's entries, so the box went back
// to two content rows and the bar became the chrome's: the SAME shape every other
// bar screen composes, not a second one that happens to be as tall. Both of those
// shapes are six rows (A7), so no assertion in this file could ever have caught
// the stale value — a second name for one shape is precisely what let it model a
// screen that no longer existed.
//
// BB-369 D1 — IT HAS A SHAPE OF ITS OWN AGAIN, and this one is not a second
// name for six. The state row makes it three content rows AND a bar row: SEVEN.
// So the constant is back, on the opposite footing — it now differs from
// `BAR_CHROME` by a row, which is a difference an assertion can see and did see
// (this file went red on it), rather than the coincidence BB-346 deleted.
const BAR_CHROME = chromeRowCount(chromeShape(2, true));
const TICKET_CHROME = chromeRowCount(chromeShape(5, true));
const TWO_ROW_NO_BAR_CHROME = chromeRowCount(chromeShape(2, false));

import type {
  Collection,
  DropshClient,
  RendererServices,
  ResolvedRoute,
} from '../../src/types.js';
import { oracleWidth } from '../../tests/support/eaw-oracle.js';
import { bootTui } from '../tui-harness.js';

// BB-241 Amendment A (spec D11 / AC-13) — the RENDER INVARIANT.
//
// Every other kernel assertion used to run against a fake stdout that recorded
// writes and modelled neither line wrapping nor character width, so a line one
// column too wide looked fine to it while a real terminal wrapped it onto a
// second physical row and shifted every row below. That is exactly how the top
// frame's `width + 1` line survived the whole suite and broke the click hit test.
//
// This file asserts the geometry itself: at several widths, and with wide
// characters in the project name, the ticket title and a comment body, NO
// rendered line may exceed the terminal width in display columns — and the body
// must therefore start on the row the chrome leaves it.
//
// BB-326 — WHICH HALF NOW CARRIES THE WEIGHT. The frame comes out of a real
// terminal grid, so the width leg can no longer catch an over-wide line by
// measuring it: the grid clips at the last column instead of wrapping, and the
// measurement passes by construction. It is kept because it still catches
// content spilling into padding, but the leg that PROVES the invariant is the
// row-index one below — and that one got stronger, not weaker: it used to count
// rows in a string the kernel wrote, and now counts rows on the screen.
//
// BB-241 Amendment B — THE MEASUREMENT IS NOT CIRCULAR ANY MORE. This check
// used to call `displayWidth`, the function under test, so a SYSTEMATIC
// under-measurement passed by construction: a row a real terminal renders at
// `width + 1` measures `width` to a buggy measurer, and the assertion holds while
// the terminal wraps the line and shifts every body row below. Measured against
// an independent implementation, a title carrying `🛜` or `⚠️` rendered 81 columns
// at width 80 — the Amendment A defect again, with a different character.
//
// The oracle (`tests/support/eaw-oracle.ts`) shares the Unicode GROUND TRUTH with
// `src/lib/width.ts` — both read the vendored `data/EastAsianWidth.txt` — and
// Node's own grapheme segmenter, but not one line of the code under test: not the
// generated range table, not the binary search, not the cluster rule, not the
// iteration. A bug in any of those five is caught here. What it cannot catch is a
// disagreement between Unicode and one specific terminal emulator, since both
// sides read the same file; that half is the plan's manual walkthrough.

// A wide-character payload. `⚡` is EAW=W and so is every CJK ideograph; `🛜`
// (U+1F6DC) is one of the 361 `W` code points the hand-listed table measured as
// ONE column; `⚠️` is an emoji PRESENTATION SEQUENCE (U+26A0, EAW=A, plus U+FE0F,
// a combining mark) that measures 1 code point by code point and renders as two
// columns everywhere. The title and meta rows have zero column slack, and the
// title is user data — so either one under-measured column wraps the chrome.
const WIDE_PROJECT = '⚡🛜日本-project';
const WIDE_TITLE = '⚠️⚡🛜 a title with 日本語 in it';

const PROJECT = 'aaaaaaaa-0000-0000-0000-000000000001';
const TICKET = 'aaaaaaaa-0000-0000-0000-000000000002';
const RUN = 'aaaaaaaa-0000-0000-0000-000000000003';

const conductorDoc = {
  data: [
    {
      id: 'c1',
      type: 'bb_conductor--bb_conductor',
      attributes: { status: 'running', last_seen: new Date().toISOString() },
      relationships: { project_id: { data: { id: PROJECT } } },
    },
  ],
  included: [
    {
      id: PROJECT,
      type: 'bb_project--bb_project',
      attributes: { name: WIDE_PROJECT },
    },
  ],
};

const ticketListDoc = {
  data: [
    {
      id: TICKET,
      type: 'bb_ticket--bb_ticket',
      attributes: {
        identifier: 'BB-241',
        title: WIDE_TITLE,
        state: 'coding',
        derived_status: 'running',
      },
      relationships: { labels: { data: [] } },
    },
  ],
};

const ticketDetailDoc = {
  data: {
    id: TICKET,
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'BB-241',
      title: WIDE_TITLE,
      state: 'coding',
      derived_status: 'running',
      description: `⚡🛜⚠️ description line one\n日本語のテキスト\nplain tail`,
    },
    // BB-255: wide characters in a LABEL and in the parent's title too — the
    // header box grew two data-bearing rows, and both are user data with zero
    // column slack.
    relationships: {
      runs: { data: [{ id: RUN }] },
      labels: { data: [{ id: 'label-1' }] },
      parent_id: { data: { id: 'parent-1' } },
    },
  },
  included: [
    {
      id: 'label-1',
      type: 'bb_term--label',
      attributes: { name: '⚠️⚡work:日本' },
    },
    {
      id: 'parent-1',
      type: 'bb_ticket--bb_ticket',
      attributes: { identifier: 'BB-240', title: WIDE_TITLE },
    },
    {
      id: RUN,
      type: 'bb_run--bb_run',
      attributes: {
        drupal_internal__id: 4599,
        state: 'running',
        state_at_start: 'coding',
        agent: 'claude',
        started_at: '2026-08-01T18:00:00+00:00',
        worktree_path: '/worktrees/⚡🛜日本',
        log: { value: '⚡🛜⚠️ log line one\n日本語のログ' },
      },
      relationships: { ticket_id: { data: { id: TICKET } } },
    },
    {
      id: 'cccccccc-0000-0000-0000-000000000001',
      type: 'bb_comment--bb_comment',
      attributes: {
        bb_comment_type: 'spec',
        author_name: '⚠️⚡cw',
        created: '2026-07-21T10:00:00+00:00',
        drupal_internal__id: 1,
        body: { value: '⚡🛜⚠️ a comment preview\n日本語の本文' },
      },
    },
  ],
};

function fakeServices(): RendererServices {
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
      if (path.startsWith('bb_conductor/')) return conductorDoc;
      if (path.startsWith(`bb_ticket/bb_ticket/${TICKET}`))
        return ticketDetailDoc;
      if (path === 'bb_ticket/bb_ticket') return ticketListDoc;
      return { data: [] };
    },
  };
  return { client, baseUrl: 'https://bakers.example' };
}

/**
 * The rows of the current screen, blank tail dropped.
 *
 * The render buffer is always the full terminal, so the frame ends in as many
 * empty rows as the composition left unused. The fake output had no such tail
 * (it recorded only what was written), and every assertion below indexes rows
 * from the top or looks for the FIRST empty row — so the tail is dropped rather
 * than reasoned about at each site.
 */
async function drawnRows(
  columns: number,
  route?: ResolvedRoute,
  keys: string[] = [],
): Promise<string[]> {
  const tui = await bootTui({
    services: fakeServices(),
    columns,
    tui: { ...(route ? { route } : {}) },
  });
  for (const key of keys) await tui.press(key);
  const rows = tui.rows();
  tui.mockInput.pressKey('q');
  await tui.running;
  await tui.stop();
  const last = rows.findLastIndex((row) => row !== '');
  return rows.slice(0, last + 1);
}

// Narrow widths matter: both tab bars truncate below ~35 / ~42 columns, so the
// chrome truncation path is exercised too, not only the padding path.
const WIDTHS = [40, 41, 80, 100, 120, 200];

const SCREENS: { name: string; route?: ResolvedRoute; keys?: string[] }[] = [
  { name: 'dashboard' },
  {
    name: 'project table',
    route: { screen: 'project', projectId: PROJECT, projectName: WIDE_PROJECT },
  },
  {
    name: 'ticket detail (Overview)',
    route: { screen: 'ticket', ticketId: TICKET, view: 'full' },
  },
  {
    name: 'ticket detail (Comments)',
    route: { screen: 'ticket', ticketId: TICKET, view: 'full' },
    keys: ['\t'],
  },
  // BB-255: the two new shapes — the Runs tab (a fixed-column table on a screen
  // whose header box is one row taller) and the run detail screen (its own box).
  {
    name: 'ticket detail (Runs)',
    route: { screen: 'ticket', ticketId: TICKET, view: 'full' },
    keys: ['\t', '\t', '\t'],
  },
  {
    name: 'run detail',
    route: {
      screen: 'ticket',
      ticketId: TICKET,
      view: 'full',
      tab: 'runs',
      runId: RUN,
    },
  },
];

describe('BB-241 Amendment A — rendered row geometry (AC-13)', () => {
  it('no rendered line exceeds the terminal width', async () => {
    for (const width of WIDTHS) {
      for (const screen of SCREENS) {
        const rows = await drawnRows(width, screen.route, screen.keys ?? []);
        rows.forEach((row, i) => {
          expect(
            oracleWidth(row),
            `${screen.name} at width ${width}, line ${i}: ${JSON.stringify(row)}`,
          ).toBeLessThanOrEqual(width);
        });
      }
    }
  });

  it('the body starts after the tab bar and its separator', async () => {
    // With a wide-character project name present: the row carrying it must be
    // after the FRAME top and list header — exactly `BAR_CHROME` chrome lines
    // precede the body. If a chrome line wraps, this index shifts and every
    // click lands one row too high.
    // BB-256 AC-1: the root landing screen is the Dashboard, so one Tab to the
    // projects overview — which is the screen carrying the wide-character name
    // this geometry check needs.
    // BB-345 D6 — the projects list has a HEADER row now, so the row carrying
    // the wide-character name is the body's SECOND content line rather than its
    // first. BB-375 — separator under the bar, then FRAME top, header, project.
    const rows = await drawnRows(120, undefined, ['\t']);
    const first = rows.findIndex((row) => row.includes(WIDE_PROJECT));
    expect(first, 'the project row is rendered').toBeGreaterThan(-1);
    // BB-375 A′ — chrome ends with the separator; body opens with the FRAME.
    expect(
      rows[BAR_CHROME - 1],
      'the row above the body is the tab bar',
    ).toMatch(/\[/);
    expect(rows[BAR_CHROME], 'the body starts with the frame top').toMatch(/╭/);
    expect(rows[BAR_CHROME + 1], 'then the list header').toContain('PROJECT');
    expect(first, 'the header row precedes it').toBe(BAR_CHROME + 2);
  });

  // BB-239 AC-15 / BB-255 R4 — REWRITTEN TWICE, and this is the second time.
  //
  // BB-239 used to be read here as "the ticket screen draws no top-level bar",
  // which was true of the layout it shipped and was never its subject. Its
  // subject is the one `top-tab-bar.test.ts` states: a screen draws EXACTLY ONE
  // bar, and it is the one of its OWN level. The ticket screen had no level and
  // drew its sections as the header box's last content row; since BB-346 it has
  // the `ticket` level and the chrome draws them in the ordinary bar row. One
  // bar either way — what changed is which row it is on and who composes it.
  //
  // BB-255 D8 is the other half of the history: the box grew a labels row, so
  // the ticket body stopped starting one row above a bar screen's and started on
  // the same row for a different reason. BB-346 removed even that difference —
  // for one ticket. BB-369 D1's state row puts the ticket screen a row BELOW a
  // bar screen, which is why `TICKET_CHROME` exists again beside `BAR_CHROME`
  // instead of both being measured against one number.
  //
  // Asserted here: no OTHER level's bar appears on the ticket screen, the ticket
  // level's own bar does, and the three chromes stand in their measured order —
  // the RUN screen (two box rows, no bar) a row above a bar screen, and the ticket
  // screen a row below it. All read off the real renderer, so no constant
  // certifies itself.
  it('the ticket screen draws its own bar and no other level’s, and the run screen sits one row higher', async () => {
    const bar = await drawnRows(120, {
      screen: 'project',
      projectId: PROJECT,
      projectName: WIDE_PROJECT,
    });
    const ticket = await drawnRows(120, {
      screen: 'ticket',
      ticketId: TICKET,
      view: 'full',
    });
    const runScreen = await drawnRows(120, {
      screen: 'ticket',
      ticketId: TICKET,
      view: 'full',
      tab: 'runs',
      runId: RUN,
    });

    const firstBody = (rows: string[]): number => {
      // Body index = chromeRowCount for the screen's shape (incl. SEPARATOR_ROWS).
      if (rows.some((row) => /\[Overview\]/.test(row))) return TICKET_CHROME;
      if (
        rows.some((row) =>
          /Ticket-Agents|\[My work\]|\[Work\]|\[Tickets\]/.test(row),
        )
      )
        return BAR_CHROME;
      return TWO_ROW_NO_BAR_CHROME;
    };

    // BB-239's own guarantee, asserted as such and unchanged by BB-346: no
    // chrome row of the ticket screen carries ANOTHER level's bar. `Ticket-Agents`
    // is a project-level label and appears on no ticket-level bar.
    for (const row of ticket.slice(0, firstBody(ticket))) {
      expect(row, 'no chrome row carries the project bar').not.toContain(
        'Ticket-Agents',
      );
    }
    // And the other half of "exactly one": the ticket level's own bar IS drawn.
    // The slice is the whole chrome, the bar row included — it is the chrome's
    // bar row now, not the header box's last content row — so this reaches it by
    // construction rather than by where the box happens to end.
    expect(
      ticket.slice(0, firstBody(ticket)).join('\n'),
      'the ticket level’s own bar is in the chrome’s bar row',
    ).toContain('[Overview]');

    expect(firstBody(bar), 'a bar screen: chrome 0–5, body from 6').toBe(
      BAR_CHROME,
    );
    expect(
      firstBody(ticket),
      'the ticket screen: a THREE-row box (BB-369: title, labels, state) AND a bar row — seven with SEPARATOR_ROWS = 1',
    ).toBe(TICKET_CHROME);
    // THE LIVE DELTA, and the counterpart of `tests/Kernel/chrome.test.ts`'s
    // BB-346 A7 record. That case asserts an EQUALITY between two shapes the
    // ticket screen no longer has — the box drawing its own bar as a third content
    // row, and the two-content-row box under the chrome's bar row, six rows each.
    // This one measures the shape it DOES have against a bar screen's, on the real
    // renderer, and the two numbers differ by the state row. Neither contradicts the
    // other — that one is history, this is the present — but only this one goes red
    // when the header box changes height.
    expect(
      firstBody(ticket) - firstBody(bar),
      'taller than a bar screen by the extra ticket header rows',
    ).toBe(3);
    expect(
      firstBody(runScreen),
      'the run screen: a two-row box, no bar — chrome four',
    ).toBe(TWO_ROW_NO_BAR_CHROME);
    expect(
      firstBody(bar) - firstBody(runScreen),
      'bar row + header-tab gap, measured on both screens',
    ).toBe(2);
    for (const rendered of [ticket, runScreen]) {
      expect(
        rendered[firstBody(rendered)],
        'the first body row is not empty',
      ).not.toBe('');
    }
  });
});
