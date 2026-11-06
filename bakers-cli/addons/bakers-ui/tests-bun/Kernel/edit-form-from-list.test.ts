import { expect, it } from 'bun:test';
import type { RGBA } from '@opentui/core';
import { THEME_SLOTS } from '../../src/lib/theme.js';
import type {
  Collection,
  DropshClient,
  RendererServices,
  ResourceWriteBody,
  TuiOptions,
} from '../../src/types.js';
import { type BootedTui, bootTui, settle } from '../tui-harness.js';

// BB-252 — the edit popup opened from the TICKET LIST, driven through the real
// kernel over a real renderer. Everything asserted here is a property of the key
// routing and of which document the popup was handed, so none of it can be
// proven by the pure form model.
//
// The fake world is deliberately INCONSISTENT between the list read and the
// detail read: the row for the edited ticket shows initials `ZZ` and the
// conductor label `stale-list-label`, while its detail document links the user
// `cw` and the conductor `cw-framework`. A prefill sourced from the row's
// display values therefore cannot pass — which is exactly what AC-2 asks.
//
// BB-326 — EVERY ASSERTION IN THIS FILE WAS RE-READ, NOT TRANSLATED. The fake
// output accumulated every byte the kernel had ever written, so `output.text`
// answered `toContain` out of a transcript rather than out of the screen. The
// renderer's `frame()` is the CURRENT SCREEN, which is what all of these meant.
// Two of them changed meaning in the swap and say so at their site: the AC-1
// opener (`output.text` → the screen) and the "still LOADING" case, whose old
// staging could not reach the ticket list at all.

const T1 = 'ffffffff-0000-0000-0000-000000000001'; // the selected row
const T2 = 'ffffffff-0000-0000-0000-000000000002'; // a DIFFERENT ticket
const USER = 'aaaaaaaa-0000-0000-0000-000000000001'; // cw
const OTHER_USER = 'aaaaaaaa-0000-0000-0000-000000000002'; // tm
const COND = 'bbbbbbbb-0000-0000-0000-000000000001'; // cw-framework
const LIST_COND = 'bbbbbbbb-0000-0000-0000-000000000002'; // stale-list-label
const PROJECT = 'pppppppp-0000-0000-0000-000000000001';
const PARENT = 'cccccccc-0000-0000-0000-000000000001'; // BB-236

/** One `data[]` entry of the LIST read. */
const listRow = (
  id: string,
  identifier: string,
  initials: string,
  conductorId: string | null,
) => ({
  id,
  type: 'bb_ticket--bb_ticket',
  attributes: {
    identifier,
    title: `${identifier} title`,
    state: 'coding',
    priority: 2,
    assignee_initials: initials,
    derived_status: 'idle',
    workflow: 'bb_work',
  },
  relationships: {
    labels: { data: [] },
    parent_id: { data: { id: PARENT } },
    conductor_id: conductorId ? { data: { id: conductorId } } : { data: null },
  },
});

const listDoc = (rows = [T1, T2]) => ({
  data: rows.map((id) =>
    id === T1
      ? listRow(T1, 'BB-252', 'ZZ', LIST_COND)
      : listRow(T2, 'BB-999', 'QQ', null),
  ),
  included: [
    { id: PARENT, attributes: { identifier: 'BB-236' } },
    { id: LIST_COND, attributes: { label: 'stale-list-label' } },
  ],
});

/** The `include=` names of a request path. The fake HONOURS them: a relationship
 *  linkage is always returned, but its target only appears in `included` when it
 *  was asked for — which is what makes the Parent column depend on the include
 *  set rather than on the fake's generosity. */
const includeNames = (path: string): string[] =>
  /[?&]include=([^&]*)/.exec(path)?.[1]?.split(',') ?? [];

/** The DETAIL document of one ticket. `assignee` decides who is linked, which is
 *  how the post-write re-read differs from the pre-write one. */
const detailDoc = (
  id: string,
  identifier: string,
  assignee: string | null,
  initials: string,
  included: string[],
) => ({
  data: {
    id,
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier,
      title: `${identifier} title`,
      state: 'coding',
      priority: 2,
      description: 'The description body.',
      assignee_initials: initials,
      derived_status: 'idle',
      workflow: 'bb_work',
    },
    relationships: {
      labels: { data: [] },
      project_id: { data: { id: PROJECT } },
      parent_id: { data: { id: PARENT } },
      assignee_user_id: assignee ? { data: { id: assignee } } : { data: null },
      conductor_id: { data: { id: COND } },
      runs: { data: [] },
    },
  },
  included: [
    ...(included.includes('assignee_user_id')
      ? [
          { id: USER, type: 'user--user', attributes: { display_name: 'cw' } },
          {
            id: OTHER_USER,
            type: 'user--user',
            attributes: { display_name: 'tm' },
          },
        ]
      : []),
    ...(included.includes('conductor_id')
      ? [
          {
            id: COND,
            type: 'bb_conductor--bb_conductor',
            attributes: { label: 'cw-framework' },
          },
        ]
      : []),
    ...(included.includes('parent_id')
      ? [{ id: PARENT, attributes: { identifier: 'BB-236' } }]
      : []),
  ],
});

interface Recorder {
  /** Every read path, in order. `'LIST'` stands for a `loadFilteredTickets`. */
  reads: string[];
  writes: { type: string; id: string; body: ResourceWriteBody }[];
  optionCollections: string[];
}

function res(
  id: string,
  attributes: Record<string, unknown>,
  projectId?: string,
) {
  return {
    id,
    type: 't',
    attr: (k: string) => attributes[k],
    rel: () => projectId ?? null,
    rels: () => [],
  };
}

interface HarnessOpts {
  /** Reject the DETAIL read of the selected row (AC-7). */
  detailError?: unknown;
  /** Reject the option lists (AC-7). */
  optionsError?: unknown;
  /** Reject the PATCH (AC-7). */
  writeError?: unknown;
  /** Rows the list read returns (the empty-list case passes `[]`). */
  rows?: string[];
  /** Hold every detail read until `releaseDetail()` is called (the latch case). */
  gateDetail?: boolean;
  /** Hold every LIST read until `releaseList()` is called (the loading case). */
  gateList?: boolean;
}

function harness(opts: HarnessOpts = {}) {
  const rec: Recorder = { reads: [], writes: [], optionCollections: [] };
  let rowsInList = opts.rows ?? [T1, T2];
  const detailGates: (() => void)[] = [];
  const listGates: (() => void)[] = [];

  const emptyCollection = (): Collection => {
    const c: Collection = {
      where: () => c,
      sort: () => c,
      page: () => c,
      first: async () => null,
      list: async () => [],
    };
    return c;
  };

  const read: DropshClient = {
    collection: () => emptyCollection(),
    get: async (path: string) => {
      if (path === 'bb_project/bb_project') {
        return {
          data: [
            {
              id: PROJECT,
              type: 'bb_project--bb_project',
              attributes: { name: 'bakers' },
              relationships: { group_id: { data: null }, teams: { data: [] } },
            },
          ],
          included: [],
        };
      }
      if (path === 'bb_ticket/bb_ticket') {
        rec.reads.push('LIST');
        if (opts.gateList) {
          await new Promise<void>((resolve) => listGates.push(resolve));
        }
        return listDoc(rowsInList);
      }
      rec.reads.push(path);
      if (opts.gateDetail) {
        await new Promise<void>((resolve) => detailGates.push(resolve));
      }
      const inc = includeNames(path);
      if (path.startsWith(`bb_ticket/bb_ticket/${T1}`)) {
        if (opts.detailError !== undefined) throw opts.detailError;
        // The server's view AFTER the PATCH: the write moved the assignee to
        // `tm`, so a row rebuilt from this document must show `TM`.
        return rec.writes.length > 0
          ? detailDoc(T1, 'BB-252', OTHER_USER, 'TM', inc)
          : detailDoc(T1, 'BB-252', USER, 'CW', inc);
      }
      if (path.startsWith(`bb_ticket/bb_ticket/${T2}`)) {
        return detailDoc(T2, 'BB-999', OTHER_USER, 'QQ', inc);
      }
      return { data: [] };
    },
    update: async () => {
      throw new Error('the READ client must never be used for a write');
    },
  };

  const optionRows: Record<string, ReturnType<typeof res>[]> = {
    user: [
      res(USER, { display_name: 'cw', drupal_internal__uid: 1 }),
      res(OTHER_USER, { display_name: 'tm', drupal_internal__uid: 2 }),
    ],
    bb_conductor: [
      res(COND, { label: 'cw-framework', status: 'running' }, PROJECT),
    ],
  };

  const write: DropshClient = {
    collection: (type: string) => {
      rec.optionCollections.push(type);
      const c: Collection = {
        where: () => c,
        sort: () => c,
        page: () => c,
        first: async () => null,
        list: async () => {
          if (opts.optionsError !== undefined) throw opts.optionsError;
          return (optionRows[type] ?? []) as never;
        },
      };
      return c;
    },
    get: async () => ({ data: [] }),
    update: async (type: string, id: string, body: ResourceWriteBody) => {
      rec.writes.push({ type, id, body });
      if (opts.writeError !== undefined) throw opts.writeError;
      return { data: { type, id } };
    },
  };

  const services: RendererServices = {
    client: read,
    baseUrl: 'https://x.test',
  };
  return {
    rec,
    services,
    write,
    /** Replace what the NEXT list read returns (the late-debounce case). */
    setRows: (rows: string[]): void => {
      rowsInList = rows;
    },
    /** Let every held detail read proceed (the in-flight latch case). */
    releaseDetail: (): void => {
      for (const resolve of detailGates.splice(0)) resolve();
    },
    /** Let every held LIST read proceed (the loading case). */
    releaseList: (): void => {
      for (const resolve of listGates.splice(0)) resolve();
    },
    pendingDetailReads: (): number => detailGates.length,
  };
}

/** A frame without its box characters and with whitespace collapsed — so an
 *  assertion tests the TEXT the operator reads, not where the box wrapped it.
 *
 *  BB-326: the ANSI strip that used to lead this pipeline is gone. The
 *  renderer paints cells, so the frame arrives as characters and an escape in it
 *  would be a defect rather than something to filter out. */
const plain = (text: string): string =>
  text
    .replace(/[│╭╮╰╯─▸]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Boot the PROJECT screen (the ticket list) under a real renderer. */
async function bootProject(
  h: ReturnType<typeof harness>,
  over: Partial<TuiOptions> = {},
): Promise<BootedTui> {
  return bootTui({
    services: h.services,
    tui: {
      route: { screen: 'project', projectId: PROJECT, projectName: 'bakers' },
      writeClient: h.write,
      ...over,
    },
  });
}

/** Boot the PROJECT screen, Tab on to the ticket list, and return a driver. */
async function openList(
  h: ReturnType<typeof harness>,
  over: Partial<TuiOptions> = {},
) {
  const tui = await bootProject(h, over);
  // A deep-linked project lands on its OVERVIEW, so the ticket list — what
  // every test below is about — is one Tab away. Tabbing here rather than routing around it keeps these tests on the
  // path a human actually walks.
  await tui.press('\t');
  const press = (key: string): Promise<void> => tui.press(key);
  /** Press without settling — for the two-keys-while-in-flight case. */
  const pressRaw = (key: string): void => {
    tui.mockInput.pressKey(key);
  };
  const quit = async (): Promise<void> => {
    // Esc is the ONE key OpenTUI delivers asynchronously (it is the prefix of
    // every CSI sequence, so the parser holds it for a disambiguation window),
    // which `press` waits out.
    await press('\x1b');
    tui.mockInput.pressKey('q');
    await tui.running;
    await tui.stop();
  };
  return { tui, press, pressRaw, quit };
}

// ---- AC-1 / AC-2 ------------------------------------------------------------

it('AC-1: `e` on the ticket list opens the popup for the selected row', async () => {
  const h = harness();
  const { tui, press, quit } = await openList(h);
  // BB-326: this was `output.text`, the whole transcript, and so was only ever
  // true BEFORE the first open — it could not have failed here. Against the
  // current screen it is the honest "the list is showing, no popup is".
  expect(tui.frame()).not.toContain('Edit ticket');

  await press('e');
  expect(tui.frame()).toContain('Edit ticket');
  // The detail read of the SELECTED row is what the popup was handed.
  expect(h.rec.reads.some((p) => p.includes(T1))).toBe(true);
  await quit();
});

it('AC-2: the prefill resolves from the relationships, not from the row', async () => {
  const h = harness();
  const { tui, press, quit } = await openList(h);
  await press('e');
  const shown = tui.frame();
  // The document links `cw` + `cw-framework`…
  expect(shown).toContain('< cw >');
  expect(shown).toContain('< cw-framework (running) >');
  // …while the ROW displays `ZZ` and `stale-list-label`, so neither of those
  // could have supplied the prefill. The list is still painted BEHIND the popup,
  // so `stale-list-label` itself is on screen — it is the `>` of the select that
  // makes this a claim about the popup and not about the background.
  expect(shown).not.toContain('< ZZ >');
  expect(shown).not.toContain('stale-list-label >');
  await quit();
});

it('AC-2: `e` edits the HIGHLIGHTED row, not the ambient `detail` (wrong-entity guard)', async () => {
  const h = harness();
  const { press, quit } = await openList(h);
  // Visit the SECOND ticket's detail, then come back to the list. Nothing
  // clears `detail` on the way out, so it still holds BB-999's document.
  await press('\x1b[B'); // ↓ to row 2
  await press('\r'); // open it
  await press('\x1b'); // Esc back to the list
  await press('\x1b[A'); // ↑ back to row 1 (the T1 row)

  await press('e');
  await press('\x13'); // Ctrl+S

  expect(h.rec.writes).toHaveLength(1);
  expect(h.rec.writes[0]?.id).toBe(T1);
  await quit();
});

// ---- AC-3: the row reflects the write, the selection does not move -----------

/** The rendered table line of one identifier in the current frame. Matched per
 *  LINE, not by splitting the frame on `BB-` — the Parent column holds an
 *  identifier too, and splitting there cut every row short of its own parent. */
const rowLine = (tui: BootedTui, identifier: string): string =>
  tui
    .rows()
    .map(plain)
    .find((l) => l.startsWith(`${identifier} `)) ?? '';

/**
 * The table line the cursor is on. The selected row uses FOREGROUND_ACTIVE fg (BB-375).
 * Identifier match keeps chrome / other FOREGROUND_ACTIVE surfaces out of the hit.
 */
const selectedRowLine = (tui: BootedTui): string => {
  for (const line of tui.captureSpans().lines) {
    const text = line.spans.map((span) => span.text).join('');
    const active = line.spans.some(
      (span) =>
        (span as { fg?: RGBA }).fg?.intent === 'indexed' &&
        (span as { fg?: RGBA }).fg?.slot === THEME_SLOTS.foregroundActive,
    );
    if (active && /BB-\d+/.test(text)) return text;
  }
  return '';
};

it('AC-3: after a save the ROW shows the new assignee and keeps its parent', async () => {
  const h = harness();
  const { tui, press, quit } = await openList(h);
  expect(rowLine(tui, 'BB-252')).toContain('ZZ');

  await press('e');
  await press('\x1b[C'); // → cycle the assignee cw → tm
  await press('\x13'); // Ctrl+S

  expect(h.rec.writes).toHaveLength(1);
  const line = rowLine(tui, 'BB-252');
  // The row was rebuilt from the re-read: new initials, and the conductor label
  // now comes from the ticket's real relationship rather than the list's stale
  // one.
  expect(line).toContain('TM');
  expect(line).toContain('cw-framework');
  // …and the Parent column is still populated. This is the whole reason
  // `parent_id` joined the detail include set: without it the mapped row's
  // parent is null and the column silently renders `—`.
  expect(line).toContain('BB-236');
  await quit();
});

it('AC-3: the list is NOT re-read and the highlight does not move', async () => {
  const h = harness();
  const { tui, press, quit } = await openList(h);
  const listReadsBefore = h.rec.reads.filter((p) => p === 'LIST').length;

  await press('e');
  await press('\x1b[C');
  await press('\x13');

  // A second `loadFilteredTickets` would re-sort `changed DESC`, putting the
  // edited ticket at index 0 while `selectedTicket` stays put — the highlight
  // would then sit on a different ticket.
  expect(h.rec.reads.filter((p) => p === 'LIST')).toHaveLength(listReadsBefore);
  // The highlight is still on the ticket that was edited.
  expect(selectedRowLine(tui)).toContain('BB-252');
  await quit();
});

it('AC-3: a late search debounce cannot repoint the row — it is keyed by id', async () => {
  const h = harness();
  const { tui, press, quit } = await openList(h);
  // Enter search mode and type, which arms the 200 ms debounce, then leave it
  // with Enter — which clears the flag but NOT the timer.
  await press('/');
  await press('b');
  await press('\r');
  // The pending read will return the rows in the OTHER order, so the edited
  // ticket lands at a different index than the one it was opened at.
  h.setRows([T2, T1]);

  await press('e');
  // Let the debounce land while the popup is open.
  await new Promise((resolve) => setTimeout(resolve, 250));
  await press('\x1b[C');
  await press('\x13');

  expect(h.rec.writes).toHaveLength(1);
  expect(h.rec.writes[0]?.id).toBe(T1);
  // The EDITED ticket is the one that changed…
  expect(rowLine(tui, 'BB-252')).toContain('TM');
  // …and the other row, which now occupies the index the popup was opened at,
  // is untouched.
  expect(rowLine(tui, 'BB-999')).toContain('QQ');
  await quit();
});

it('AC-3: a stale search that omitted the edited ticket cannot replace the mutation', async () => {
  const h = harness();
  const { tui, press, quit } = await openList(h);
  await press('/');
  await press('b');
  await press('\r');
  // The pending read filters the edited ticket OUT of the list entirely.
  h.setRows([T2]);

  await press('e');
  await new Promise((resolve) => setTimeout(resolve, 250));
  await press('\x1b[C');
  await press('\x13');

  expect(h.rec.writes).toHaveLength(1);
  const shown = plain(tui.frame());
  // The stale search result is rejected and the newer mutation remains visible.
  expect(shown).toContain('saved');
  expect(rowLine(tui, 'BB-252')).toContain('TM');
  expect(rowLine(tui, 'BB-999')).toContain('QQ');
  await quit();
});

it('AC-3: a list-path save does not plant the document into `detail`', async () => {
  const h = harness();
  const { tui, press, quit } = await openList(h);
  await press('e');
  await press('\x1b[C');
  await press('\x13');

  // Now walk into the OTHER ticket. If the save had written `detail`, the
  // detail screen would be free to render the edited ticket instead.
  await press('\x1b[B'); // ↓ to BB-999
  await press('\r');
  const shown = plain(tui.frame());
  expect(shown).toContain('BB-999');
  expect(shown).not.toContain('BB-252');
  await quit();
});

// ---- AC-5 (the row must exist) ---------------------------------------------

it('AC-5: `e` is inert on an EMPTY list — no read, no popup', async () => {
  const h = harness({ rows: [] });
  const { tui, press, quit } = await openList(h);
  const readsBefore = h.rec.reads.length;
  await press('e');
  expect(plain(tui.frame())).not.toContain('Edit ticket');
  expect(h.rec.reads).toHaveLength(readsBefore);
  expect(h.rec.optionCollections).toEqual([]);
  await quit();
});

it('AC-5: `e` is inert while the list is still LOADING', async () => {
  // BB-326 — RE-STAGED, because the old staging could not reach the state it
  // names. It booted the project route and pressed `e` before settling, but
  // the project route lands on Overview: the key landed on a screen that
  // has no `e` at all, so the case proved nothing about a loading ticket list.
  // Here the LIST read itself is held, so the Tickets screen really is in its
  // loading state when the key arrives.
  const h = harness({ gateList: true });
  const tui = await bootProject(h);
  tui.mockInput.pressKey('\t'); // on to Tickets — its list read is now held
  await settle();
  await tui.renderOnce();
  expect(tui.frame()).toContain('Loading tickets…');

  tui.mockInput.pressKey('e');
  await settle();
  await tui.renderOnce();
  expect(plain(tui.frame())).not.toContain('Edit ticket');
  expect(h.rec.optionCollections).toEqual([]);

  h.releaseList();
  await settle();
  await tui.renderOnce();
  tui.mockInput.pressKey('q');
  await tui.running;
  await tui.stop();
});

it('AC-5: `e` typed into the SEARCH filter types, it does not open the popup', async () => {
  const h = harness();
  const { tui, press, quit } = await openList(h);
  await press('/');
  await press('e');
  const shown = plain(tui.frame());
  expect(shown).toContain('search: e');
  expect(shown).not.toContain('Edit ticket');
  expect(h.rec.optionCollections).toEqual([]);
  await press('\x1b'); // leave search mode
  await quit();
});

// ---- AC-4 -------------------------------------------------------------------

it('AC-4: the project frame advertises `e:Edit` before any key is pressed', async () => {
  const h = harness();
  const { tui, quit } = await openList(h);
  expect(plain(tui.frame())).toContain('e:Edit');
  await quit();
});

// ---- AC-7 -------------------------------------------------------------------

it('AC-7: a failing DETAIL read shows the server text and leaves the list usable', async () => {
  const forbidden = Object.assign(new Error('HTTP 403'), {
    status: 403,
    body: {
      errors: [
        {
          title: 'Forbidden',
          detail:
            'The current user is not allowed to GET the selected resource.',
        },
      ],
    },
  });
  const h = harness({ detailError: forbidden });
  const { tui, press, quit } = await openList(h);
  await press('e');

  const shown = plain(tui.frame());
  // No popup, the server's OWN words, never the useless `HttpError.message`…
  expect(shown).not.toContain('Edit ticket');
  expect(shown).toContain(
    'The current user is not allowed to GET the selected resource.',
  );
  expect(shown).not.toContain('HTTP 403');
  // …and the list is still rendered.
  expect(rowLine(tui, 'BB-252')).toContain('ZZ');
  // …and still navigable: ↓ moves the cursor to the other row.
  await press('\x1b[B');
  expect(selectedRowLine(tui)).toContain('BB-999');
  await quit();
});

it('AC-7: a failing OPTIONS read still opens the popup, with empty selects', async () => {
  const h = harness({ optionsError: new Error('no access to user') });
  const { tui, press, quit } = await openList(h);
  await press('e');
  const shown = plain(tui.frame());
  expect(shown).toContain('Edit ticket');
  // The prefilled ids have no label source, so the selects render empty rather
  // than the popup refusing to open.
  expect(shown).not.toContain('cw-framework (running)');
  await quit();
});

it('AC-7: a rejected WRITE keeps the popup and its input, and modifies no row', async () => {
  const h = harness({
    writeError: Object.assign(new Error('HTTP 422'), {
      status: 422,
      body: {
        errors: [
          { detail: 'conductor_id: the conductor is not in the project.' },
        ],
      },
    }),
  });
  const { tui, press, quit } = await openList(h);
  await press('e');
  await press('\x1b[C'); // cw → tm
  await press('\x13');

  const shown = plain(tui.frame());
  expect(shown).toContain('[ Save ]'); // still open…
  expect(shown).toContain('< tm >'); // …still holding the input…
  expect(shown).toContain('conductor_id: the conductor is not in the project.');
  expect(shown).not.toContain('HTTP 422');
  await press('\x1b'); // close it to read the list underneath
  expect(rowLine(tui, 'BB-252')).toContain('ZZ'); // unchanged
  await quit();
});

// ---- the in-flight latch (spec Decision 5) ----------------------------------

it('two `e` presses while the detail read is in flight yield ONE read and ONE popup', async () => {
  const h = harness({ gateDetail: true });
  const { tui, press, pressRaw, quit } = await openList(h);
  pressRaw('e');
  pressRaw('e');
  await settle();
  // Exactly one detail read is waiting — the second `e` was swallowed.
  expect(h.pendingDetailReads()).toBe(1);
  h.releaseDetail();
  await settle();
  await tui.renderOnce();
  expect(plain(tui.frame())).toContain('Edit ticket');
  // …and exactly one option load happened (two would be `user`+`bb_conductor`
  // twice over).
  expect(h.rec.optionCollections).toHaveLength(2);
  await press('\x1b');
  await quit();
});

it('settling an assignment read after leaving Tickets cannot open its popup', async () => {
  const h = harness({ gateDetail: true });
  const { tui, pressRaw, quit } = await openList(h);
  pressRaw('e');
  await settle();
  expect(h.pendingDetailReads()).toBe(1);

  // BB-326: the raw SGR report is gone — OpenTUI parses the mouse itself,
  // and `mockMouse.click` sends press AND release. Coordinates are 0-BASED.
  // BB-375 — tab bar is terminal row 6 (gap above tabs), so buffer y = 5.
  await tui.mockMouse.click(44, 5);
  await settle();
  h.releaseDetail();
  await settle();
  await tui.renderOnce();

  expect(plain(tui.frame())).not.toContain('Edit ticket');
  await quit();
});

it('a popup that is OPENING owns every key, so the list cannot move under it', async () => {
  const h = harness({ gateDetail: true });
  const { tui, press, pressRaw, quit } = await openList(h);
  pressRaw('e');
  pressRaw('\x1b[B'); // ↓ while the detail read is in flight
  await settle();
  h.releaseDetail();
  await settle();
  await tui.renderOnce();
  expect(plain(tui.frame())).toContain('Edit ticket');
  await press('\x1b'); // close the popup and look at the list underneath
  // The ↓ was swallowed: the cursor is still on the row the popup was opened
  // for, exactly as it would be under an already-open popup.
  expect(selectedRowLine(tui)).toContain('BB-252');
  await quit();
});

it('the latch is shared: two `e` presses on the DETAIL screen open one popup too', async () => {
  const h = harness();
  const { press, pressRaw, quit } = await openList(h);
  await press('\r'); // into the ticket detail screen
  pressRaw('e');
  pressRaw('e');
  await settle();
  expect(h.rec.optionCollections).toHaveLength(2);
  await press('\x1b');
  await quit();
});
