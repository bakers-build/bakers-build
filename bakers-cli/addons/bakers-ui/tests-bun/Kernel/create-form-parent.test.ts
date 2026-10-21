import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { FIELDS } from '../../src/Entity/ticket/Form/create.js';
import type {
  HostedAgent,
  RendererServices,
  ResolvedRoute,
  TuiAgentService,
  TuiOptions,
} from '../../src/types.js';
import {
  type FakeClientOptions,
  fakeClient,
} from '../../tests/test-support.js';
import { bootTui } from '../tui-harness.js';

// BB-257 AC-5 / AC-6 / AC-7 / AC-8, end to end through the FAKE TTY.
//
// A sibling of `create-form-keys.test.ts` rather than more of it: that file is
// one of the three AC-8 contract files (spec D11) and is already 600 lines. The
// substitution the spec makes explicit (D10/D13) applies here — `bakers ui` is a
// terminal UI, so there is no browser for Playwright-BDD to drive and THIS
// harness is the validator. Every case below is one of the abstract scenarios,
// driven the way a writer drives it.

const PROJECT = 'pppppppp-0000-0000-0000-000000000001';
const TICKETS = 'bb_ticket/bb_ticket';

const T_PARENT = 'tttttttt-0000-0000-0000-000000000001';
const T_KERNEL = 'tttttttt-0000-0000-0000-000000000002';
const T_POPUP = 'tttttttt-0000-0000-0000-000000000003';

const ticket = (id: string, identifier: string, title: string) => ({
  type: 'bb_ticket--bb_ticket',
  id,
  attributes: { identifier, title, state: 'todo', workflow: 'bb_feature' },
});

/**
 * The project's tickets. `BB-2` matches exactly TWO of the three, so a list
 * that narrowed and a list that did not are distinguishable; `popup` matches
 * exactly one, and only by its TITLE — which is the other half of AC-5.
 */
const TICKET_ROWS = [
  ticket(T_PARENT, 'BB-137', 'multiple conductors per repo'),
  ticket(T_KERNEL, 'BB-236', 'a declared form kernel'),
  ticket(T_POPUP, 'BB-257', 'the New-ticket popup'),
];

const clientOptions = (): FakeClientOptions => ({
  documents: { [TICKETS]: { data: TICKET_ROWS } },
});

const PROJECT_ROUTE: ResolvedRoute = {
  screen: 'project',
  projectId: PROJECT,
  projectName: 'bakers',
};

interface Recorded {
  group: string;
  cwd: string;
  prompt: string;
  env: Record<string, string | undefined>;
  label?: string | undefined;
}

function fakeAgents(): { launches: Recorded[]; host: TuiAgentService } {
  const launches: Recorded[] = [];
  const host: TuiAgentService = {
    launch: async (o): Promise<HostedAgent> => {
      launches.push(o as Recorded);
      return { id: `agent-${launches.length}`, group: o.group, label: '' };
    },
    list: async () => [],
    focus: async () => {},
    hide: async () => {},
    kill: async () => {},
  };
  return { launches, host };
}

/**
 * The frame as TEXT: box-drawing gone, whitespace collapsed. The `▸` active
 * marker and the `›` suggestion cursor are kept — they are the state.
 *
 * BB-326: the ANSI strip that used to lead this pipeline is gone with the
 * fake output. The renderer paints cells, so the frame arrives as characters
 * and an escape in it would be a defect rather than something to filter out.
 */
const plain = (frame: string): string =>
  frame
    .replace(/[│╭╮╰╯─]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * R2 — the debounce, run in IMMEDIATE mode.
 *
 * The scheduler is injected precisely so no assertion has to sleep past a real
 * timer: a test that waits 200ms for a re-query is a test that fails on a busy
 * machine. Running the callback synchronously also makes "the re-query happened"
 * observable in the very next frame.
 */
const immediate = (fn: () => void): (() => void) => {
  fn();
  return () => {};
};

async function boot(over: Partial<TuiOptions> = {}) {
  const client = fakeClient(clientOptions());
  const agents = fakeAgents();
  const services: RendererServices = { client, baseUrl: 'https://x.test' };
  const tui = await bootTui({
    services,
    tui: {
      agents: agents.host,
      project: 'bakers',
      cwd: '/repo',
      route: PROJECT_ROUTE,
      debounce: immediate,
      ...over,
    },
  });
  const press = (key: string): Promise<void> => tui.press(key);
  const type = async (text: string): Promise<void> => {
    for (const char of text) await press(char);
  };
  const frame = (): string => plain(tui.frame());
  /**
   * Only the POPUP's text.
   *
   * The overlay is drawn on top of the project screen — which lists the very
   * same tickets in its table — so a bare `not.toContain('BB-137')` over the
   * whole frame would be answered by the BACKGROUND and prove nothing about the
   * suggestion list. Sliced at the popup's own title row.
   */
  const popup = (): string => {
    const text = frame();
    const at = text.indexOf('⚡ New ticket ·');
    return at < 0 ? '' : text.slice(at);
  };
  const quit = async (): Promise<void> => {
    // Esc is the ONE key OpenTUI does not deliver synchronously — it is the
    // prefix of every CSI sequence, so the parser holds it for a disambiguation
    // window. `press` waits that window out; asserting straight after it would
    // read the frame before the popup closed.
    await press('\x1b');
    tui.mockInput.pressKey('q');
    await tui.running;
    await tui.stop();
  };
  return { agents, client, tui, press, type, frame, popup, quit };
}

/** Open the popup on a project screen and move to the Parent field. */
async function openAtParent(over: Partial<TuiOptions> = {}) {
  const d = await boot(over);
  await d.press('n');
  for (let i = 0; i < FIELDS.findIndex((f) => f.id === 'parent'); i++) {
    await d.press('\x1b[B');
  }
  return d;
}

/** The JSON the popup wrote for the create agent. */
const writtenSpec = (launches: Recorded[]): Record<string, unknown> => {
  const path = launches[0]?.env.BB_NEW_TICKET_INPUT as string;
  expect(path).toMatch(/bakers-new-ticket-.*\.json$/);
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
};

// ---- S5 (AC-5): the parent is found by typing --------------------------------

it('BB-326 F2: the Parent query row carries a terminal cursor, not a `▌`', async () => {
  // The COLLATERAL of converting widget-fit F2: the filter pickers' query row
  // and this one are the same `autocomplete` KIND, so giving one a terminal
  // cursor gives both. Deliberate — a kind with two presentations of its own
  // insertion point would be the incoherent outcome — and recorded here so the
  // create popup's half is guarded rather than merely implied.
  //
  // The negative half of the pair is `create-form-keys.test.ts` › *the cursor
  // moves with the FOREGROUND_ACTIVE FIELD*, where the bag is ABSENT and there is no query
  // row to put a cursor on.
  const d = await openAtParent();
  const rows = d.tui.rows();
  const at = rows.findIndex((row) => row.includes('search:'));
  expect(at).toBeGreaterThan(-1);
  expect(d.frame()).not.toContain('▌');

  const cursor = d.tui.renderer.getCursorState();
  expect(cursor.visible).toBe(true);
  expect(cursor.y).toBe(at + 1);
  // One past `search: ` — the cell the `▌` used to occupy.
  const row = rows[at] ?? '';
  expect(cursor.x).toBe(row.indexOf('search: ') + 'search: '.length + 1);
  await d.quit();
});

it('S5: typing an identifier fragment narrows the suggestions', async () => {
  const d = await openAtParent();
  expect(d.popup()).toContain('▸ Parent:');
  // Before a character is typed the whole preloaded page is offered, so ←/→
  // already works (D7).
  expect(d.popup()).toContain('BB-137 · multiple conductors per repo');

  await d.type('BB-2');
  const f = d.popup();
  expect(f).toContain('BB-236 · a declared form kernel');
  expect(f).toContain('BB-257 · the New-ticket popup');
  expect(f).not.toContain('BB-137');
  await d.quit();
});

it('S5: clearing and typing a TITLE fragment narrows on the title', async () => {
  const d = await openAtParent();
  await d.type('BB-2');
  for (let i = 0; i < 6; i++) await d.press('\x7f'); // backspace it away
  expect(d.popup()).toContain('BB-137 · multiple conductors per repo');

  await d.type('popup');
  const f = d.popup();
  // Matched on the TITLE alone — no identifier contains "popup".
  expect(f).toContain('BB-257 · the New-ticket popup');
  expect(f).not.toContain('BB-236');
  expect(f).not.toContain('BB-137');
  await d.quit();
});

it('S5: the typed query is re-queried against the server, project-scoped', async () => {
  // The local filter is applied over whatever bag is present, but the bag is
  // also refreshed — otherwise a match beyond the preloaded page is unreachable.
  const d = await openAtParent();
  const before = d.client.requests.length;
  await d.type('popup');
  const sent = d.client.requests.slice(before);
  expect(sent.length).toBeGreaterThan(0);
  const built = sent[sent.length - 1]?.params as
    | { getQueryString(): string }
    | undefined;
  expect(built).toBeDefined();
  const last = decodeURIComponent(built?.getQueryString() ?? '');
  expect(last).toContain('filter[search]=popup');
  expect(last).toContain(PROJECT);
  await d.quit();
});

it('R2: the re-query is DEBOUNCED — 150ms, and a keystroke supersedes the last', async () => {
  // A recording scheduler that never fires: it makes the debounce CONTRACT
  // observable (the delay, and that each keystroke cancels the pending call)
  // without a single timer running. A queue instead of a debounce would send
  // one request per character typed — five for `popup`, on every keystroke of
  // every parent search.
  const scheduled: number[] = [];
  let cancels = 0;
  const d = await openAtParent({
    debounce: (_fn, ms) => {
      scheduled.push(ms);
      return () => {
        cancels += 1;
      };
    },
  });
  const before = d.client.requests.length;
  await d.type('popup');
  expect(scheduled).toEqual([150, 150, 150, 150, 150]);
  // Four of the five superseded a pending call; the fifth is still pending.
  expect(cancels).toBe(4);
  // …and because nothing fired, nothing was sent.
  expect(d.client.requests.length).toBe(before);
  // The list still narrowed, on the LOCAL filter alone (D7) — which is what
  // keeps the suggestions honest in the window before a response lands.
  expect(d.popup()).toContain('BB-257 · the New-ticket popup');
  expect(d.popup()).not.toContain('BB-236');
  await d.quit();
});

it('S5: a query matching nothing offers nothing, and says nothing false', async () => {
  const d = await openAtParent();
  await d.type('zzzz');
  const f = d.popup();
  expect(f).not.toContain('BB-137');
  expect(f).not.toContain('BB-236');
  expect(f).not.toContain('BB-257 ·');
  await d.quit();
});

// ---- S6 (AC-6): picking places the new ticket under it -----------------------

it('S6: → then Enter picks a suggestion, and Ctrl+S carries it to the spec', async () => {
  const d = await openAtParent();
  await d.type('BB-2');
  await d.press('\x1b[C'); // → onto the second match
  expect(d.popup()).toContain('›BB-257 · the New-ticket popup');
  await d.press('\r'); // Enter PICKS — it does not advance the field
  expect(d.popup()).toContain('▸ Parent:');
  expect(d.popup()).toContain('Parent: BB-257 · the New-ticket popup');

  await d.press('\x13'); // Ctrl+S
  expect(d.agents.launches).toHaveLength(1);
  expect(writtenSpec(d.agents.launches).parent).toEqual({
    id: T_POPUP,
    identifier: 'BB-257',
    title: 'the New-ticket popup',
  });
  await d.quit();
});

it('S6: backspacing after a pick clears it again (D6)', async () => {
  const d = await openAtParent();
  await d.type('BB-2');
  await d.press('\r'); // pick the first match
  expect(d.popup()).toContain('Parent: BB-236 · a declared form kernel');
  await d.press('\x7f');
  expect(d.popup()).toContain('Parent: —');
  await d.press('\x13');
  expect(writtenSpec(d.agents.launches).parent).toBeNull();
  await d.quit();
});

// ---- S7 (AC-7): the parent is optional ---------------------------------------

it('S7: submitting without touching Parent yields `parent: null`', async () => {
  const d = await boot();
  await d.press('n');
  // BB-309 D1 put Title above the description; one ↓ reaches the field this
  // case types into. Nothing it asserts changes.
  await d.press('\x1b[B');
  await d.type('A new ticket');
  await d.press('\x13');
  const spec = writtenSpec(d.agents.launches);
  expect(spec.parent).toBeNull();
  // …and nothing else about the submission differs from before this change.
  expect(spec).toEqual({
    project: 'bakers',
    is_new: true,
    title: '',
    description: 'A new ticket',
    workflow: { id: 'bb_feature', label: 'feature' },
    assignee: null,
    reviewers: [],
    conductor: null,
    labels: [],
    parent: null,
  });
  await d.quit();
});

it('D8: from the DASHBOARD there is no project, and the field says so', async () => {
  // `n` is global. Without a project in scope nothing can be offered — and the
  // field being optional is what makes that harmless.
  const d = await boot({ route: undefined });
  await d.press('n');
  for (let i = 0; i < FIELDS.findIndex((f) => f.id === 'parent'); i++) {
    await d.press('\x1b[B');
  }
  const f = d.popup();
  expect(f).toContain('(no project context — open a project to pick a parent)');
  expect(f).not.toContain('BB-137');
  // Typing is inert, and submitting still works.
  await d.type('BB-2');
  expect(d.popup()).not.toContain('BB-236 ·');
  await d.press('\x13');
  expect(writtenSpec(d.agents.launches).parent).toBeNull();
  await d.quit();
});

// ---- S8 (AC-8): every field stays reachable ----------------------------------

/** The rows of the popup that carry the active marker, in frame order. */
const markedRows = (popupText: string): string[] =>
  popupText
    .split('▸ ')
    .slice(1)
    .map((chunk) => chunk.split(' · ')[0] ?? '');

it('S8: ↓ steps through every field in turn, marking exactly one', async () => {
  const d = await boot();
  await d.press('n');
  // The order the writer walks, top to bottom — including the row BB-257
  // inserted, which is the whole risk AC-8 guards (a new field that shifts the
  // marker off the field it names).
  const expected = [
    // BB-309: Title opens the popup (D1) and a second action row closes it
    // (D3). The risk this case guards is exactly the one those two changes
    // create — a new field that shifts the marker off the field it names.
    'Title:',
    'Description:',
    'Parent:',
    'Assignee:',
    'Reviewers:',
    'Conductor:',
    'Labels:',
    'Workflow:',
    'Template:',
    '[ Create with agent ]',
    '[ Create directly ]',
  ];
  expect(expected).toHaveLength(FIELDS.length);
  for (const label of expected) {
    const marked = markedRows(d.popup());
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain(label);
    await d.press('\x1b[B');
  }
  // Past the end it clamps on the LAST action row rather than wrapping or
  // escaping.
  expect(markedRows(d.popup())[0]).toContain('[ Create directly ]');
  await d.quit();
});

it('S8: Tab walks the same order as ↓, the new field included', async () => {
  const d = await boot();
  await d.press('n');
  for (const label of [
    'Title:',
    'Description:',
    'Parent:',
    'Assignee:',
    'Reviewers:',
    'Conductor:',
    'Labels:',
    'Workflow:',
    'Template:',
    '[ Create with agent ]',
    '[ Create directly ]',
  ]) {
    expect(d.popup()).toContain(`▸ ${label}`);
    await d.press('\t');
  }
  await d.quit();
});

it('D6: the key hint row names `Enter pick` while Parent is active', async () => {
  const d = await boot();
  await d.press('n');
  expect(d.frame()).not.toContain('Enter pick');
  // Named, not counted: BB-309 D1 inserted Title above the description.
  for (let i = 0; i < FIELDS.findIndex((f) => f.id === 'parent'); i++) {
    await d.press('\x1b[B'); // to Parent
  }
  expect(d.frame()).toContain('Enter pick');
  await d.press('\x1b[B'); // on to Assignee
  expect(d.frame()).not.toContain('Enter pick');
  await d.quit();
});
