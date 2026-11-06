import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import { createTextAttributes, type RGBA } from '@opentui/core';
import { THEME_SLOTS } from '../../src/lib/theme.js';
import type {
  Collection,
  DropshClient,
  RendererServices,
} from '../../src/types.js';
import { topTabBar } from '../../tests/tab-bars.js';
import { includedProjects } from '../fixtures/included-projects.js';
import { bootTui } from '../tui-harness.js';

// BB-256 AC-2 — the all-projects OVERVIEW, pinned BEFORE the rename.
//
// This ticket renames the screen the root `Projects` tab reaches (`dashboard` →
// `projects`) so the name `dashboard` can be given to the new statistics screen.
// AC-2 says that overview's CONTENT must come out of the rename unchanged. The
// pin below is that evidence, and it only counts because it was recorded on the
// UNCHANGED tree, in its own commit, before a single identifier moved.
//
// The screen pinned here is the all-projects overview — NOT the BB-223
// `'project-picker'` screen, which this ticket does not touch (spec D1).
//
// BODY ROWS, NOT THE WHOLE FRAME. A later phase of this ticket changes the root
// tab bar from `[Projects]` to ` Dashboard  [Projects]`, and that bar is drawn
// INSIDE every root screen's frame. A whole-frame pin would therefore have to
// break later and would get regenerated away under time pressure — destroying
// exactly the evidence AC-2 needs. So the snapshot covers the body window only,
// and today's bar row gets its own explicit assertion below: measured, not
// smuggled into a blob.
//
// NEVER REGENERATE THIS SNAPSHOT WITH `-u`. A snapshot rewritten after the
// change proves only that the change is consistent with itself. If it breaks,
// the rename was not pure: revert and redo the rename.
//
// The status bar is deliberately outside the pin too: it is chrome, and the
// root level gaining a second tab legitimately changes what keys it advertises.

const COLUMNS = 120;
const ROWS = 40;

/** A fixed wall clock, so the rows' derived status and relative age are stable. */
const NOW = new Date('2026-07-20T12:00:00.000Z');

const PROJECT_A = 'ffffffff-2560-0000-0000-00000000000a';
const PROJECT_B = 'ffffffff-2560-0000-0000-00000000000b';
const PROJECT_C = 'ffffffff-2560-0000-0000-00000000000c';

// Three projects covering all three reachable derived statuses, so the pin
// measures the row formatter's real output rather than one uniform line.
const conductorDoc = {
  data: [
    {
      id: 'c-running',
      type: 'bb_conductor--bb_conductor',
      attributes: { status: 'running', last_seen: '2026-07-20T11:55:00+00:00' },
      relationships: { project_id: { data: { id: PROJECT_A } } },
    },
    {
      id: 'c-stale',
      type: 'bb_conductor--bb_conductor',
      attributes: { status: 'running', last_seen: '2026-07-20T09:00:00+00:00' },
      relationships: { project_id: { data: { id: PROJECT_B } } },
    },
    {
      id: 'c-offline',
      type: 'bb_conductor--bb_conductor',
      attributes: { status: 'offline', last_seen: '2026-07-18T12:00:00+00:00' },
      relationships: { project_id: { data: { id: PROJECT_C } } },
    },
  ],
  included: [
    {
      id: PROJECT_A,
      type: 'bb_project--bb_project',
      attributes: { name: 'bakers' },
    },
    {
      id: PROJECT_B,
      type: 'bb_project--bb_project',
      attributes: { name: 'shop-de' },
    },
    {
      id: PROJECT_C,
      type: 'bb_project--bb_project',
      attributes: { name: 'laws-of-robotics' },
    },
  ],
};

function fakeServices(): RendererServices {
  const collection = (type: string): Collection => {
    const c: Collection = {
      where: () => c,
      whereIn: () => c,
      sort: () => c,
      page: () => c,
      first: async () => null,
      list: async () =>
        type === 'bb_project' ? includedProjects(conductorDoc) : [],
    };
    return c;
  };
  const client: DropshClient = {
    collection,
    get: async (path: string) => {
      if (path.startsWith('bb_conductor/')) return conductorDoc;
      return { data: [] };
    },
  };
  return { client, baseUrl: 'https://bakers.example' };
}

/**
 * BB-326 — THE PIN'S EVIDENCE IS SPLIT IN TWO, NOT WEAKENED.
 *
 * It used to be one string per row with the SGR escapes tokenised into `<inv>`
 * / `<b>` markers, because the fake output recorded the bytes the kernel wrote.
 * OpenTUI writes cells, so the escapes are no longer IN the frame — they are the
 * frame's attributes. The pin therefore keeps its snapshot as the plain text of
 * each row (unchanged, character for character, minus the markers) and asserts
 * the styling it used to carry through `captureSpans()`, which reads the same
 * attribute bits `createTextAttributes` sets. The selection highlight the old
 * comment names as the thing this pin must be able to lose is still covered —
 * by FOREGROUND_ACTIVE fg (slot 15 white), directly, rather than by a `<inv>` marker in a
 * blob (BB-375).
 */
const BOLD = createTextAttributes({ bold: true });

const hasAttribute = (
  line: { spans: { text: string; attributes: number }[] } | undefined,
  bit: number,
): boolean => (line?.spans ?? []).some((span) => (span.attributes & bit) !== 0);

const hasActiveSelection = (
  line:
    | { spans: { text: string; attributes: number; fg?: RGBA }[] }
    | undefined,
): boolean =>
  (line?.spans ?? []).some(
    (span) =>
      span.fg?.intent === 'indexed' &&
      span.fg.slot === THEME_SLOTS.foregroundActive,
  );

/** Boot the cockpit and Tab once — the overview is one Tab from My work. */
async function openOverview() {
  // No route ⇒ root My work, the landing screen, so the all-projects overview
  // the root `Projects` tab reaches is one Tab away. This is a NAVIGATION change only: the snapshot below is the one
  // recorded on the unchanged tree and must stay that way.
  const tui = await bootTui({
    services: fakeServices(),
    columns: COLUMNS,
    rows: ROWS,
  });
  await tui.press('\t');
  return tui;
}

describe('BB-256 AC-2 — the all-projects overview, pinned before the rename', () => {
  beforeEach(() => {
    // Only the clock is faked, so the rows' derived status and relative age are
    // stable; the harness's `settle()` still needs a real timer to elapse.
    setSystemTime(NOW);
  });

  afterEach(() => {
    setSystemTime();
  });

  it('renders the same body rows after the rename as before it', async () => {
    const tui = await openOverview();
    const rows = tui.rows();

    // Justify the slice structurally: rows 0-3 header box, row 4 gap, row 5
    // tab bar, row 6 framed body (BB-375 — tabs with the content).
    const last = rows.findLastIndex((row) => row !== '');
    expect(rows[0], 'row 0 is the box top border').toContain('╭');
    expect(rows[3], 'row 3 is the box bottom border').toContain('╰');
    expect(rows[4], 'row 4 is the gap above the tabs').toBe('');
    expect(rows[5], 'row 5 is the tab bar').toMatch(/\[/);
    expect(rows[6], 'row 6 is the table frame top').toContain('╭');
    expect(rows[last], 'the last drawn row is the status bar').toContain(
      'q:quit',
    );

    // BB-326 Step C: the body region now GROWS into everything the chrome and
    // the footer leave, so the rows the composition wrote are followed by the
    // viewport's empty remainder — thirty of them at this terminal size. This
    // pin is about the rows that were WRITTEN, so the blank tail is trimmed
    // here; that the tail exists at all, and that the footer sits below it on
    // the terminal's last row, is pinned in `Kernel/scroll-box.test.ts`. The
    // snapshot below is unchanged by the conversion, which is the point.
    const painted = rows.slice(6, last);
    // Stop at the framed panel's bottom edge — ignore empty body fill / footer.
    const frameBottom = painted.findIndex((row) => row.includes('╰'));
    const body = painted.slice(0, frameBottom + 1);

    // No escape can hide in the pin any more — the renderer paints cells, so a
    // stray control byte would be a literal character in the frame.
    for (const row of body) {
      expect(row, 'no escape reaches the screen as text').not.toContain('\x1b');
    }

    // BB-345 — THE SNAPSHOT GAINS ONE ROW AT THE TOP, AND THE PROJECT COLUMN
    // WIDENS. THE VALUES AND THEIR ORDER DO NOT MOVE.
    //
    // Two deliberate changes, both operator decisions, and each visible here as
    // exactly what it is:
    //
    //  1. D6 — the projects list gets the header row every other list has. Three
    //     unlabelled columns were readable because there are three of them, and
    //     "a list has a header" is worth more than that accident.
    //  2. AC 5 — PROJECT is the list's GROWER. Task 5 first shipped it as a fixed
    //     24, and at this very terminal width that left 74 columns of whitespace
    //     behind the trailing AGE while a 47-character project name was cut to
    //     `a-really-long-project-n…` — the ticket's own finding 3, reproduced on
    //     the list this ticket was converting. Measured before and after at 80,
    //     120 and 160 columns: the row went from 46 columns wide at every
    //     terminal width to 78 / 118 / 158, i.e. from 34 / 74 / 114 columns
    //     unused to 2 (the slack inside AGE's own 8-column budget).
    //
    // What that costs, stated because the whitespace below makes it look like a
    // regression and it is not: STATUS and AGE now sit far to the right, because
    // the surplus is PROJECT's. What it does NOT cost is any value in this pin —
    // every cell is character for character the one this file recorded on the
    // unchanged tree, in the same column order, with the same one-column gaps.
    // The file's rule still stands: this was NOT regenerated with `-u`; the rows
    // were read off the failure and checked against the configuration's budgets.
    // BB-375 A′ — projects overview wraps the table in a rounded FRAME,
    // flush with the chrome header (no BODY_INSET).
    expect(body).toMatchInlineSnapshot(`
      [
        "╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮",
        "│ PROJECT                                                                                      STATUS         AGE      │",
        "│ bakers                                                                                       online         5m ago   │",
        "│ shop-de                                                                                      stale          3h ago   │",
        "│ laws-of-robotics                                                                             offline        2d ago   │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "│                                                                                                                      │",
        "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
      ]
    `);

    // The `<inv>` marker the snapshot used to carry, asserted as the attribute
    // it really is: the selected row is highlighted and the others are not.
    //
    // BB-375 — body starts at row 6 with the frame top; header at 7,
    // selected data row at 8. Selection is a node attribute and the cursor is
    // found through `rowIds`, both position-free since BB-340.
    const spans = tui.captureSpans().lines;
    expect(hasActiveSelection(spans[7]), 'the header is not selected').toBe(
      false,
    );
    expect(
      hasActiveSelection(spans[8]),
      'the selected row is FOREGROUND_ACTIVE fg',
    ).toBe(true);
    expect(hasActiveSelection(spans[9]), 'row 9 is not').toBe(false);
    expect(hasActiveSelection(spans[10]), 'row 10 is not').toBe(false);

    // BB-345 AC 3, on THIS surface and on real cells: the header is
    // distinguishable from a data row, and bold is the thing that distinguishes
    // it. Invisible to the snapshot above — it is the frame's attributes, not its
    // text — so a header that read as one more data row would pass every
    // assertion in this file without it.
    expect(hasAttribute(spans[7], BOLD), 'the header row is bold').toBe(true);
    expect(hasAttribute(spans[8], BOLD), 'a data row is not bold').toBe(false);
    tui.mockInput.pressKey('q');
    await tui.running;
    await tui.stop();
  });

  it('draws the root tab bar with [Projects] bracketed', async () => {
    const tui = await openOverview();

    // Measured explicitly rather than folded into the snapshot: this row is the
    // one the later phases legitimately change, and the snapshot is the one they
    // must not. It is CONSTRUCTED from the registry, so it followed the bar from
    // `[Projects]` to ` Dashboard  [Projects]` without being rewritten — which is
    // exactly why the pin could stay untouched. BB-340 Task 11 stopped padding
    // the bar to the terminal width — its blank columns are the terminal's own
    // now — and Task 12 deleted the `fitLine` that used to pad this reference to
    // match; the harness right-trims either way, so the comparison is against
    // the same string minus its right-hand blanks.
    expect(tui.rows()[5]).toBe(
      ` ${topTabBar('root', 'projects')}`.replace(/\s+$/, ''),
    );
    // …and it is still the BOLD row it always was.
    expect(hasAttribute(tui.captureSpans().lines[5], BOLD)).toBe(true);

    tui.mockInput.pressKey('q');
    await tui.running;
    await tui.stop();
  });
});
