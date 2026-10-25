import { describe, expect, it } from 'bun:test';
import { tabBarFor } from '../../src/Component/top-tabs/index.js';
import { tabViewTree } from '../../src/Entity/ticket/Component/ticket-detail/index.js';
import {
  type ChromeInput,
  HEADER_TAB_GAP_ROWS,
  SEPARATOR_ROWS,
  TAB_BAR_ID,
} from '../../src/Kernel/chrome.js';
import { buildRoutes } from '../../src/Routing/routes.js';
import type {
  Collection,
  DropshClient,
  RendererServices,
  ResolvedRoute,
  TicketDetailDocument,
} from '../../src/types.js';
import {
  chromeRowCount,
  chromeRowOf,
  chromeShape,
  shapeHeaderRowId,
} from '../../tests/chrome-rows.js';
import { renderTree } from '../../tests/render-tree.js';
import { PROJECT_TABS, ROOT_TABS, topTabBar } from '../../tests/tab-bars.js';
import { type BootedTui, bootTui, settle } from '../tui-harness.js';

// BB-239 — navigation has THREE levels and every screen shows exactly ONE tab
// bar: the one of its own level.
//
//   root     dashboard, projects, project-picker  → Dashboard · Projects
//   project  dashboard, project, ticket-agents,   → Dashboard · Tickets ·
//            project-runs                           Ticket-Agents · Runs
//   ticket   overview, comments, related, runs    → the sections of one open
//                                                    ticket, in the bar row (BB-346)
//
// The ticket screen was the first half of this ticket: it already drew its own
// bar, so a second one three rows below advertised navigation the operator
// cannot take there and made `Runs` mean two different things within three rows.
// Review finding F1 then showed the same defect one level up — `dashboard` and
// `project-picker` bracketed `[Tickets]` although they are the PROJECT list and
// the "Which project?" screen, with two of the three tabs dead ends there.
//
// Driven through the REAL kernel — `runTicketTui` over the OpenTUI test renderer
// from `tests-bun/tui-harness.ts`, real keystrokes through `mockInput`, real
// clicks through `mockMouse`, and the CURRENT SCREEN read back out of the render
// buffer. That is the layer a human sees; there is no pure-function stand-in.
//
// BB-326 — WHAT THE SWAP CHANGED HERE. The fake output recorded the bytes the
// kernel wrote, so a row carried its SGR escapes and the frame ended at the last
// row anything was written into. OpenTUI paints cells: the escapes are attributes
// and are not in the text, and the buffer is always the full terminal, so the
// frame ends in blank rows. The constructed expectations below therefore drop
// their `ANSI.*` wrappers, and `rowsOf` drops the blank tail so that "the last
// row" still means the status bar. Nothing else about a row's text moved.
//
// FRAME ANATOMY. A frame is the terminal grid as it stands right now, each row
// right-trimmed and the blank tail dropped (see `rowsOf`). Rows 0-3 are the
// header box (top border, title, meta, bottom border). On a screen that carries
// a bar row 4 is the bar and rows 5–6 the separators (BB-375), with the body
// from row 7. The last row is the status bar.
//
// NO INLINE SNAPSHOTS. The pre-change pins of the first round froze exactly the
// frames F1 declares wrong, so they had to go; and a snapshot re-recorded after
// the change would only prove the change is consistent with itself. Every
// expectation below is CONSTRUCTED from the registry instead — a reviewer reads
// intent rather than a diffable blob, and a renamed tab moves test and source
// together by construction.

// The chrome's rows are padded to the terminal width, so the constructed rows
// below depend on the terminal size. Pin both axes rather than leaning on the
// harness defaults. Every case in this file runs at this ONE size: the narrow
// terminals BB-241 cares about are exercised in `render-geometry.test.ts`,
// which varies the width; nothing here truncates a bar.
const COLUMNS = 120;
const ROWS = 40;

/**
 * The body window — PER SCREEN since BB-326 Step C.
 *
 * It used to be a screen-agnostic `ROWS - 9` here, restating the kernel's own
 * `terminalRows() - 8` (already off by one against it, and harmless only
 * because every body in this file is shorter than either). There is no such
 * constant left to restate: the window is everything the screen's own chrome
 * and the status row leave, so this counts the chrome off the COMPOSED TREE —
 * `chromeRowCount`, which BB-340 Task 11 put in place of the deleted
 * `lib/hit-test.ts`'s `chromeRows` (spec D6).
 */
const viewHeight = (shape: ChromeInput): number =>
  Math.max(1, ROWS - chromeRowCount(shape) - 1);
/**
 * The ticket screen — BB-369: a THREE-row header box and the top-tab bar.
 *
 * It was `chromeShape(3, false)`: title, labels and the screen's own detail bar
 * inside the box, with no bar row. BB-346 made the sections the `ticket`
 * level's entries, so the third content row became the bar row and the chrome
 * stayed the same height, composed the way every other level's is (spec F4/A7).
 *
 * BB-369 D1 then added a STATE row to the box, and that equality of height is
 * what it spends: this screen's chrome is one row taller than every other bar
 * screen's now, and it is the only screen with a shape of its own again. The row
 * is paid for from the body window (`chromeHeight` sizes it from
 * `headerRowCount()`), which is the deliberate cost R3 names — the state is worth
 * a row, exactly as BB-255 judged the labels to be.
 */
const TICKET_SHAPE = chromeShape(2, true);
/** Every project-level screen: a two-row header box and the top-tab bar. */
const PROJECT_SHAPE = chromeShape(2, true);

const PROJECT = 'ffffffff-2390-0000-0000-000000000002';
const TICKET = 'ffffffff-2390-0000-0000-000000000001';

// Deterministic fixtures only: nothing in the chrome rows may derive from
// Date.now(). `last_seen` is a FIXED past timestamp — its relative age lands in
// the dashboard's body rows, which nothing here asserts on.
const conductorDoc = {
  data: [
    {
      id: 'c1',
      type: 'bb_conductor--bb_conductor',
      attributes: {
        status: 'running',
        last_seen: '2026-07-20T10:00:00+00:00',
      },
      relationships: { project_id: { data: { id: PROJECT } } },
    },
  ],
  included: [
    {
      id: PROJECT,
      type: 'bb_project--bb_project',
      attributes: { name: 'bakers' },
    },
  ],
};

// Typed, because the AC-3 row-count identity DERIVES the body height from this
// very document via `tabViewTree` instead of hardcoding a frame length.
//
// The description deliberately QUOTES `Ticket-Agents`, which is what review
// finding F2 was about: the first round asserted `Ticket-Agents` absent from the
// whole frame and passed only because no fixture mentioned it. Against the real
// BB-239 ticket, whose body quotes the label twice, that assertion would have
// failed while AC-1 was perfectly satisfied. Every absence assertion below is
// BAR-SCOPED, and this fixture is what proves it.
const ticketDoc: TicketDetailDocument = {
  data: {
    id: TICKET,
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'BB-239',
      title: 'no top tabs on the ticket screen',
      state: 'coding',
      derived_status: 'idle',
      workflow: 'bb_work',
      description:
        'The ticket description body, quoting Ticket-Agents and Runs on purpose.',
    },
    relationships: { runs: { data: [] } },
  },
  included: [],
};

const ticketListDoc = {
  data: [
    {
      id: TICKET,
      type: 'bb_ticket--bb_ticket',
      attributes: {
        identifier: 'BB-239',
        title: 'no top tabs on the ticket screen',
        state: 'coding',
        derived_status: 'idle',
      },
      relationships: { labels: { data: [] } },
    },
  ],
};

const projectListDoc = {
  data: [
    {
      id: PROJECT,
      type: 'bb_project--bb_project',
      attributes: { name: 'bakers', key: 'bakers.build' },
      relationships: { group_id: { data: null }, teams: { data: [] } },
    },
  ],
  included: [],
};

/** `ticketTableRows` emits a header row plus one row per ticket. */
const PROJECT_BODY_LINES = 1 + ticketListDoc.data.length;

const CANDIDATES = [
  { id: PROJECT, name: 'shop-de' },
  { id: 'ffffffff-2390-0000-0000-000000000009', name: 'shop-at' },
];

// Stats reads one grouped atomic document. None of the
// tab-bar/navigation behaviour this file drives depends on a figure's actual
// numbers — root-scope reads
// also resolve `user/user` first (spec D6: root now means "my own figures",
// not a workspace total) — so the fixture below stays deliberately minimal:
// an empty, well-formed grouped answer by default, and an HTTP status a case
// can force the read to reject with.

/** How the statistics DISCOVERY read behaves for a given boot. */
interface StatsBehaviour {
  /** Reject the discovery read with this HTTP status instead of answering. */
  status?: number;
}

/**
 * Every read the kernel can make on these screens. No `agents` service, so the
 * Ticket-Agents screen lists nothing; every unmatched path answers an empty
 * collection, which is what makes `project-runs` deterministic.
 */
function fakeServices(
  /**
   * When given, the `bb_run` read parks on this promise instead of answering
   * at once — the only way to observe the frame WHILE an async tab target is
   * still loading. On the real control plane that window was measured at ~6s.
   */
  runsGate?: Promise<unknown>,
  stats: StatsBehaviour = {},
): RendererServices {
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
      if (
        path === 'bakers/statistics' ||
        path.startsWith('bakers/statistics/')
      ) {
        if (stats.status !== undefined) {
          throw Object.assign(new Error(`HTTP ${stats.status}`), {
            status: stats.status,
          });
        }
        // An empty, well-formed answer either way: no figure configured is
        // exactly R7's case (spec), and no test in this file asserts on a
        // figure's own numbers — only that the bar/navigation around it
        // still works.
        return { data: { attributes: { groups: [] } } };
      }
      if (path.startsWith('bb_conductor/')) return conductorDoc;
      if (path === 'bb_project/bb_project') return projectListDoc;
      if (path.startsWith(`bb_ticket/bb_ticket/${TICKET}`)) return ticketDoc;
      if (path === 'bb_ticket/bb_ticket') return ticketListDoc;
      if (runsGate && path.startsWith('bb_run/')) {
        await runsGate;
        return { data: [] };
      }
      return { data: [] };
    },
  };
  return { client, baseUrl: 'https://bakers.example', currentUser: 'cw' };
}

/** Workspace-lead fixtures for both contextual member entry paths. */
function fakeMemberServices(): RendererServices {
  const base = fakeServices();
  const baseGet = base.client.get.bind(base.client);
  const baseCollection = base.client.collection.bind(base.client);
  const workspace = {
    attr: (key: string) =>
      key === 'drupal_internal__id' ? 3 : key === 'name' ? 'Bb' : undefined,
  };
  const workspaceCollection = (): Collection => {
    const c: Collection = {
      where: () => c,
      sort: () => c,
      page: () => c,
      first: async () => workspace,
      list: async () => [],
    };
    return c;
  };
  const client: DropshClient = {
    collection: (type) =>
      type === 'bb_workspace' ? workspaceCollection() : baseCollection(type),
    get: async (path, params) => {
      if (path === 'user/user')
        return {
          data: [
            {
              id: 'u-cw',
              attributes: {
                name: 'cw',
                display_name: 'Christian',
                drupal_internal__uid: 4,
              },
            },
          ],
        };
      if (path === 'bb_team/bb_team')
        return {
          data: [
            {
              id: 'team-1',
              attributes: { name: 'Platform', drupal_internal__id: 7 },
            },
          ],
        };
      if (path === 'og_membership/default')
        return {
          data: [
            {
              id: 'membership-1',
              attributes: { entity_id: '7' },
              relationships: {
                uid: { data: { id: 'u-cw' } },
                roles: { data: [] },
              },
            },
          ],
        };
      if (path === 'bb_project/bb_project') return { data: [] };
      return baseGet(path, params);
    },
  };
  return {
    ...base,
    client,
    workspaceId: 'workspace-1',
    workspace: 'Bb',
    isWorkspaceAdmin: true,
  };
}

/** Boot the kernel over a pinned 120x40 terminal and return the live handles. */
async function boot(
  route?: ResolvedRoute,
  runsGate?: Promise<unknown>,
  stats: StatsBehaviour = {},
): Promise<{ tui: BootedTui }> {
  const services = fakeServices(runsGate, stats);
  const tui = await bootTui({
    services,
    columns: COLUMNS,
    rows: ROWS,
    tui: { ...(route ? { route } : {}) },
  });
  return { tui };
}

/** Shut the kernel down so its own teardown actually runs, then the renderer. */
async function quit(tui: BootedTui): Promise<void> {
  tui.mockInput.pressKey('q');
  await tui.running;
  await tui.stop();
}

/**
 * The drawn rows of the current screen — the blank tail dropped.
 *
 * The render buffer is always the full terminal, so the frame ends in as many
 * empty rows as the composition left unused. The fake output had no such tail
 * (it recorded only what was written), and the assertions below index either
 * from the TOP (rows 4/5–6, the bar and the separators) or from the END (`at(-1)`
 * is the status bar; `slice(7, -1)` is the body; `toHaveLength` is the composed
 * height). Dropping the tail is what keeps the second kind meaning what it said.
 */
const rowsOf = (tui: BootedTui): string[] => {
  const rows = tui.rows();
  return rows.slice(0, rows.findLastIndex((row) => row !== '') + 1);
};

/** The drawn rows as one string — the old `frame(output)`, current-screen. */
const frameOf = (tui: BootedTui): string => rowsOf(tui).join('\n');

// The ticket header now has TWO content rows: title and a compact meta line
// carrying state · assignee · labels without prefixes. The old separate rows
// for labels (D8) and state (BB-369 D1) are collapsed into the single meta
// line. Both are found on the SAME row, derived from the composed chrome.
/** Frame index of the meta row — carries state, assignee and labels. */
const TICKET_META_INDEX = chromeRowOf(TICKET_SHAPE, shapeHeaderRowId(1)) - 1;
/** The ticket screen's header box: two frames plus TWO content rows. */
const TICKET_BOX_ROWS = 4;
/**
 * Frame index of the bar row — the same row every other level's bar sits in.
 *
 * Derived like its sibling above, and for the same reason: a bare `4` is a number
 * the next header row invalidates silently, while the id says WHICH row is meant.
 * `chromeRowOf` is 1-based (it answers in terminal rows), so `- 1` reads it as a
 * frame index. The sibling files address the same row this way
 * (`route-boot.test.ts`, `ticket-detail-screen.test.ts`).
 */
const TICKET_BAR_INDEX = chromeRowOf(TICKET_SHAPE, TAB_BAR_ID) - 1;

const PROJECT_ROUTE: ResolvedRoute = {
  screen: 'project',
  projectId: PROJECT,
  projectName: 'bakers',
};

const TICKET_ROUTE: ResolvedRoute = {
  screen: 'ticket',
  ticketId: TICKET,
  view: 'full',
};

const TAB = '\t';
const SHIFT_TAB = '\x1b[Z';

/**
 * One physical left click on a 1-based terminal row/column, press AND release
 * (BB-241).
 *
 * BB-326 — the raw SGR pair is gone: OpenTUI decodes the reports itself and
 * `mockMouse.click` is one physical click, press and release together.
 *
 * COORDINATES. `row`/`col` stay the 1-BASED terminal coordinates the SGR report
 * carried; `mockMouse` takes 0-based BUFFER coordinates, so the shift happens
 * here and here only. The `a click one row below the bar` case below is what
 * proves it is not off by one.
 *
 * The bar is written as `' ' + <bar>`, so the bar's own column 0 is terminal
 * column 2. BB-256 put `Dashboard` first on both levels, so the
 * project bar is now `[Dashboard](11) '  ' Tickets(9) '  ' Ticket-Agents(15)
 * '  ' Runs(6)` — ` Runs ` at bar offsets 41..47, i.e. terminal columns 43..49.
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

/** Terminal row 5 — the bar row on a screen that draws one (frame index 4). */
/** 1-based tab row on a two-content-row bar screen (gap above tabs, BB-375). */
const BAR_ROW = chromeRowOf(chromeShape(2, true), TAB_BAR_ID);
/** Inside the project bar's ` Runs ` label. */
const COL_RUNS = 53;
/** Inside the project bar's `[Overview]`/` Overview ` label — the first tab. */
const COL_OVERVIEW = 6;

/**
 * Row 4 exactly as `renderScreen` writes a bar, constructed from the registry.
 *
 * BB-326: no `ANSI.bold` wrapper any more — the renderer paints cells, so bold
 * is an attribute of the row rather than two escapes around its text. BB-340
 * Task 11 stopped padding the bar to the terminal width (its blank columns are
 * the terminal's own now) and Task 12 deleted the `fitLine` that used to do the
 * padding here too; the harness right-trims either way, so the comparison is the
 * same string minus its right-hand blanks.
 */
const rootBarRow = (activeId: string): string =>
  ` ${topTabBar('root', activeId)}`.replace(/\s+$/, '');

const projectBarRow = (activeId: string): string =>
  ` ${topTabBar('project', activeId)}`.replace(/\s+$/, '');

// BB-346 — `metaRow` IS GONE. It built the header box's meta row as a reference
// (`│ ` + padded text + ` │`) and its only caller was the ticket screen's own tab
// bar, the one row this ticket moved out of the box. Every bar in this file is a
// bar ROW now, built by `rootBarRow`/`projectBarRow`/`ticketBarRow`, so there is
// nothing left that needs a box row transcribed.

/**
 * The ticket screen's bar row — BB-346, and the same expression as the other two.
 *
 * It was `detailBar(activeIndex)`, read out of the ticket slice's own
 * `detailTabBarTree` and compared against a `metaRow(...)` INSIDE the header box.
 * The sections are top-tab entries now, so the reference is built exactly as
 * `rootBarRow` and `projectBarRow` are — from the registry, through the same
 * `topTabBar` the chrome's nodes come from — and it is a bar ROW, not a box row.
 * That the three now share one construction is the point: the ticket screen pays
 * for nothing the other levels have not paid for.
 */
const ticketTabs = buildRoutes().tabs('ticket');
const ticketBarRow = (activeId: string): string =>
  ` ${tabBarFor({ level: 'ticket', tab: activeId, tabs: ticketTabs })}`.replace(
    /\s+$/,
    '',
  );

/**
 * Every bar the renderer could possibly write, on ALL THREE levels, with any tab
 * bracketed. This is what makes the absence assertions BAR-SCOPED (review
 * finding F2): a ticket body may legitimately quote `Ticket-Agents` or `Runs`,
 * so only a whole rendered BAR counts as "a bar is on screen".
 *
 * "Either level" is what this said while there were two, and it stayed while
 * `TICKET_BARS` was added directly below it — a count that outlived its code, in
 * a file that has one three-level list under it.
 */
// BB-326 — matched in their RIGHT-TRIMMED form. The bar is the last text on
// its row, so the harness's right-trim takes the bar's own trailing blank with
// it and a raw `row.includes(bar)` would find nothing on a screen that draws
// exactly that bar. Each bar is still 40+ characters of bracketed labels, so
// dropping one trailing blank costs the scoping nothing.
const ROOT_BARS = ROOT_TABS.map((t) =>
  topTabBar('root', t.id).replace(/\s+$/, ''),
);
const PROJECT_BARS = PROJECT_TABS.map((t) =>
  topTabBar('project', t.id).replace(/\s+$/, ''),
);
// BB-346 R4 — the ticket level joins the set, so `anyBarRows` really means "any
// bar". The compact views must draw NO bar, and until the ticket level existed
// there was no way to say that about the bar they were at risk of growing.
const TICKET_BARS = ticketTabs.map((t) =>
  tabBarFor({ level: 'ticket', tab: t.id, tabs: ticketTabs }).replace(
    /\s+$/,
    '',
  ),
);

const rowsContaining = (tui: BootedTui, bars: string[]): string[] =>
  rowsOf(tui).filter((row) => bars.some((bar) => row.includes(bar)));

const rootBarRows = (tui: BootedTui): string[] =>
  rowsContaining(tui, ROOT_BARS);
const projectBarRows = (tui: BootedTui): string[] =>
  rowsContaining(tui, PROJECT_BARS);
const anyBarRows = (tui: BootedTui): string[] =>
  rowsContaining(tui, [...ROOT_BARS, ...PROJECT_BARS, ...TICKET_BARS]);

// ---------------------------------------------------------------------------
// BB-256 — ONE Dashboard screen, filtered by project or not.
//
// Spec D2: the root Dashboard and the project Dashboard are the SAME screen with
// its filter unset or set, and its tab-bar LEVEL is the same bit as its filter.
// So every assertion below is really one assertion twice: the bar and the
// figures must always agree, because they read one value.
// ---------------------------------------------------------------------------

/**
 * The body window of a frame that carries a bar: 4 box + bar (SEPARATOR_ROWS =
 * 0), up to but not including the status bar (BB-375).
 *
 * BB-326 — the escape stripping is GONE, and with it the last reason the
 * assertions below read as a byte stream. `styleVisibleLines` still wraps a bold
 * row (every section heading) in `ANSI.bold`/`ANSI.reset`, but the renderer turns
 * those into an attribute of the cells, so a heading really is `=== 'TICKETS
 * CLOSED'` on screen. The slice is only meaningful because `rowsOf` dropped
 * the blank tail — against the raw grid, `-1` would be terminal row 39.
 */
const _bodyOf = (tui: BootedTui): string[] =>
  rowsOf(tui).slice(chromeRowCount(chromeShape(2, true)), -1);

// BB-456 D6 deleted `lastNumber`/`BLOCK_HEADINGS`/`withoutFrameRules`/
// `blockRows`/`groupRows`: every consumer read a titled block or group off the
// withdrawn workspace-wide TICKETS/RUNS document (`PER PROJECT`/`PER USER`
// headings, a bar-scaled breakdown row). No figure this file's fixture serves
// carries that shape any more, and no surviving test needs it.

describe('current-work product landings', () => {
  it('boots My work at root and Work for a project deep link', async () => {
    const root = await bootTui({
      services: fakeServices(),
      columns: COLUMNS,
      rows: ROWS,
      useProductLanding: true,
      tui: {},
    });
    expect(root.frame()).toContain('[My work]');
    expect(root.frame()).toContain('BB-239');
    await quit(root);

    const project = await bootTui({
      services: fakeServices(),
      columns: COLUMNS,
      rows: ROWS,
      useProductLanding: true,
      tui: { route: PROJECT_ROUTE },
    });
    expect(project.frame()).toContain('[Overview]');
    expect(project.frame()).toContain('bakers · overview');
    await quit(project);
  });
});

describe('contextual member sitemap', () => {
  const adminRoutes = buildRoutes([], true);
  const memberBar = (scope: 'workspace-member' | 'team-member', tab: string) =>
    ` ${tabBarFor({ level: scope, tab, tabs: adminRoutes.tabs(scope) })}`.replace(
      /\s+$/,
      '',
    );

  it('enters a workspace member, cycles all tabs, and Esc returns to the roster', async () => {
    const tui = await bootTui({
      services: fakeMemberServices(),
      columns: COLUMNS,
      rows: ROWS,
      useProductLanding: true,
      tui: {
        isWorkspaceAdmin: true,
        workspaceId: 'workspace-1',
        workspace: 'Bb',
      },
    });
    for (let i = 0; i < 4; i++) await tui.press(TAB);
    expect(tui.frame()).toContain('Workspace members');
    await tui.press('\r');
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(
      memberBar('workspace-member', 'overview'),
    );
    for (const tab of ['stats', 'tickets', 'runs', 'overview']) {
      await tui.press(TAB);
      expect(rowsOf(tui)[BAR_ROW - 1]).toBe(memberBar('workspace-member', tab));
    }
    await tui.press('\x1b');
    expect(tui.frame()).toContain('Workspace members');
    await quit(tui);
  });

  it('enters a team member, cycles all tabs, and Esc returns to Team Members', async () => {
    const tui = await bootTui({
      services: fakeMemberServices(),
      columns: COLUMNS,
      rows: ROWS,
      useProductLanding: true,
      tui: {},
    });
    for (let i = 0; i < 3; i++) await tui.press(TAB);
    await tui.press('\r');
    await tui.press(TAB);
    await tui.press(TAB);
    expect(tui.frame()).toContain('Platform · members');
    await tui.press('\r');
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(memberBar('team-member', 'overview'));
    for (const tab of ['stats', 'tickets', 'runs', 'overview']) {
      await tui.press(TAB);
      expect(rowsOf(tui)[BAR_ROW - 1]).toBe(memberBar('team-member', tab));
    }
    await tui.press('\x1b');
    expect(tui.frame()).toContain('Platform · members');
    await quit(tui);
  });
});

describe('the root Stats destination', () => {
  it('draws the ROOT bar with [Stats] bracketed', async () => {
    const { tui } = await boot();

    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(rootBarRow('stats'));
    // The frameless statistics content starts directly under the tab bar.
    expect(rowsOf(tui)[4], 'gap above the bar').toBe('');
    expect(rowsOf(tui)[BAR_ROW - 1]).toMatch(/\[/);
    expect(rowsOf(tui)[BAR_ROW], 'content under the bar').toContain(
      'No figures configured',
    );
    expect(projectBarRows(tui), 'no project bar at the root').toEqual([]);

    await quit(tui);
  });

  it('draws EXACTLY ONE bar row — AC-9', async () => {
    const { tui } = await boot();
    expect(anyBarRows(tui)).toHaveLength(1);
    await quit(tui);
  });

  // BB-456 D6 deleted 'carries the TICKETS and RUNS bar blocks in its body'
  // and 'reads the statistics through the READ client, never the write one':
  // both pinned the withdrawn workspace-wide document (fixed TICKETS/RUNS
  // headings, a hard 237/48 total). Root scope now reads the account's OWN
  // configured figures (spec D6); that contract, and which client it reads
  // through, is exercised in `route-boot.test.ts` and the Kernel PHP tests.
});

// BB-456 D6 deleted 'BB-256 AC-4..AC-6 — the root Dashboard breaks the
// counts down' in full: every case in it (PER PROJECT/PER USER blocks, the
// unattributed row, per-entity-type bar scaling, the sum invariant) asserted
// against the withdrawn workspace-wide breakdown. Root/user scope now ships
// no breakdown figure at all (plan stage 7); the sum invariant (spec D8) and
// the unattributed-row guard are pinned server-side by the adapted
// the composite statistics kernel tests and exercised over JSON:API.

describe('BB-256 AC-2 — the root Projects tab still reaches the overview', () => {
  it('Tab reaches Projects, and its bar carries the Stats entry', async () => {
    const { tui } = await boot();
    await tui.press(TAB);

    expect(frameOf(tui)).toContain('bakers.build projects');
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(rootBarRow('projects'));
    expect(rowsOf(tui)[BAR_ROW - 1]).toContain('Stats');
    expect(projectBarRows(tui)).toEqual([]);

    await quit(tui);
  });

  // D14b: `dashboard` and `projects` are both BASE screens — neither is an
  // overlay of the other, so switching between them pushes and pops NO history
  // frame. The observable form: Esc after the swap converges on the Dashboard
  // rather than unwinding a stack that should never have grown.
  it('the root level swaps FLAT — no history frame either way', async () => {
    const { tui } = await boot();

    await tui.press(TAB); // stats -> projects
    expect(frameOf(tui)).toContain('bakers.build projects');
    await tui.press(TAB); // projects -> teams
    await tui.press(TAB); // teams -> conductors
    await tui.press(TAB); // conductors -> my work
    await tui.press(TAB); // my work -> stats
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(rootBarRow('stats'));

    // Had either swap pushed a frame, this Esc would unwind it instead.
    await tui.press('\x1b');
    expect(rowsOf(tui)[BAR_ROW - 1], 'Esc converges on My work').toBe(
      rootBarRow('my-work'),
    );
    expect(frameOf(tui)).not.toContain('bakers.build projects');

    await quit(tui);
  });
});

describe('opening a project lands on its Overview tab', () => {
  it('Enter on a project row opens Overview at the PROJECT level', async () => {
    const { tui } = await boot();
    await tui.press(TAB); // -> projects
    await tui.press('\r'); // Enter on the first project row

    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('overview'));
    expect(rootBarRows(tui), 'no root bar inside a project').toEqual([]);

    await quit(tui);
  });

  it('a `--here`/deep-link boot with a project route lands on Overview', async () => {
    // Spec D12: `bakers ui project:<name>` / `--here` now lands on Overview
    // (weight 1), not on Stats. The harness boots with useProductLanding so the
    // auto-Tab is suppressed and the raw landing is observable.
    const tui = await bootTui({
      services: fakeServices(),
      columns: COLUMNS,
      rows: ROWS,
      useProductLanding: true,
      tui: { route: PROJECT_ROUTE },
    });
    await settle();
    await tui.renderOnce();

    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('overview'));
    expect(frameOf(tui)).toContain('bakers');

    await tui.press(TAB);
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('stats'));

    await quit(tui);
  });

  // BB-456 D6 deleted 'the figures are the SCOPED ones, and by_project is
  // gone': it pinned the withdrawn workspace document's PER USER breakdown at
  // project scope. The shipped composite project overview carries no member
  // navigation axis; the atomic grouped contract is exercised
  // in `route-boot.test.ts`.

  it('draws EXACTLY ONE bar row in the scoped state too — AC-9', async () => {
    const { tui } = await boot(PROJECT_ROUTE);
    expect(anyBarRows(tui)).toHaveLength(1);
    await quit(tui);
  });
});

// Spec D2 — the invariant that REPLACES the retired "tab ids are globally
// unique" test. `gotoTopTab` must resolve a tab id WITHIN the current level;
// driven from the project level, `Dashboard` must produce the PROJECT bar. That
// is the exact defect the level-blind `locateTab` would cause, and it is a test
// now rather than a naming convention.
describe('project tabs resolve within the CURRENT level', () => {
  it('Shift-Tab from Tickets returns to project Stats', async () => {
    const { tui } = await boot(PROJECT_ROUTE);
    await tui.press(TAB); // stats -> tickets
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('tickets'));

    await tui.press(SHIFT_TAB); // back onto Stats

    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('stats'));
    expect(rootBarRows(tui), 'never the root bar').toEqual([]);

    await quit(tui);
  });

  it('a CLICK on project Overview draws the PROJECT bar', async () => {
    // Both routes converge on `gotoTopTab`, so both are driven — "it is the same
    // function" is exactly the claim a future refactor breaks.
    const { tui } = await boot(PROJECT_ROUTE);
    await tui.press(TAB); // stats -> tickets
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('tickets'));

    await click(tui, BAR_ROW, COL_OVERVIEW);

    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('overview'));
    expect(rootBarRows(tui)).toEqual([]);

    await quit(tui);
  });

  // BB-326 — THE 0-BASED/1-BASED SEAM, PROVEN RATHER THAN ASSUMED.
  // BB-340 Task 11 (spec A7/D6) — and it is now the RENDERER'S seam.
  //
  // A click used to travel through two translations that had to cancel:
  // `click()` subtracts one to reach `mockMouse`'s 0-BASED buffer coordinates,
  // and the kernel's `onMouse` added it back (`row = event.y + 1`) to reach the
  // 1-based rows the deleted `lib/hit-test.ts` spoke. There is no such addition
  // left — a click lands on the node OpenTUI's own hit grid finds, and the tab
  // bar's row resolves it from the child under the pointer — so what this case
  // guards is the composition: the tab nodes cover the bar row and NOTHING else.
  //
  // It still bites in both directions, and both were measured rather than
  // assumed (Task 11): moving the bar's `onMouse` down onto the body row
  // breaks the first leg (the bar click stops switching), and letting the tab
  // nodes reach one row further down breaks the second (the body click
  // starts switching). Every other click case in this file would pass through
  // either mutation — none of them clicks a row whose neighbour behaves
  // differently.
  it('a click one row below the bar does not switch tabs — the 0-based/1-based seam', async () => {
    const { tui } = await boot(PROJECT_ROUTE);
    await tui.press(TAB); // stats -> tickets
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('tickets'));
    // The two coordinate systems agree on this row by construction: the bar is
    // frame index 4 (0-based, like `mockMouse`) and terminal row 5 (1-based,
    // like the SGR report), which is `BAR_ROW`.
    expect(BAR_ROW).toBe(6);

    await click(tui, BAR_ROW, COL_OVERVIEW);
    expect(rowsOf(tui)[BAR_ROW - 1], 'BAR_ROW really is the bar').toBe(
      projectBarRow('overview'),
    );

    await tui.press(TAB); // -> stats
    await tui.press(TAB); // -> tickets, so the next click has work to do
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('tickets'));

    // BB-375 — SEPARATOR_ROWS = 0; the row under the bar is the framed body.
    await click(tui, BAR_ROW + 1, COL_OVERVIEW);
    expect(
      rowsOf(tui)[BAR_ROW - 1],
      'the body row under the bar is inert for tabs',
    ).toBe(projectBarRow('tickets'));

    await quit(tui);
  });
});

// Spec D14c / fact 24 — `currentProjectId` did not round-trip through
// `Snapshot`. Harmless while the root level had one tab and nothing there read
// it; under D2 the Dashboard's LEVEL is `currentProjectId !== null`, so a stale
// id after Esc would draw the project bar on the root Dashboard and filter the
// figures to a project the operator has left.
// BB-456 D6 deleted 'BB-256 D14c — Esc out of a project un-scopes the
// Dashboard' in full: there is no unfiltered/workspace-wide state left for
// Esc to un-scope BACK TO — root scope is now the account's own figures, a
// project's figures are that project's own config-entity figures, and neither
// is "the same figures, filtered". The 'stale `currentProjectId`' hazard this
// test guarded is still real and is exercised where it can still mean
// something: `route-boot.test.ts`'s project/root boot cases.

describe('the project level cycles every sitemap tab', () => {
  it('Tab cycles in registry order and wraps', async () => {
    const { tui } = await boot(PROJECT_ROUTE);

    // The harness auto-tabs from the overview landing to stats; the cycle
    // starts and ends there (the project tab set is overview→stats→tickets→…).
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('stats'));

    // One Tab per remaining registry entry, then two more to wrap back to stats.
    for (const id of [
      ...PROJECT_TABS.slice(2).map((t) => t.id),
      'overview' as const,
      'stats' as const,
    ]) {
      await tui.press(TAB);
      expect(rowsOf(tui)[BAR_ROW - 1], `Tab lands on ${id}`).toBe(
        projectBarRow(id),
      );
      expect(rootBarRows(tui), `${id} is still the project level`).toEqual([]);
    }

    await quit(tui);
  });

  // BB-450 added `conductors` as the project level's fifth (and last) tab.
  // Read off `PROJECT_TABS` rather than hardcoded, so a future addition
  // moves this test with it instead of silently going stale.
  it('Esc from the last project tab returns to Overview', async () => {
    const lastTab = PROJECT_TABS.at(-1)?.id ?? 'conductors';
    const { tui } = await boot(PROJECT_ROUTE);
    // The harness auto-tabs from overview to stats; from stats, one SHIFT_TAB
    // reaches overview, and a second wraps to the last tab.
    await tui.press(SHIFT_TAB); // stats -> overview
    await tui.press(SHIFT_TAB); // overview -> last tab (wraps)
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow(lastTab));

    await tui.press('\x1b');

    expect(rowsOf(tui)[BAR_ROW - 1], 'back on project Overview').toBe(
      projectBarRow('overview'),
    );
    expect(rootBarRows(tui)).toEqual([]);

    await quit(tui);
  });
});

// BB-456 D6 deleted 'BB-377 — Dashboard ↓ selects PER USER rows' in full:
// `dashboard.ts`'s own comment records why on purpose — the per-row user
// cursor read `by_user` off the withdrawn fixed document, the new contract
// exposes no per-row target type at all, and the shipped root/user-scope
// figures carry no breakdown axis in the first place (that now lives at TEAM
// scope only). Re-introducing the interaction needs a figure and a contract
// addition, not a client fix.
//
// BB-456 also deleted 'BB-256 R7 — an empty control plane': the wording it
// pinned, "No activity in the last 30 days.", is the withdrawn document's own;
// the new contract's empty state ("No figures configured for this group.") is
// covered where the discovery-plus-values contract itself is exercised
// (`route-boot.test.ts`).

// Spec D9 — a missing endpoint is a NAMED message, and no numbers. A real outage
// must never be reported as "your control plane is old", which is why only a 404
// reaches this branch.
describe('BB-256 D9 — a control plane without the endpoint says so', () => {
  // BB-456 deleted the sibling cases 'renders the named message and NO
  // figures' and 'a 500 is surfaced as an error, NOT as an outdated control
  // plane': both pinned the withdrawn 'It predates BB-256.'/'TICKETS'/'237'
  // wording. The discovery-vs-values 404/500 classification itself is
  // exercised on the new contract in `route-boot.test.ts`; this survivor keeps
  // owning what is specific to THIS file — that the tab bar stays usable while
  // the message is on screen.
  it('Tab still reaches Projects from the message', async () => {
    const { tui } = await boot(undefined, undefined, {
      status: 404,
    });
    await tui.press(TAB);
    expect(frameOf(tui)).toContain('bakers.build projects');
    await quit(tui);
  });
});

// BB-456 D6/D8 deleted 'BB-256 review finding 1 — a failed read leaves no
// stale figures' in full: both its cases depended on `failUnscoped`, the
// unscoped-vs-scoped-read distinction spec D6 withdrew along with the
// workspace scope it existed to fail independently of a project's own read.

describe('a project open arrives once', () => {
  it('lands on that project’s Overview tab and Esc returns to Projects exactly once', async () => {
    // `openSelectedProject` pushes the history frame itself, so while
    // `openDashboard` could fail to arrive that frame outlived the screen it was
    // taken for, and Esc popped back onto the screen the operator never left.
    // Now the opener always lands, which makes the pushed frame honest.
    const { tui } = await boot(undefined, undefined, {
      status: 500,
    });
    await tui.press(TAB); // -> projects
    expect(frameOf(tui)).toContain('bakers.build projects');

    await tui.press('\r');
    await settle();
    await tui.renderOnce();

    expect(rowsOf(tui)[BAR_ROW - 1], 'arrived at the PROJECT level').toBe(
      projectBarRow('overview'),
    );

    await tui.press('\x1b'); // Esc — back to where we came from

    expect(frameOf(tui), 'one frame, not two').toContain(
      'bakers.build projects',
    );
    expect(rootBarRows(tui)).not.toEqual([]);

    await quit(tui);
  });
});

// ---------------------------------------------------------------------------
// BB-256 review finding 3 — the status bar advertises only keys that work.
// The Dashboard is the screen `bakers ui` now opens on, so it is the first thing
// every operator reads: a wrong key here is the worst-placed wrong key there is.
// ---------------------------------------------------------------------------
describe('BB-256 review finding 3 — the Dashboard advertises working keys', () => {
  // BB-456 D6/D9 deleted, named here rather than left silently unmet:
  // - 'the root Dashboard offers select, Tab and quit — and nothing dead' and
  // - 'the project Dashboard offers Esc, because Esc un-scopes it' asserted a
  //   root Dashboard drawing WORKSPACE-WIDE figures and a project Dashboard
  //   whose Esc un-scoped back to them — both withdrawn (spec D6: there are no
  //   workspace statistics, so root scope is now the account's OWN figures and
  //   a project's Esc leaves the project entirely rather than un-scoping it).
  // - 'the unsupported message names the tab of the CURRENT level' pinned
  //   'It predates BB-256.', the literal wording `dashboard.ts` no longer
  //   emits (it now names the ticket that replaced it, BB-456).
  it('the Projects screen advertises Tab, now that Dashboard is its sibling', async () => {
    const { tui } = await boot();
    await tui.press(TAB); // -> projects

    expect(frameOf(tui)).toContain('bakers.build projects');
    expect(
      frameOf(tui),
      'the root level has two tabs now — BB-239s comment is falsified',
    ).toContain('Tab:Tabs');

    await quit(tui);
  });
});

// AC-4 — the ROOT level. Before this change both screens bracketed `[Tickets]`,
// byte-identically to the project screen, while `u` aborted on the
// `currentProjectId == null` guard and `a` landed on `0 agent(s)`.
describe('BB-239 AC-4 — the root screens carry the root tab bar', () => {
  it('projects — [Projects] bracketed, no project-level tab', async () => {
    // BB-256: the root landing screen is the Dashboard now, so the projects
    // overview is one Tab away. The property under test is unchanged — a root
    // screen carries the ROOT bar and no project-level tab.
    const { tui } = await boot();
    await tui.press(TAB);

    expect(frameOf(tui)).toContain('bakers.build projects');
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(rootBarRow('projects'));
    // BB-375 — SEPARATOR_ROWS = 0; body (frame/content) sits under the bar.
    expect(rowsOf(tui)[4], 'gap above the bar').toBe('');
    expect(rowsOf(tui)[BAR_ROW - 1]).toMatch(/\[/);
    expect(rowsOf(tui)[BAR_ROW], 'frame under the bar').toMatch(/╭|│/);
    expect(
      projectBarRows(tui),
      'no project-level bar on a root screen',
    ).toEqual([]);

    await quit(tui);
  });

  it('project-picker — [Projects] bracketed, no project-level tab', async () => {
    const { tui } = await boot({
      screen: 'project-picker',
      repo: 'host/keytec/shop',
      candidates: CANDIDATES,
    });

    expect(frameOf(tui)).toContain('Which project?');
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(rootBarRow('projects'));
    // BB-375 — gap above the bar; framed body under it.
    expect(rowsOf(tui)[4], 'gap above the bar').toBe('');
    // Picker body starts with a heading, then the framed table.
    expect(rowsOf(tui)[BAR_ROW], 'body under the bar').not.toBe('');
    expect(frameOf(tui)).toContain('╭');
    expect(projectBarRows(tui)).toEqual([]);

    await quit(tui);
  });
});

// AC-5 — the PROJECT level. The two overlay screens are reached by Tab, not by
// `a`/`u`: those keys are gone (AC-7), which is why the first round's versions
// of these tests could not simply be kept.
describe('BB-239 AC-5 — the project screens carry the project tab bar', () => {
  it('project — [Tickets] bracketed, no root tab', async () => {
    // The harness auto-tabs from overview to stats; one more Tab reaches tickets.
    const { tui } = await boot(PROJECT_ROUTE);
    await tui.press(TAB); // stats -> tickets

    expect(frameOf(tui)).toContain('bakers · tickets');
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('tickets'));
    // BB-375 — SEPARATOR_ROWS = 0; body (frame/content) sits under the bar.
    expect(rowsOf(tui)[4], 'gap above the bar').toBe('');
    expect(rowsOf(tui)[BAR_ROW - 1]).toMatch(/\[/);
    expect(rowsOf(tui)[BAR_ROW], 'frame under the bar').toMatch(/╭|│/);
    expect(rootBarRows(tui), 'no root bar on a project screen').toEqual([]);

    await quit(tui);
  });

  it('ticket-agents — [Ticket-Agents] bracketed, no root tab', async () => {
    const { tui } = await boot(PROJECT_ROUTE);
    await tui.press(TAB); // stats -> tickets
    await tui.press(TAB); // tickets -> ticket-agents

    expect(frameOf(tui)).toContain('Ticket-Agents');
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('ticket-agents'));
    // BB-375 — SEPARATOR_ROWS = 0; body (frame/content) sits under the bar.
    expect(rowsOf(tui)[4], 'gap above the bar').toBe('');
    expect(rowsOf(tui)[BAR_ROW - 1]).toMatch(/\[/);
    expect(rowsOf(tui)[BAR_ROW], 'frame under the bar').toMatch(/╭|│/);
    expect(rootBarRows(tui)).toEqual([]);

    await quit(tui);
  });

  it('project-runs — [Runs] bracketed, no root tab', async () => {
    const { tui } = await boot(PROJECT_ROUTE);
    await tui.press(TAB); // stats -> tickets
    await tui.press(TAB); // tickets -> ticket-agents
    await tui.press(TAB); // ticket-agents -> runs

    expect(frameOf(tui)).toContain('bakers · runs');
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('runs'));
    // BB-375 — SEPARATOR_ROWS = 0; body (frame/content) sits under the bar.
    expect(rowsOf(tui)[4], 'gap above the bar').toBe('');
    expect(rowsOf(tui)[BAR_ROW - 1]).toMatch(/\[/);
    expect(rowsOf(tui)[BAR_ROW], 'frame under the bar').toMatch(/╭|│/);
    expect(rootBarRows(tui)).toEqual([]);

    await quit(tui);
  });
});

// AC-6 — Tab/Shift-Tab cycle the CURRENT LEVEL only.
describe('BB-239 AC-6 — Tab cycles the current level', () => {
  it('Tab cycles the project tabs in registry order and wraps', async () => {
    const { tui } = await boot(PROJECT_ROUTE);

    // The harness auto-tabs from the overview landing to stats; the cycle
    // starts and wraps at stats.
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('stats'));

    // One Tab per remaining registry entry, then two more to wrap to stats.
    for (const id of [
      ...PROJECT_TABS.slice(2).map((t) => t.id),
      'overview' as const,
      'stats' as const,
    ]) {
      await tui.press(TAB);
      expect(rowsOf(tui)[BAR_ROW - 1], `Tab lands on ${id}`).toBe(
        projectBarRow(id),
      );
      expect(rootBarRows(tui), `${id} is still the project level`).toEqual([]);
    }

    await quit(tui);
  });

  it('Shift-Tab cycles the project tabs backwards', async () => {
    const { tui } = await boot(PROJECT_ROUTE);
    await tui.press(SHIFT_TAB); // stats -> overview
    await tui.press(SHIFT_TAB); // overview -> conductors (last, wraps)

    // Backwards from the first tab (Overview) wraps to the LAST project tab
    // — `conductors` since BB-450, read off the registry rather than
    // hardcoded so a future addition moves this test with it.
    const lastTab = PROJECT_TABS.at(-1)?.id ?? 'conductors';
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow(lastTab));

    await quit(tui);
  });

  // AC-12 — the bar must name where you are GOING while it gets there.
  //
  // `gotoTopTab` pops back to the Tickets base before opening an overlay, so
  // during an async target's load the screen is momentarily `project` again and
  // the bar claimed `[Tickets]` — the tab being LEFT. Measured on the real
  // control plane, that window is ~5.8s for 36 runs, which reads as "Runs was
  // skipped, I'm back on Tickets" rather than as loading.
  it('brackets the TARGET tab while its screen is still loading', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { tui } = await boot(PROJECT_ROUTE, gate);

    await tui.press(TAB); // stats -> tickets
    await tui.press(TAB); // tickets -> ticket-agents (synchronous)
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('ticket-agents'));

    await tui.press(TAB); // -> runs, parked on the gate

    const rows = rowsOf(tui);
    expect(
      rows[BAR_ROW - 1],
      'the bar names the target, not the tab being left',
    ).toBe(projectBarRow('runs'));
    expect(rows[rows.length - 1], 'and says it is loading').toContain(
      'loading',
    );

    release?.();
    await settle();
    // The paint is pumped explicitly: `settle()` only lets the kernel's promise
    // chain finish, and the assertion below reads the SCREEN.
    await tui.renderOnce();

    // Once there, the bar is the screen's own — the pending state is gone, not
    // merely agreeing by accident.
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('runs'));
    expect(frameOf(tui)).toContain('bakers · runs');

    await quit(tui);
  });

  it('keeps the failed target selected with an isolated retryable error', async () => {
    let reject: ((e: Error) => void) | undefined;
    const gate = new Promise<void>((_resolve, r) => {
      reject = r;
    });
    const { tui } = await boot(PROJECT_ROUTE, gate);

    await tui.press(TAB); // stats -> tickets
    await tui.press(TAB); // tickets -> ticket-agents
    await tui.press(TAB); // ticket-agents -> runs, parked
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('runs'));

    reject?.(new Error('boom'));
    await settle();
    await tui.renderOnce();

    // Revision 2: failure is a resource state owned by the target tab. Sibling
    // data remains cached, and the operator can retry without being navigated
    // away from the failed destination.
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('runs'));
    expect(frameOf(tui)).toContain('boom');
    expect(frameOf(tui)).toContain('Press Enter to retry');

    await quit(tui);
  });

  // AC-17 — a tab activated by a CLICK obeys AC-12 too. BB-241 put a second
  // entrance on `gotoTopTab`, and `pendingTab` is set inside it, so this holds for
  // the same reason the keystroke does — asserted rather than assumed, because "it
  // is the same function" is exactly the claim a future refactor breaks.
  it('a clicked tab brackets the target while its screen is still loading', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { tui } = await boot(PROJECT_ROUTE, gate);
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('stats'));

    await click(tui, BAR_ROW, COL_RUNS); // -> runs, parked on the gate

    const rows = rowsOf(tui);
    expect(rows[BAR_ROW - 1], 'the bar names the clicked target').toBe(
      projectBarRow('runs'),
    );
    expect(rows[rows.length - 1], 'and says it is loading').toContain(
      'loading',
    );

    release?.();
    await settle();
    // The paint is pumped explicitly: `settle()` only lets the kernel's promise
    // chain finish, and the assertion below reads the SCREEN.
    await tui.renderOnce();

    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('runs'));
    expect(frameOf(tui)).toContain('bakers · runs');

    await quit(tui);
  });

  // Current work adds a fifth root tab. The cycle must still close: a full
  // round trip returns the identical frame.
  it('Tab round-trips the root tabs back to the same frame', async () => {
    const { tui } = await boot();
    const before = frameOf(tui);
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(rootBarRow('stats'));

    await tui.press(TAB);
    expect(frameOf(tui), 'Tab reaches Projects').not.toBe(before);
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(rootBarRow('projects'));

    await tui.press(TAB);
    expect(rowsOf(tui)[BAR_ROW - 1], 'then Teams').toBe(rootBarRow('teams'));

    await tui.press(TAB);
    expect(rowsOf(tui)[BAR_ROW - 1], 'then Conductors').toBe(
      rootBarRow('conductors'),
    );

    await tui.press(TAB);
    expect(rowsOf(tui)[BAR_ROW - 1], 'then My work').toBe(
      rootBarRow('my-work'),
    );

    await tui.press(TAB);
    expect(frameOf(tui), 'and back to Stats, unchanged').toBe(before);

    await tui.press(SHIFT_TAB);
    expect(rowsOf(tui)[BAR_ROW - 1], 'Shift-Tab goes the other way').toBe(
      rootBarRow('my-work'),
    );
    // …all the way back round: one Shift-Tab per remaining root tab.
    await tui.press(SHIFT_TAB);
    await tui.press(SHIFT_TAB);
    await tui.press(SHIFT_TAB);
    await tui.press(SHIFT_TAB);
    expect(frameOf(tui)).toBe(before);

    await quit(tui);
  });

  // BB-346 R1 — THE TAB KEY CHANGED OWNER, AND THESE TWO CASES ARE THE GUARD.
  //
  // Kept verbatim in intent: the same keystrokes in the same order against the
  // same route, still asserting that Tab moves the ticket screen's sections and
  // wraps. What changed is only WHERE the answer is read — the sections are the
  // `ticket` level's entries drawn in the bar row, not a `metaRow` inside the
  // header box — and WHO moves them: the screen's own `tab` branch is gone and
  // the kernel's branch reaches each screen through `Router.navigateTab`. The observable
  // behaviour, wrap included, has to be identical, which is exactly what a case
  // whose intent did not move can show.
  it('Tab still cycles the sections on the ticket screen', async () => {
    const { tui } = await boot(TICKET_ROUTE);

    await tui.press(TAB);
    expect(rowsOf(tui)[TICKET_BAR_INDEX]).toBe(ticketBarRow('planning'));

    await tui.press(TAB);
    expect(rowsOf(tui)[TICKET_BAR_INDEX]).toBe(ticketBarRow('comments'));
    // Still exactly ONE bar, and still not another level's — the property
    // BB-239 was about, now satisfied by the ticket screen HAVING a level.
    expect(rootBarRows(tui), 'not the root level’s').toEqual([]);
    expect(projectBarRows(tui), 'nor the project level’s').toEqual([]);

    await quit(tui);
  });

  it('Shift-Tab cycles the sections backwards', async () => {
    const { tui } = await boot(TICKET_ROUTE);
    await tui.press(SHIFT_TAB);

    // Backwards from Overview wraps to the LAST section. The addons tab is
    // retired (BB-661): the inline message card lives on Overview now, so
    // the last section is Runs.
    expect(rowsOf(tui)[TICKET_BAR_INDEX]).toBe(ticketBarRow('runs'));

    await quit(tui);
  });
});

// AC-7 — the letter shortcuts for top-level navigation are gone. Navigation is
// Tab/Shift-Tab and nothing else.
describe('BB-239 AC-7 — the removed shortcuts no longer navigate', () => {
  for (const key of ['a', 'u'] as const) {
    it(`${key} does nothing on the dashboard`, async () => {
      const { tui } = await boot();
      const before = frameOf(tui);

      await tui.press(key);
      expect(frameOf(tui)).toBe(before);

      await quit(tui);
    });

    it(`${key} does nothing on the project screen`, async () => {
      const { tui } = await boot(PROJECT_ROUTE);
      const before = frameOf(tui);

      await tui.press(key);
      expect(frameOf(tui)).toBe(before);

      await quit(tui);
    });

    it(`${key} does nothing on the ticket screen`, async () => {
      const { tui } = await boot(TICKET_ROUTE);
      const before = frameOf(tui);

      await tui.press(key);
      expect(frameOf(tui)).toBe(before);

      await quit(tui);
    });
  }

  it('t on the project screen is a no-op (BB-299: the type filter is gone)', async () => {
    const { tui } = await boot(PROJECT_ROUTE);
    await tui.press(TAB); // -> the ticket list, where `t` used to be bound
    const before = frameOf(tui);

    await tui.press('t');

    // Still the project screen — `t` never was top-level navigation here.
    expect(frameOf(tui)).toContain('bakers · tickets');
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(projectBarRow('tickets'));
    // …and now it does nothing: BB-299 removed the `t type` filter (AC-2).
    expect(frameOf(tui)).toBe(before);

    await quit(tui);
  });

  it('Esc still leaves the ticket screen, and the next screen has its own bar', async () => {
    const { tui } = await boot(TICKET_ROUTE);
    expect(frameOf(tui)).toContain('BB-239');

    // A deep-linked ticket pushed no history frame and carries no project
    // params, so Esc converges on the safe root landing.
    await tui.press('\x1b');

    expect(frameOf(tui)).toContain('My work');
    // The suppression is PER-SCREEN, not sticky — the regression a stateful
    // mistake would produce — and My work gets its OWN level's bar back.
    expect(rowsOf(tui)[BAR_ROW - 1]).toBe(rootBarRow('my-work'));

    await quit(tui);
  });
});

// AC-8 — no frame advertises a shortcut that no longer exists.
describe('BB-239 AC-8 — no frame advertises a removed shortcut', () => {
  const DEAD = ['a agents', 'u runs', 'Tab/a agents', 'Tab/t tickets'];

  it('dashboard, project, ticket-agents, project-runs and ticket are clean', async () => {
    // Each frame is captured while its screen is ON SCREEN and the string kept:
    // the renderer is torn down between boots, so a frame read afterwards would
    // read nothing at all rather than a transcript.
    const dashboard = await boot();
    const dashboardFrame = frameOf(dashboard.tui);
    await quit(dashboard.tui);

    const project = await boot(PROJECT_ROUTE);
    const projectFrame = frameOf(project.tui); // stats (harness auto-tabbed from overview)
    await project.tui.press(TAB); // stats -> tickets
    const agentsFrame = frameOf(project.tui); // tickets (was ticket-agents)
    await project.tui.press(TAB); // tickets -> ticket-agents
    const runsFrame = frameOf(project.tui); // ticket-agents (was runs)
    await quit(project.tui);

    const ticket = await boot(TICKET_ROUTE);
    const ticketFrame = frameOf(ticket.tui);
    await quit(ticket.tui);

    for (const [name, text] of [
      ['dashboard', dashboardFrame],
      ['project', projectFrame],
      ['ticket-agents', agentsFrame],
      ['project-runs', runsFrame],
      ['ticket', ticketFrame],
    ] as const) {
      for (const dead of DEAD) {
        expect(text, `${name} advertises the removed "${dead}"`).not.toContain(
          dead,
        );
      }
    }

    // A screen whose bar CAN be cycled says so; the ticket screen says
    // `Tab section` instead, because there the key switches a section of the open
    // ticket — asserted verbatim by the AC-5 status-bar test.
    expect(projectFrame).toContain('Tab');
    expect(runsFrame).toContain('Tab');
  });
});

describe('BB-239 AC-1..3 — the ticket detail screen draws exactly one tab bar', () => {
  // BB-346 — BB-239's subject was that a screen draws exactly ONE bar: the one
  // of its own level. That is unchanged. What changed is which level the ticket
  // screen HAS. It had none, and drew its sections inside the header box; it has
  // the `ticket` level now, and the sections are drawn in the bar row.
  //
  // The defect BB-239 removed — two bars three rows apart, `Runs` meaning two
  // different things within them — is removed the other way round, by there being
  // one bar again. So the two cases that used to read "no top-level bar row" and
  // "the detail bar is unchanged in content and position" are ONE case: one bar,
  // and it is this screen's own.
  it('draws exactly one bar row, and it is the ticket level’s', async () => {
    const { tui } = await boot(TICKET_ROUTE);

    // BAR-SCOPED on purpose (review finding F2, and spec R1/R2). `Runs` is a
    // legitimate label of the ticket level's bar and this fixture's description
    // quotes `Ticket-Agents` — exactly like the real BB-239 ticket. Only a
    // whole rendered BAR counts, which is what lets the absence assertions below
    // stand beside a body that mentions the labels.
    expect(rootBarRows(tui), 'not the root level’s').toEqual([]);
    expect(projectBarRows(tui), 'nor the project level’s').toEqual([]);
    expect(rowsOf(tui)[TICKET_BAR_INDEX]).toBe(ticketBarRow('overview'));
    // The meta row carries state and labels without prefixes on one line.
    expect(rowsOf(tui)[TICKET_META_INDEX]).toContain('coding');
    expect(rowsOf(tui)[TICKET_META_INDEX]).not.toContain('Labels:');
    expect(rowsOf(tui)[TICKET_META_INDEX]).not.toContain('State:');
    expect(rowsOf(tui)[TICKET_BOX_ROWS - 1], 'the box bottom border').toContain(
      '╰',
    );

    await quit(tui);
  });

  it('the bar sits under the box, and the frame sits flush under the bar', async () => {
    const { tui } = await boot(TICKET_ROUTE);
    const rows = rowsOf(tui);

    // The STRUCTURE this case asserts is what BB-239 was about and is unchanged
    // in kind: bottom border, then bar, then body. BB-346 put the bar row
    // between the border and the body, where every other level already had it;
    // BB-375 drops the blank separator so the framed body sits flush under
    // the bar.
    expect(rows[TICKET_BOX_ROWS - 1], 'the box bottom border').toContain('╰');
    expect(rows[TICKET_BAR_INDEX], 'then the bar row').toBe(
      ticketBarRow('overview'),
    );
    // BB-375 — gap is ABOVE the bar; FRAME sits under the bar.
    expect(rows[TICKET_BAR_INDEX - 1], 'the gap above the bar').toBe('');
    expect(rows[TICKET_BAR_INDEX + 1], 'the frame top').toContain('╭');

    await quit(tui);
  });

  // The ticket header now has TWO content rows (title + meta), the same count
  // as every other bar screen's. Both chromes are the SAME HEIGHT — the state,
  // assignee and labels all live on the ONE meta line so no extra row is paid.
  it('the ticket chrome is the same height as a bar screen', async () => {
    const ticket = await boot(TICKET_ROUTE);
    const ticketRows = rowsOf(ticket.tui);
    await quit(ticket.tui);

    const project = await boot(PROJECT_ROUTE);
    // The harness auto-tabs from overview to stats; both share the same chrome.
    const projectRows = rowsOf(project.tui);
    await quit(project.tui);

    // BB-326 Step C — MEASURED AT THE CHROME, NOT VIA THE TOTAL.
    const firstBodyRow = (rows: string[]): number => {
      // Body starts after the tab bar and SEPARATOR_ROWS blank(s).
      const bar = rows.findIndex((row) =>
        /\[Overview\]|\[Stats\]|\[Tickets\]|\[Dashboard\]/.test(row),
      );
      return bar >= 0 ? bar + 1 + SEPARATOR_ROWS : -1;
    };

    // FOOTER_ROWS=2 ends on the status row; rowsOf keeps that last non-empty
    // row, so the drawn length is the full terminal height.
    expect(ticketRows.length, 'the ticket frame fills the terminal').toBe(ROWS);
    expect(projectRows.length, 'and so does the project one').toBe(ROWS);
    // 2 box + bar + separator on the ticket; 2 box + bar + separator on the
    // project — the same shape (BB-375, BB-516).
    expect(firstBodyRow(ticketRows)).toBe(
      TICKET_BOX_ROWS + HEADER_TAB_GAP_ROWS + 1 + SEPARATOR_ROWS,
    );
    expect(firstBodyRow(projectRows)).toBe(
      4 + HEADER_TAB_GAP_ROWS + 1 + SEPARATOR_ROWS,
    );
    expect(
      firstBodyRow(ticketRows) - firstBodyRow(projectRows),
      'the chromes are the same height — no extra rows',
    ).toBe(0);
    expect(firstBodyRow(ticketRows), 'both are row 6').toBe(6);
    expect(firstBodyRow(projectRows), 'a bar screen is row 6').toBe(6);

    // And the window each of them scrolls is what that chrome leaves.
    expect(
      Math.min(renderTree(tabViewTree(ticketDoc, 0).body).length, ROWS),
      'the ticket body is shorter than its window, so all of it is painted',
    ).toBeLessThanOrEqual(viewHeight(TICKET_SHAPE));
    expect(Math.min(PROJECT_BODY_LINES, ROWS)).toBeLessThanOrEqual(
      viewHeight(PROJECT_SHAPE),
    );
  });

  it("the ticket screen's status bar is the status bar, not a tab bar", async () => {
    const { tui } = await boot(TICKET_ROUTE);
    const rows = rowsOf(tui);
    const last = rows[rows.length - 1];

    // BB-239 was read as "the ticket screen draws no top-level tab bar", and
    // this case's job was to show that the bottom row had not quietly become one.
    // Its job is unchanged and its subject is now stated as the describe above
    // states it: the ticket screen draws exactly ONE bar, of its own `ticket`
    // level, in the chrome's bar row — and the LAST row is the status bar, not a
    // second bar.
    //
    // The pinned string gained `e:Edit` when BB-233 added the Edit-assignment
    // popup — a deliberate, discoverable key, so the assertion is split into
    // the navigation keys BB-239 cares about plus that one addition, rather
    // than one literal that any later key would break again.
    // `Tab:Section`, not `Tab:Tabs`: since BB-346 the ticket's bar is the
    // chrome's, and what `Tab` moves through is a SECTION of the open ticket — a
    // mode of the route, not a destination. The hint is the only place the
    // operator is told which of the two they get, and the README's key table and
    // `docs/advanced/cli/ui-keys.md` say `section` too.
    // BB-369 D4 — `↑↓:Select`, not `↑↓:Scroll`. Overview has two expandable
    // entries since `Latest summary` joined it, and the hint is derived from
    // `selectable > 1`, so this word IS the report of that. What the case asserts
    // is unchanged: the last row is the status ladder, not a second tab bar.
    // Screen ladder is in the footer actions row; kernel footer is basics.
    const frame = frameOf(tui);
    for (const key of ['Tab:Section', '↑↓:Select', 'e:Edit']) {
      expect(frame, `the ticket footer names ${key}`).toContain(key);
    }
    expect(last, 'kernel footer still names quit').toContain('q:quit');
    expect(last).toContain('Esc:back');

    await quit(tui);
  });

  // BB-346 R4 — UNCHANGED, AND NOW LOAD-BEARING.
  //
  // `teaser` and `board_card` have no sections, so `topTab()` returns `null` for
  // them and no bar is composed. This case said that before and says it still;
  // what changed is that `anyBarRows` now includes the TICKET level's bars, so it
  // is finally able to catch the regression it exists for — BB-239 removed a bar
  // from these views and this ticket must not put one back.
  it('the compact views draw no bar of any level', async () => {
    for (const view of ['teaser', 'board_card'] as const) {
      const { tui } = await boot({
        screen: 'ticket',
        ticketId: TICKET,
        view,
      });

      expect(frameOf(tui)).toContain('BB-239');
      expect(anyBarRows(tui), `${view} draws no bar`).toEqual([]);

      await quit(tui);
    }
  });
});
