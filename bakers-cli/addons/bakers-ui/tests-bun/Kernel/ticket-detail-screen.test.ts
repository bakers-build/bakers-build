import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { TAB_BAR_ID } from '../../src/Kernel/chrome.js';
import { runTicketTui } from '../../src/Kernel/tui-kernel.js';
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

// BB-255 — the ticket detail screen, driven through the REAL kernel on a
// 120×40 test renderer: real keystrokes, real mouse events, and assertions on
// the real rendered screen. That is the layer a human sees, minus the emulator —
// which is why spec D12 names this suite as the ticket's validator instead of
// the browser E2E suite (there is no browser surface at all here).
//
// BB-326 — WHAT THE SWAP CHANGED HERE. The fake output accumulated every byte
// the kernel ever wrote, so a `toContain` could be answered by text that had
// scrolled away frames ago and a `not.toContain` could be answered by a tab
// nobody had opened. `tui.frame()` is the CURRENT SCREEN, read back off the
// render buffer, so every assertion below is now about what is on the screen at
// the moment it is asked. Mouse reports are no longer written as SGR bytes
// either: OpenTUI parses them itself, so the gestures go through `mockMouse` —
// whose coordinates are 0-based, one below the 1-based terminal rows the SGR
// report speaks (see `click` below).

const TICKET = 'aaaa0000-0000-0000-0000-000000000255';
const PARENT = 'aaaa0000-0000-0000-0000-000000000200';
const BARE = 'aaaa0000-0000-0000-0000-0000000000b0';
/** BB-381 — a ticket whose includes carry typed `spec` + `plan` comments. */
const TYPED = 'aaaa0000-0000-0000-0000-000000000381';
const RUN_NEW = 'bbbb0000-0000-0000-0000-000000004599';
const RUN_OLD = 'bbbb0000-0000-0000-0000-000000004592';

/**
 * A real bakers.build body: `## Context` first, then prose, then a distinctive tail —
 * and long enough that the EXPANDED body overflows the 40-row viewport
 * (`viewHeight() = rows - 9` ⇒ 31 body rows), which is what makes D9's
 * "the arrows scroll" observable at all.
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
      title: 'summary-first ticket detail',
      state: 'coding',
      description: { value: BODY },
      branch_name: 'feat/bb-255',
      base_branch: 'develop',
      links: [{ title: 'MR', uri: 'https://git.example/mr/255' }],
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

/** AC-4 / AC-8: no parent, no links, no labels, no runs. */
const bareDoc = {
  data: {
    id: BARE,
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'BB-1',
      title: 'a bare ticket',
      description: 'one line',
      links: [],
    },
    relationships: {
      parent_id: { data: null },
      labels: { data: [] },
      runs: { data: [] },
      sub_tickets: { data: [] },
      referenced_tickets: { data: [] },
      environments: { data: [] },
    },
  },
  included: [],
};

/** BB-381: Overview draws Latest spec + Latest plan carets when comments exist. */
const typedDoc = {
  data: {
    id: TYPED,
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'BB-381',
      title: 'typed spec and plan',
      state: 'coding',
      description: { value: 'Body line.\nSecond.' },
      links: [],
    },
    relationships: {
      parent_id: { data: null },
      labels: { data: [] },
      runs: { data: [] },
      sub_tickets: { data: [] },
      referenced_tickets: { data: [] },
      environments: { data: [] },
    },
  },
  included: [
    {
      type: 'bb_comment--bb_comment',
      id: 'c-spec',
      attributes: {
        drupal_internal__id: 81,
        bb_comment_type: 'spec',
        author_name: 'cw',
        created: '2026-08-18T09:00:00+00:00',
        body: { value: 'SPEC-BODY-LINE' },
      },
    },
    {
      type: 'bb_comment--bb_comment',
      id: 'c-plan',
      attributes: {
        drupal_internal__id: 82,
        bb_comment_type: 'plan',
        author_name: 'cw',
        created: '2026-08-18T10:00:00+00:00',
        body: { value: 'PLAN-BODY-LINE' },
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
      if (path.startsWith(`bb_ticket/bb_ticket/${TICKET}`)) return ticketDoc;
      if (path.startsWith(`bb_ticket/bb_ticket/${BARE}`)) return bareDoc;
      if (path.startsWith(`bb_ticket/bb_ticket/${TYPED}`)) return typedDoc;
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
/** What `resolveRoute` produces for `run:<uuid>` — unchanged by this ticket. */
const RUN_ROUTE: ResolvedRoute = {
  screen: 'ticket',
  ticketId: TICKET,
  view: 'full',
  tab: 'runs',
  runId: RUN_NEW,
};
/**
 * The same route pointed at the OLDER run — the one that is NOT `ticketRunRows`'
 * index 0. AC-11/S13 is only observable through it: with the newest run the
 * silent swap would land on the run that was already shown and look correct.
 */
const RUN_OLD_ROUTE: ResolvedRoute = {
  screen: 'ticket',
  ticketId: TICKET,
  view: 'full',
  tab: 'runs',
  runId: RUN_OLD,
};

const boot = (
  route?: ResolvedRoute,
  columns = 120,
  rows = 40,
): Promise<BootedTui> =>
  bootTui({
    services: fakeServices(),
    columns,
    rows,
    tui: { ...(route ? { route } : {}) },
  });

const quit = async (tui: BootedTui): Promise<void> => {
  tui.mockInput.pressKey('q');
  await tui.running;
  await tui.stop();
};

/**
 * The rows of the current screen, blank tail dropped.
 *
 * The render buffer is always the full terminal, so the frame ends in as many
 * empty rows as the composition left unused. The fake output had no such tail —
 * it recorded only what was written — and every helper and assertion below
 * inherited that shape: the status bar is the LAST row, and `bodyRows` slices to
 * `-1` to drop it. Trimming the tail here is what keeps all of that true; the
 * indexes from the top are untouched.
 */
const drawnRows = (tui: BootedTui): string[] => {
  const all = tui.rows();
  return all.slice(0, all.findLastIndex((row) => row !== '') + 1);
};

/** First body index — chrome ends at the composed row count (incl. separator). */
const firstBodyIndex = (_rows: string[]): number =>
  chromeRowCount(chromeShape(2, true));

/** The body content rows: inside region-body frame, above footer. */
const bodyRows = (tui: BootedTui): string[] => {
  const all = drawnRows(tui);
  let start = firstBodyIndex(all);
  let end = all.length - 1; // drop status
  if (end > start && !(all[end - 1] ?? '').includes('q:quit')) {
    // actions row above status
    if ((all[end - 1] ?? '').trim() !== '') end -= 1;
  } else if (end > start && (all[end] ?? '').includes('q:quit')) {
    /* status already at end */
  }
  // Skip fixed ScrollBox top / bottom borders (BB-375).
  if ((all[start] ?? '').includes('╭')) start += 1;
  if (end > start && (all[end - 1] ?? '').includes('╰')) end -= 1;
  return all.slice(start, end);
};

/**
 * The frame WITH its styling, as one comparable string.
 *
 * The "byte-identical" assertions in AC-11 used to compare the raw transcript
 * slice, which carried the SGR escapes the kernel wrote. OpenTUI paints cells,
 * so `frame()` is plain text and a text-only comparison would have silently
 * dropped the styling half of that claim — the selection highlight most of all.
 * `captureSpans()` reads the same attribute bits back off the buffer, so both
 * halves survive.
 *
 * What this does NOT prove — and the transcript comparison did not either — is
 * that the screen was not REDRAWN. The old `frame()` re-split at the last
 * clear-screen, so an identical repaint produced an identical string; the
 * renderer now diffs cells, so an identical repaint is likewise invisible. The
 * claim both express is "the screen did not CHANGE", which is what the operator
 * reads and what AC-11 is about.
 */
const styledFrame = (tui: BootedTui): string =>
  JSON.stringify(tui.captureSpans());

/**
 * Viewport ScrollBox top border on screen. {@link bodyRows} strips it for
 * content indices; {@link ticketBodyRow} still counts the physical row.
 */
const TICKET_DETAIL_FRAME_TOP = 1;

/**
 * The 1-based terminal row of body content line `i` ({@link bodyRows} index).
 */
const ticketBodyRow = (tui: BootedTui, i: number): number =>
  firstBodyIndex(drawnRows(tui)) + 1 + TICKET_DETAIL_FRAME_TOP + i;

/**
 * A left click at 1-based terminal (row, col) — the gesture that activates.
 *
 * `mockMouse.click` is a press AND a release, i.e. one physical click; the
 * kernel acts on the `'down'` alone, so this is the same single activation the
 * hand-written `\x1b[<0;col;rowM` press used to produce. Its coordinates are
 * 0-BASED buffer coordinates while every caller below (via `ticketBodyRow` /
 * `chromeRowOf`) speaks the 1-based terminal rows the SGR report carried. So the
 * `- 1` belongs here, at the single point where a terminal coordinate turns into
 * a buffer one, and nowhere in the derivations.
 *
 * BB-340 Task 11 — the kernel has no matching `+ 1` left for ROWS: a click
 * lands on the node the renderer's own hit test finds, so the row seam is the
 * composition's (see `top-tab-bar.test.ts`'s seam case). What survives is the
 * COLUMN translation, which the two edge cases below pin from both sides.
 *
 * BB-346 — and the arithmetic those two cases pin is the TOP bar's. The header
 * box has no bar of its own to translate columns for: the sections are the
 * `ticket` level's entries and the chrome draws them in its bar row. The two
 * column constants kept their values, which the paragraph at those cases derives
 * rather than assumes — one column earlier, one separator column wider, cancelling
 * exactly. Read that derivation before treating the unchanged numbers as evidence
 * that nothing moved.
 */
const click = async (tui: BootedTui, row: number, col = 5): Promise<void> => {
  await tui.mockMouse.click(col - 1, row - 1);
  await settle();
  await tui.renderOnce();
};

const TAB = '\t';
const DOWN = '\x1b[B';
const UP = '\x1b[A';
const NATIVE_CARET = /[▸▾]/;

describe('Overview — open Description, header identity, no carets', () => {
  it('opens with Description expanded; header shows state on the meta line', async () => {
    const tui = await boot(TICKET_ROUTE);
    const chrome = drawnRows(tui).join('\n');
    const body = bodyRows(tui).join('\n');
    // The header now has a meta line with state (no prefixes like 'Assigned:').
    expect(chrome).toContain('coding');
    expect(chrome).not.toContain('Assigned:');
    expect(chrome).not.toContain('Created by:');
    expect(body).not.toContain('Latest summary');
    expect(body).not.toContain('No summary comment.');
    expect(body).toContain('Description');
    expect(body).toContain('SUMMARY-FIRST-LINE');
    expect(body, 'Description starts expanded').toContain('TAIL-ONLY-LINE');
    expect(body, 'section headers have no carets').not.toMatch(NATIVE_CARET);
    expect(body).not.toContain('Latest spec');
    expect(body).not.toContain('Latest plan');
    await quit(tui);
  });

  it('aligns Overview copy within the body frame', async () => {
    const tui = await boot(TICKET_ROUTE);
    const rows = drawnRows(tui);
    const title = rows.find((row) => row.includes('BB-255'));
    const headline = rows.find(
      (row) => row.includes('Description') && !row.includes('SUMMARY'),
    );
    expect(title, 'header identity').toBeDefined();
    expect(headline, 'Description headline').toBeDefined();
    // The Overview renders inside the body frame (border + padding) so the
    // headline is indented relative to the chrome title — but it IS rendered.
    expect(
      headline?.indexOf('* Description'),
      'the Description headline is within the body area',
    ).toBeGreaterThan(0);
    await quit(tui);
  });

  it('Enter on Description expands then collapses again', async () => {
    const tui = await boot(TICKET_ROUTE);
    await tui.press('\r');
    expect(bodyRows(tui).join('\n')).not.toContain('TAIL-ONLY-LINE');
    await tui.press('\r');
    const expanded = bodyRows(tui).join('\n');
    expect(expanded).toContain('TAIL-ONLY-LINE');
    expect(expanded).toContain('SUMMARY-FIRST-LINE');
    expect(expanded).not.toMatch(NATIVE_CARET);
    await tui.press('\r');
    expect(bodyRows(tui).join('\n')).not.toContain('TAIL-ONLY-LINE');
    expect(bodyRows(tui).join('\n')).toMatch(/… \+\d+ more lines/);
    await quit(tui);
  });

  it('Space does the same thing Enter does', async () => {
    const tui = await boot(TICKET_ROUTE);
    await tui.press(' ');
    expect(bodyRows(tui).join('\n')).not.toContain('TAIL-ONLY-LINE');
    await tui.press(' ');
    expect(bodyRows(tui).join('\n')).toContain('TAIL-ONLY-LINE');
    await quit(tui);
  });

  it('a left click on the Description header toggles it in one step', async () => {
    const tui = await boot(TICKET_ROUTE);
    const header = bodyRows(tui).findIndex((line) =>
      line.includes('Description'),
    );
    expect(header, 'the Description header row is rendered').toBeGreaterThan(
      -1,
    );
    expect(bodyRows(tui).join('\n')).toContain('TAIL-ONLY-LINE');
    await click(tui, ticketBodyRow(tui, header));
    expect(bodyRows(tui).join('\n')).not.toContain('TAIL-ONLY-LINE');
    await click(tui, ticketBodyRow(tui, header));
    expect(bodyRows(tui).join('\n')).toContain('TAIL-ONLY-LINE');
    await quit(tui);
  });

  it('omits Latest summary when the ticket has no summary comment', async () => {
    const tui = await boot(TICKET_ROUTE);
    const body = bodyRows(tui);
    expect(body.join('\n')).not.toContain('Latest summary');
    expect(body.join('\n')).not.toContain('No summary comment.');
    const header = body.findIndex((line) => line.includes('Description'));
    expect(
      header,
      'Description is the first overview entry',
    ).toBeGreaterThanOrEqual(0);
    expect(header).toBeLessThanOrEqual(1);
    expect(body[header]).not.toMatch(NATIVE_CARET);
    await quit(tui);
  });

  it('without spec/plan comments Overview does not draw those entries', async () => {
    const tui = await boot({ screen: 'ticket', ticketId: BARE, view: 'full' });
    const text = bodyRows(tui).join('\n');
    expect(text).not.toContain('Latest spec');
    expect(text).not.toContain('Latest plan');
    expect(text).not.toContain('Latest summary');
    await quit(tui);
  });

  it('Planning shows Latest spec and Latest plan when comments exist', async () => {
    const tui = await boot({
      screen: 'ticket',
      ticketId: TYPED,
      view: 'full',
    });
    expect(bodyRows(tui).join('\n')).not.toContain('Latest spec');
    await tui.press(TAB);
    const body = bodyRows(tui);
    expect(drawnRows(tui).join('\n')).toContain('[Planning]');
    expect(body.join('\n')).toContain('[Spec]');
    expect(body.join('\n')).toContain('Plan');
    expect(body.join('\n')).toContain('SPEC-BODY-LINE');
    expect(body.join('\n')).not.toContain('PLAN-BODY-LINE');
    expect(body.join('\n')).not.toMatch(NATIVE_CARET);
    await quit(tui);
  });

  it('a click on the Description body does not collapse it', async () => {
    const tui = await boot(TICKET_ROUTE);
    const before = bodyRows(tui);
    expect(before.join('\n')).toContain('TAIL-ONLY-LINE');
    const copy = before.findIndex((line) => line.includes('TAIL-ONLY-LINE'));
    expect(copy).toBeGreaterThan(-1);
    await click(tui, ticketBodyRow(tui, copy));
    expect(bodyRows(tui).join('\n')).toContain('TAIL-ONLY-LINE');
    expect(bodyRows(tui), 'expanded description is unchanged').toEqual(before);
    await quit(tui);
  });

  it('Technical details lists empty properties as none', async () => {
    const tui = await boot(TICKET_ROUTE);
    await tui.press('\r');
    const body = bodyRows(tui).join('\n');
    expect(body).toMatch(/parent\s+:\s+BB-200/);
    expect(body).toMatch(/assigned\s+:\s+none/);
    expect(body).toMatch(/created\s+:\s+unknown/);
    expect(body).toMatch(/conductor\s+:\s+none/);
    expect(body).toMatch(/estimate\s+:\s+none/);
    expect(body).toMatch(/environments\s+:\s+none/);
    expect(body).not.toContain('No conductor.');
    expect(body).toMatch(/… \+\d+ more lines/);
    await quit(tui);
  });
});

describe('Overview — parent on the sidebar, links in the left column', () => {
  it('links appear full-width in the left column; parent is on the sidebar', async () => {
    const tui = await boot(TICKET_ROUTE);
    await tui.press('\r');
    const chrome = drawnRows(tui).join('\n');
    // Header shows state on the meta line (no prefixed rows).
    expect(chrome).toContain('coding');
    expect(chrome).not.toContain('Assigned:');
    expect(chrome).not.toContain('Created by:');
    expect(bodyRows(tui).join('\n')).toMatch(/parent\s+:\s+BB-200/);
    const body = bodyRows(tui);
    // Links render full-width in the left column, so the URL is painted
    // directly — no sidebar tab to click, no wrapping into the narrow column.
    expect(body.some((row) => row.includes('* links'))).toBe(true);
    expect(body.join('\n')).toMatch(/git\.example\/mr/);
    await quit(tui);
  });

  it('a ticket with no parent and no links omits both from Overview', async () => {
    const tui = await boot({ screen: 'ticket', ticketId: BARE, view: 'full' });
    const text = bodyRows(tui).join('\n');
    expect(text).not.toContain('No parent ticket.');
    expect(text).toMatch(/parent\s+:\s+none/);
    expect(text).not.toContain('No links.');
    expect(text).not.toContain('* links');
    await quit(tui);
  });
});

describe('BB-255 AC-5 — Related lives on the Overview sidebar', () => {
  it('the Related inner tab lists parent, sub-tickets and referenced', async () => {
    const tui = await boot(TICKET_ROUTE);
    const body = bodyRows(tui);
    const relatedRow = body.findIndex((row) => row.includes('Related'));
    expect(relatedRow, 'the Related tab is on Overview').toBeGreaterThan(-1);
    const relatedCol = (body[relatedRow] ?? '').indexOf('Related');
    await click(tui, ticketBodyRow(tui, relatedRow), relatedCol + 1);
    const text = bodyRows(tui).join('\n');
    expect(text).toMatch(/parent\s+:/);
    expect(text).toContain('BB-200');
    expect(text).toMatch(/sub-ticket/i);
    expect(text).toMatch(/referenced/i);
    await quit(tui);
  });
});

describe('BB-255 AC-6/AC-7 — runs are rows, and a row opens a run screen', () => {
  const toRuns = async (tui: BootedTui): Promise<void> => {
    for (let i = 0; i < 3; i += 1) await tui.press(TAB);
  };

  it('the Runs tab lists one row per run, newest first, not a count', async () => {
    const tui = await boot(TICKET_ROUTE);
    await toRuns(tui);
    const body = bodyRows(tui);
    // BB-375 — bodyRows is content inside the fixed viewport frame.
    expect(body[0], 'the shared run table header').toContain('RUN');
    expect(body[1]).toContain('#4599');
    expect(body[2]).toContain('#4592');
    expect(body.join('\n')).not.toMatch(/^\s*2 runs\s*$/m);
    await quit(tui);
  });

  it('↓ selects the older run and Enter opens ITS detail screen; Esc returns to Runs', async () => {
    const tui = await boot(TICKET_ROUTE);
    await toRuns(tui);
    await tui.press('\x1b[B');
    await tui.press('\r');
    const opened = drawnRows(tui).join('\n');
    expect(opened, 'the run screen’s own title').toContain('#4592');
    expect(opened, 'and its own fields').toContain(RUN_OLD);
    expect(opened).toContain('Footprint');
    await tui.press('\x1b');
    const back = drawnRows(tui).join('\n');
    expect(back, 'back on the ticket, Runs tab active').toContain('[Runs]');
    expect(back).toContain('#4599');
    await quit(tui);
  });

  it('a click on a run row opens the run it points at', async () => {
    const tui = await boot(TICKET_ROUTE);
    await toRuns(tui);
    // body[0] header, body[1] newest run, body[2] second run — not selected,
    // so the first click selects it and the second activates.
    //
    // THIS IS THE OFF-BY-ONE PROOF for the 1-based → 0-based mouse translation.
    // The two neighbouring rows are the OTHER run (#4599) and the filler below
    // the last one (inert), so a click landing one row off does not fail loudly
    // — it silently opens the wrong run. Hence the negative below: the shown
    // run must be #4592's, log included, and must NOT be the newest.
    const secondRun = 2;
    await click(tui, ticketBodyRow(tui, secondRun));
    await click(tui, ticketBodyRow(tui, secondRun));
    const opened = drawnRows(tui).join('\n');
    expect(opened).toContain('#4592');
    expect(opened, 'its own log, so the neighbour was not opened').toContain(
      RUN_OLD,
    );
    expect(opened, 'and never the newest run').not.toContain(RUN_NEW);
    await quit(tui);
  });

  it('a ticket with no runs shows an explicit empty state', async () => {
    const tui = await boot({ screen: 'ticket', ticketId: BARE, view: 'full' });
    for (let i = 0; i < 3; i += 1) await tui.press(TAB);
    expect(bodyRows(tui).join('\n')).toContain('No runs for this ticket.');
    await quit(tui);
  });

  it('a run: route lands on the run screen with the Runs tab underneath', async () => {
    const tui = await boot(RUN_ROUTE);
    const opened = drawnRows(tui).join('\n');
    expect(opened, 'the run screen, not the ticket').toContain('#4599');
    expect(opened).toContain(RUN_NEW);
    await tui.press('\x1b');
    const back = drawnRows(tui).join('\n');
    expect(back, 'ONE Esc lands on its ticket’s Runs tab').toContain('[Runs]');
    expect(back).toContain('BB-255');
    await quit(tui);
  });
});

describe('BB-255 AC-8 — the header box shows the ticket’s labels', () => {
  // The header now has a two-line layout: title + meta (state · assignee ·
  // labels). Labels appear on the meta line without a "Labels:" prefix, joined
  // with the state and assignee by "  ·  ". The meta line sits above the tab
  // bar inside the header box.
  it('the ticket frame carries label names on the meta line, above the tab bar', async () => {
    const tui = await boot(TICKET_ROUTE);
    const all = drawnRows(tui);
    // The meta line contains the label name without a 'Labels:' prefix.
    const metaRow = all.findIndex((l) => l.includes('work:code'));
    expect(metaRow, 'the meta row with label names is drawn').toBeGreaterThan(
      -1,
    );
    const barRow = all.findIndex((l) => l.includes('[Overview]'));
    expect(
      metaRow,
      'meta line is between the title and the tab bar',
    ).toBeLessThan(barRow);
    const headerBlock = all.slice(0, barRow).join('\n');
    // State and labels appear on the meta line without prefixes.
    expect(headerBlock).toContain('coding');
    expect(headerBlock).toContain('work:code');
    expect(headerBlock).toContain('╰');
    // No old-style prefixed rows in the header.
    expect(headerBlock).not.toContain('Labels:');
    expect(headerBlock).not.toContain('State:');
    expect(headerBlock).not.toContain('Assigned:');
    expect(headerBlock).not.toContain('Created by:');
    await quit(tui);
  });

  it('a label-less ticket shows only state on the meta line', async () => {
    const tui = await boot({ screen: 'ticket', ticketId: BARE, view: 'full' });
    const all = drawnRows(tui);
    // No 'Labels:' prefix anywhere in the header.
    expect(all.join('\n')).not.toContain('Labels:');
    // The meta line itself must not be empty (state is present).
    const barRow = all.findIndex((l) => l.includes('[Overview]'));
    const headerBlock = all.slice(0, barRow).join('\n');
    expect(headerBlock.trim()).toBeTruthy();
    await quit(tui);
  });
});

describe('BB-255 D9 — ↑↓ scroll unless the tab has MORE THAN ONE entry', () => {
  it('on Overview the arrows move the selection between entries', async () => {
    const tui = await boot(TICKET_ROUTE);
    const top = bodyRows(tui);
    expect(top.join('\n')).toContain('TAIL-ONLY-LINE');
    expect(
      bodyRows(tui).join('\n'),
      'the Description stayed expanded while selection moved',
    ).toContain('TAIL-ONLY-LINE');
    await tui.press(DOWN);
    expect(
      bodyRows(tui).join('\n'),
      'the Description stayed expanded — per-entry state',
    ).toContain('TAIL-ONLY-LINE');
    await tui.press(UP);
    await tui.press('\r');
    const rows = bodyRows(tui).join('\n');
    expect(rows).not.toContain('TAIL-ONLY-LINE');
    expect(rows).not.toMatch(NATIVE_CARET);
    await quit(tui);
  });

  it('at the LAST entry ↓ falls through to the body scroll, and ↑ at entry 0 does too', async () => {
    const window = (tui: BootedTui): string =>
      bodyRows(tui).slice(0, 3).join('|');
    const tui = await boot(TICKET_ROUTE);
    await tui.press('G');
    expect(drawnRows(tui).join('\n')).toContain('Details');
    const afterLast = window(tui);
    await tui.press(DOWN);
    expect(window(tui), '↓ on the last entry scrolled the body').not.toBe(
      afterLast,
    );
    await tui.press('g');
    const atFirst = window(tui);
    for (let step = 0; step < 6; step += 1) tui.mockInput.pressKey('\x1b[6~');
    await settle();
    await tui.renderOnce();
    const scrolled = window(tui);
    expect(scrolled, 'paged away from the opening rows').not.toBe(atFirst);
    await tui.press(UP);
    expect(window(tui), '↑ at entry 0 falls through to scroll').not.toBe(
      scrolled,
    );
    await quit(tui);
  });

  it('from entry 0 ↓ moves the SELECTION and leaves the window alone', async () => {
    const tui = await boot(TICKET_ROUTE);
    await tui.press(DOWN);
    await tui.press(UP);
    expect(
      bodyRows(tui).join('\n'),
      'Description stayed expanded while selection moved',
    ).toContain('TAIL-ONLY-LINE');
    expect(bodyRows(tui).slice(0, 2).join('\n')).toContain('Description');
    await tui.press('\r');
    expect(
      bodyRows(tui).join('\n'),
      'Enter on entry 0 collapsed Description',
    ).not.toContain('TAIL-ONLY-LINE');
    await quit(tui);
  });

  // The scroll branch of D9 still has a subject on this screen, and it is worth
  // keeping: the FOOTER names which of the two the operator gets. On Overview it
  // says `select` now (`selectable > 1`), where it said `scroll` while Description
  // was the only entry.
  it('the footer names `select` on Overview, because it has two entries', async () => {
    const tui = await boot(TICKET_ROUTE);
    // BB-375 — screen ladder rides the header state row; kernel footer is basics.
    expect(drawnRows(tui).join('\n'), 'BB-369 D4').toContain('↑↓:Select');
    await quit(tui);
  });

  it('with several runs the arrows move the SELECTION, not the viewport', async () => {
    const tui = await boot(TICKET_ROUTE);
    for (let i = 0; i < 3; i += 1) await tui.press(TAB);
    const top = bodyRows(tui);
    await tui.press('\x1b[B');
    expect(bodyRows(tui)[0], 'the window did not move').toBe(top[0]);
    await tui.press('\r');
    expect(
      drawnRows(tui).join('\n'),
      'the selection did — the older run opened',
    ).toContain('#4592');
    await quit(tui);
  });
});

describe('BB-255 AC-9 — the chrome geometry at the new header height', () => {
  it('a click on the ticket bar at its NEW row still switches sections', async () => {
    const tui = await boot(TICKET_ROUTE);
    const barRow =
      drawnRows(tui).findIndex((l) => l.includes('[Overview]')) + 1;
    // BB-346 put the bar in the chrome's own bar row (it was row 4, the header
    // box's third content row); BB-369 D1's state row then pushed that row from
    // 5 to 6, one below where every OTHER level's bar sits. Derived from the shape
    // rather than written as `6`, so the next header row carries it along.
    expect(barRow, 'the bar row is the chrome’s').toBe(
      chromeRowOf(chromeShape(2, true), TAB_BAR_ID),
    );
    // The SECOND off-by-one proof, and the sharper one: the tab bar occupies
    // exactly this row. Only the row the bar is DRAWN on carries a tab node —
    // so if `click`'s `- 1` were wrong in either direction, no tab switch would
    // happen at all and the expectation below would fail.
    await click(tui, barRow, 18);
    expect(drawnRows(tui).join('\n')).toContain('[Planning]');
    await quit(tui);
  });

  // THE COLUMN SEAM, FROM BOTH SIDES — BB-340 Task 11, and the columns did not
  // move.
  //
  // The case above clicks the MIDDLE of ` Planning `, which a translation off by
  // one in either direction still resolves to the same tab. These two click its
  // first and last columns, where an off-by-one lands on the join between two
  // tabs instead and switches nothing.
  //
  // `[Overview]` at 2-11, the join at 12-13, ` Planning ` at 14-23.
  const PLANNING_FIRST_COLUMN = 14;
  const PLANNING_LAST_COLUMN = 23;
  it.each([
    ['first', PLANNING_FIRST_COLUMN],
    ['last', PLANNING_LAST_COLUMN],
  ])('a click on the %s column of a section switches to it', async (_name, column) => {
    const tui = await boot(TICKET_ROUTE);
    const barRow =
      drawnRows(tui).findIndex((l) => l.includes('[Overview]')) + 1;
    await click(tui, barRow, column);
    expect(drawnRows(tui).join('\n')).toContain('[Planning]');
    await quit(tui);
  });

  it('the ticket screen’s body starts exactly after its own chrome', async () => {
    const tui = await boot(TICKET_ROUTE);
    const all = drawnRows(tui);
    const chrome = chromeRowCount(chromeShape(2, true));
    expect(
      all[firstBodyIndex(all)],
      'the first body row is not empty',
    ).not.toBe('');
    expect(firstBodyIndex(all), 'body starts where chrome ends').toBe(chrome);
    // BB-375 — framed body: top border sits flush under the tab bar.
    expect(all[chrome], 'frame top under the bar').toContain('╭');
    await quit(tui);
  });
});

// AC-7 / D7 — the non-TTY branch must mean the same thing as the TTY one, or
// `bakers ui run:<uuid>` prints two different things depending on whether stdout is
// a terminal. That drift is exactly what BB-223 Decision 11 exists to prevent.
describe('BB-255 D7 — the piped render follows the route', () => {
  /**
   * BB-326 — the ONE place this file still swaps the real streams.
   *
   * The non-TTY branch builds no renderer: it joins the screen's lines and
   * writes them to `process.stdout` itself, so `bootTui` (which never touches
   * the streams) cannot reach it. The stand-in carries the minimum that branch
   * reads — `isTTY`, which is what chooses the branch, `columns`, which sizes
   * the lines, and `write` — and is restored in a `finally` so a throwing kernel
   * cannot leave the test runner without a stdout.
   *
   * The captured text is not a transcript in the misleading sense the fake
   * output was: this branch writes exactly once, so what is asserted below is
   * the whole and only render.
   */
  const pipedFor = async (route: ResolvedRoute): Promise<string> => {
    const chunks: string[] = [];
    const realStdin = process.stdin;
    const realStdout = process.stdout;
    const swap = (name: 'stdin' | 'stdout', value: unknown): void => {
      Object.defineProperty(process, name, { value, configurable: true });
    };
    swap('stdin', { isTTY: false });
    swap('stdout', {
      isTTY: false,
      columns: 120,
      rows: 40,
      write: (chunk: string): boolean => {
        chunks.push(String(chunk));
        return true;
      },
    });
    try {
      await runTicketTui({}, {}, fakeServices(), { route });
    } finally {
      swap('stdin', realStdin);
      swap('stdout', realStdout);
    }
    return chunks.join('');
  };

  it('a run: route prints the RUN’s fields, not the ticket’s sections', async () => {
    const text = await pipedFor(RUN_ROUTE);
    expect(text).toContain('#4599');
    expect(text).toContain(RUN_NEW);
    expect(text).toContain('Footprint');
    expect(text, 'the ticket body is not what was asked for').not.toContain(
      'TAIL-ONLY-LINE',
    );
  });

  it('a plain ticket route still prints the ticket, labels and parent included', async () => {
    const text = await pipedFor(TICKET_ROUTE);
    expect(text).toContain('BB-255');
    expect(text).toContain('work:code');
    expect(text).toContain('BB-200');
    expect(text, 'the flat render is the WHOLE body').toContain(
      'TAIL-ONLY-LINE',
    );
    expect(text, 'and the run rows, not a count').toContain('#4599');
  });
});

// BB-255 AC-11 (S12/S13/S14) — the run detail screen is READ-ONLY in its key
// handling. `activateSelected`'s unguarded ticket tail used to be reached from
// the run screen, where `activeTabId()` is still `runs` (the tab underneath the
// pushed screen): Enter silently swapped the shown run for `ticketRunRows()[
// selectedEntry]` and pushed a second history frame. Every assertion below is on
// the FRAME, because "what the operator reads" is the thing that was wrong.
describe('BB-255 AC-11 — the run detail screen honours only what it advertises', () => {
  const toRuns = async (tui: BootedTui): Promise<void> => {
    for (let i = 0; i < 3; i += 1) await tui.press(TAB);
  };

  it('S12: Enter and Space leave the run screen byte-identical, and one Esc returns to the Runs tab', async () => {
    const tui = await boot(TICKET_ROUTE);
    await toRuns(tui);
    await tui.press('\x1b[B'); // select the OLDER run…
    await tui.press('\r'); // …and open it
    const opened = styledFrame(tui);
    // `#4592` alone does NOT establish the baseline: the Runs tab lists that
    // number too, so it would be answered by a `\r` that opened nothing at all
    // and left every inertness assertion below comparing the Runs tab with
    // itself. The run's own uuid exists only on the older run's detail screen.
    expect(tui.frame(), 'the older run is the one shown').toContain('#4592');
    expect(tui.frame(), 'and it really is the run SCREEN').toContain(RUN_OLD);

    await tui.press('\r');
    expect(styledFrame(tui), 'Enter is inert: the screen did not change').toBe(
      opened,
    );
    await tui.press(' ');
    expect(styledFrame(tui), 'Space is inert too').toBe(opened);

    await tui.press('\x1b');
    const back = tui.frame();
    expect(back, 'ONE Esc — the stack was never deepened').toContain('[Runs]');
    expect(back, 'and it is the ticket, not another run').toContain('BB-255');
    await quit(tui);
  });

  it('S13: after a run: deep link Enter keeps the DEEP-LINKED run, not the newest', async () => {
    // The harmful case: a deep link leaves `selectedEntry` at 0 while the shown
    // run is the deep-linked one, so the old swap was unconditional and silent —
    // the operator read #4599's log believing it was #4592's.
    const tui = await boot(RUN_OLD_ROUTE);
    const opened = styledFrame(tui);
    expect(tui.frame()).toContain('#4592');
    expect(tui.frame()).toContain(RUN_OLD);

    await tui.press('\r');
    const after = tui.frame();
    expect(after, 'still the run that was linked to').toContain('#4592');
    expect(after, 'and still ITS log').toContain(RUN_OLD);
    expect(after, 'never the newest run').not.toContain(RUN_NEW);
    expect(styledFrame(tui), 'the screen did not change at all').toBe(opened);

    await tui.press(' ');
    expect(styledFrame(tui), 'Space stays inert after a deep link').toBe(
      opened,
    );

    await tui.press('\x1b');
    const back = tui.frame();
    expect(back, 'ONE Esc reaches the ticket').toContain('[Runs]');
    expect(back).toContain('BB-255');
    await quit(tui);
  });

  it('S12: a left click on the run screen activates nothing', async () => {
    const tui = await boot(RUN_OLD_ROUTE);
    const opened = styledFrame(tui);
    // The baseline is stated, not assumed: without this the whole test would be
    // satisfied by a boot that never reached the run screen, comparing whatever
    // it did reach with itself.
    expect(tui.frame(), 'the run screen is what the clicks land on').toContain(
      RUN_OLD,
    );
    // Two clicks on the same body row: on a selectable screen the first selects
    // and the second activates, so this is the strongest inert-ness this gesture
    // can be asked for.
    await click(tui, ticketBodyRow(tui, 1));
    await click(tui, ticketBodyRow(tui, 1));
    expect(styledFrame(tui), 'no selection, no activation, no change').toBe(
      opened,
    );
    await quit(tui);
  });

  it('S14: the hint row names exactly the keys the README’s Run detail row names', async () => {
    const tui = await boot(RUN_OLD_ROUTE);
    // BB-375 — kernel owns ↑↓ / Esc / q basics; a terminal run publishes no
    // action ladder of its own. BB-536 — a claimed/running run now does: `e`.
    const frame = drawnRows(tui).join('\n');
    expect(frame).toMatch(/↑↓/);
    expect(frame).toMatch(/Esc:back|Esc back/);
    expect(frame).toContain('q:quit');
    expect(
      frame,
      'a terminal run must not advertise an activation key',
    ).not.toMatch(/Enter open|Space expand|↑↓ scroll|e:Edit/);
    await quit(tui);

    const cancellable = await boot(RUN_ROUTE);
    const cancellableFrame = drawnRows(cancellable).join('\n');
    expect(cancellableFrame, 'a claimed/running run advertises e:Edit').toMatch(
      /e:Edit/,
    );
    await quit(cancellable);

    const readme = readFileSync(
      new URL('../../README.md', import.meta.url),
      'utf8',
    );
    const row = readme
      .split('\n')
      .find((line) => line.startsWith('| Run detail |'));
    expect(row, 'the README documents the run detail screen').toBeDefined();
    const documented = [...(row ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);

    // Scraped from the two rendered frames above, not a second hand-mirrored
    // constant — a hint row gaining or losing a key fails this without the
    // README and the constant being edited in lockstep by hand.
    const rendered = new Set<string>();
    if (/↑↓/.test(frame)) rendered.add('↑↓');
    if (/Esc:back|Esc back/.test(frame)) rendered.add('Esc');
    if (frame.includes('q:quit')) rendered.add('q');
    if (/e:Edit/.test(cancellableFrame)) rendered.add('e');

    expect(
      [...documented].sort(),
      'README documents exactly the keys the hint rows render',
    ).toEqual([...rendered].sort());
  });
});
