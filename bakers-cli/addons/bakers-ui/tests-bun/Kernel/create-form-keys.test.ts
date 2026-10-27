import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createTextAttributes } from '@opentui/core';
// BB-664 AC-8: this harness boots with no project in scope throughout (a
// deliberate BB-664 F4 choice, see below), so the field the kernel actually
// stands on is `FIELDS_WITH_PROJECT`'s — one ahead of `FIELDS`' own, for the
// new Project picker.
import { FIELDS_WITH_PROJECT as FIELDS } from '../../src/Entity/ticket/Form/create.js';
import type {
  HostedAgent,
  RendererServices,
  TuiAgentService,
  TuiOptions,
} from '../../src/types.js';
import {
  type FakeClientOptions,
  fakeClient,
  toResource,
} from '../../tests/test-support.js';
import { bootTui } from '../tui-harness.js';

// BB-236 Phase 1 — a CHARACTERIZATION test for the New-ticket popup's key
// routing (spec Finding 4 / Risk R1). `handleFormKey` is a closure inside
// `runTicketTui` and has no test at all, yet Decision 5 moves it into
// `Form/keys.ts`. So it is pinned here FIRST, against today's behaviour, driven
// through the public entry point with a real renderer — modelled on
// `tests-bun/Kernel/edit-form.test.ts`.
//
// Every assertion below describes the PRE-refactor kernel. After the refactor it
// must pass unmodified; that, and nothing else, is the proof the key ladder
// moved without changing behaviour.
//
// BB-326 — EVERY FRAME ASSERTION IN THIS FILE WAS RE-READ, NOT TRANSLATED.
// The fake output accumulated every byte the kernel ever wrote and its
// `lastFrame` only re-sliced that transcript at the last clear-screen, so a
// `toContain` could still be answered by a row the popup had scrolled over.
// `tui.frame()` is the CURRENT SCREEN, out of the render buffer. Where an
// assertion asked "is this character anywhere in the frame" and MEANT "is this
// the value of the active field", it now reads that field's own value row.

const USER = 'aaaaaaaa-0000-0000-0000-000000000001';
const OTHER_USER = 'aaaaaaaa-0000-0000-0000-000000000002';
const THIRD_USER = 'aaaaaaaa-0000-0000-0000-000000000003';
const COND = 'bbbbbbbb-0000-0000-0000-000000000001';
const LABEL_A = 'cccccccc-0000-0000-0000-000000000001';
const LABEL_B = 'cccccccc-0000-0000-0000-000000000002';
const LABEL_BUNDLE = 'bb_term/label';

/** The inverse bit as the renderer stores it — the caret's only trace. */
const INVERSE = createTextAttributes({ inverse: true });

const rows = () => ({
  user: [
    toResource({
      id: USER,
      type: 'user--user',
      attributes: { display_name: 'cw', name: 'cw' },
    }),
    toResource({
      id: OTHER_USER,
      type: 'user--user',
      attributes: { display_name: 'tm', name: 'tm' },
    }),
    // A THIRD option on purpose: with only two, ← and → are indistinguishable,
    // so a swapped-direction regression would pass unnoticed.
    toResource({
      id: THIRD_USER,
      type: 'user--user',
      attributes: { display_name: 'zz', name: 'zz' },
    }),
  ],
  bb_conductor: [
    toResource({
      id: COND,
      type: 'bb_conductor--bb_conductor',
      attributes: { label: 'cw-framework' },
    }),
  ],
  // BB-257 F2/D3: the labels live in the `label` VOCABULARY, so the
  // fixture is keyed by the bundle the popup really requests. Keyed `bb_term`
  // it answered `bb_term/bb_term` — a bundle that 404s on the control plane
  // — which is exactly why the empty list went unnoticed by this suite (F2b).
  // FIXTURE DATA ONLY: no assertion in this file changes.
  [LABEL_BUNDLE]: [
    toResource({
      id: LABEL_A,
      type: 'bb_term--label',
      attributes: { name: 'bug' },
    }),
    toResource({
      id: LABEL_B,
      type: 'bb_term--label',
      attributes: { name: 'ui' },
    }),
  ],
  // BAKERS-17: the Type select's vocabulary. Two terms, so the clearable ring
  // (none, feature, bug) can tell ← from →.
  'bb_term/type': [
    toResource({
      id: 'type-feature',
      type: 'bb_term--type',
      attributes: { name: 'feature' },
    }),
    toResource({
      id: 'type-bug',
      type: 'bb_term--type',
      attributes: { name: 'bug' },
    }),
  ],
});

interface Recorded {
  group: string;
  cwd: string;
  prompt: string;
  env: Record<string, string | undefined>;
  label?: string | undefined;
}

/** An agent host that records what it was asked to launch. Without one injected
 *  `openCreateAgent` refuses to open the popup at all. */
function fakeAgents(): { launches: Recorded[]; host: TuiAgentService } {
  const launches: Recorded[] = [];
  const host: TuiAgentService = {
    launch: async (o): Promise<HostedAgent> => {
      launches.push(o as Recorded);
      return {
        id: `agent-${launches.length}`,
        group: o.group,
        label: o.label ?? '',
      };
    },
    list: async () => [],
    focus: async () => {},
    hide: async () => {},
    kill: async () => {},
  };
  return { launches, host };
}

// The frame with the overlay's box-drawing characters removed and its
// whitespace collapsed — so an assertion reads the TEXT and not where the box
// wrapped it. The `▸` active marker and the `›` label cursor are deliberately
// KEPT: they are the state this test is pinning.
//
// BB-326: the ANSI strip that used to lead this pipeline is gone with the
// fake output. The renderer paints cells, so the frame arrives as characters
// and an escape in it would be a defect rather than something to filter out.
const plain = (frame: string): string =>
  frame
    .replace(/[│╭╮╰╯─]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Boot the dashboard under a real renderer with an agent host, and return a
 *  driver. */
async function boot(
  over: Partial<TuiOptions> = {},
  // BB-257 AC-4: the second argument lets a case boot with a FAILING read, so
  // the popup's "could not be loaded" path is driven end to end rather than only
  // unit-tested on the renderer. Defaulted, so every existing case is unchanged.
  clientOptions: FakeClientOptions = { rows: rows() },
) {
  const client = fakeClient(clientOptions);
  const agents = fakeAgents();
  const services: RendererServices = {
    client,
    baseUrl: 'https://x.test',
  };
  const tui = await bootTui({
    services,
    tui: {
      agents: agents.host,
      project: 'bakers',
      cwd: '/repo',
      ...over,
    },
  });
  const press = (key: string): Promise<void> => tui.press(key);
  const frame = (): string => plain(tui.frame());
  /**
   * The value row of the field whose label row carries the active marker.
   *
   * A `text` widget draws `<label>:` and then the value on its own row, so this
   * is where a typed character actually IS. Reading it is what makes "the key
   * typed" an observation: over the whole frame a bare `toContain('q')` is
   * answered by any `q` on the dashboard behind the popup — and against the old
   * fake output, by any `q` the kernel had ever written.
   */
  const activeValueRow = (label: string): string => {
    const all = tui.rows();
    const at = all.findIndex((row) => row.includes(`▸ ${label}:`));
    expect(at).toBeGreaterThan(-1);
    return (all[at + 1] ?? '').replace(/[│\s]/g, '');
  };
  /** An OPEN popup owns every key, `q` included — so close it first. Esc is also
   *  the ONE key OpenTUI does not deliver synchronously (it is the prefix of
   *  every CSI sequence), which `press` waits out. */
  const quit = async (): Promise<void> => {
    await press('\x1b');
    tui.mockInput.pressKey('q');
    await tui.running;
    await tui.stop();
  };
  return { agents, client, tui, press, frame, activeValueRow, quit };
}

/** Open the popup (`n`) — every case below starts here. */
async function openForm(
  over: Partial<TuiOptions> = {},
  clientOptions?: FakeClientOptions,
) {
  const d = await boot(over, clientOptions ?? { rows: rows() });
  await d.press('n');
  return d;
}

/**
 * How many `↓` presses reach `id` from the first field.
 *
 * BB-257 inserted `parent` between the description and the assignee, which
 * shifts every literal count below it — the same hand-count hazard spec F5/D2
 * removed from the renderer. The cases below therefore NAME the field they
 * navigate to; not one of their assertions changes.
 */
const downTo = (id: string): number => FIELDS.findIndex((f) => f.id === id);

/** Press `↓` until `id` is the active field. */
const goTo = async (
  d: { press: (key: string) => Promise<void> },
  id: string,
): Promise<void> => {
  for (let i = 0; i < downTo(id); i++) await d.press('\x1b[B');
};

// ---- opening / closing / submitting -----------------------------------------

it('`n` opens the New-ticket popup, prefilled from the loaded options', async () => {
  const d = await openForm();
  const f = d.frame();
  expect(f).toContain('New ticket · bakers');
  // BB-664 AC-8: with no project in scope this harness boots without one,
  // the new Project field opens ACTIVE, ahead of Title.
  expect(f).toContain('▸ Project:');
  expect(f).toContain('Title:');
  expect(f).toContain('Description:');
  expect(f).toContain('<empty>');
  // Each select prefills to its FIRST option. Conductor is the one
  // exception (BB-664 F4): this harness boots with no resolved project
  // context, and a project-less conductor ring is empty by design — the
  // server rejects a conductor assignment on a projectless ticket the same
  // way it rejects a cross-project one.
  expect(f).toContain('Assignee: < cw >');
  expect(f).toContain('Conductor: < — none — >');
  expect(f).toContain('Workflow: < work >');
  // Both labels unchecked, and BOTH action rows are rendered (BB-309 D3).
  expect(f).toContain('[ ] bug');
  expect(f).toContain('[ ] ui');
  expect(f).toContain('[ Create with agent ]');
  expect(f).toContain('[ Create directly ]');
  await d.quit();
});

it('Esc closes the popup and launches nothing', async () => {
  const d = await openForm();
  await d.press('\x1b');
  expect(d.frame()).not.toContain('[ Create with agent ]');
  expect(d.agents.launches).toEqual([]);
  await d.quit();
});

it('Ctrl+S submits from any field and hands the payload to the agent host', async () => {
  const d = await openForm();
  // BB-664 AC-8 put Project above Title, and BB-309 D1 put Title above
  // Description — reaching the description costs two ↓ now, off a Project
  // field this case leaves UNPICKED so `tui.project` ('bakers') still decides
  // what the agent receives. Everything this case asserts about the
  // submission is unchanged.
  await d.press('\x1b[B');
  await d.press('\x1b[B');
  await d.press('B');
  await d.press('u');
  await d.press('g');
  await d.press('\x13'); // Ctrl+S

  expect(d.agents.launches).toHaveLength(1);
  const launch = d.agents.launches[0];
  expect(launch?.group).toBe('bakers');
  expect(launch?.cwd).toBe('/repo');
  expect(launch?.label).toBe('Bug');
  expect(launch?.env.BB_WORKFLOW).toBe('bb_work');
  const specPath = launch?.env.BB_NEW_TICKET_INPUT as string;
  expect(specPath).toMatch(/bakers-new-ticket-.*\.json$/);
  expect(JSON.parse(readFileSync(specPath, 'utf8'))).toEqual({
    project: 'bakers',
    is_new: true,
    // BB-309 D1: the spec gains the title the agent adopts. Untouched here,
    // so it travels empty and the launch label still falls back to the
    // description's first line.
    title: '',
    description: 'Bug',
    workflow: { id: 'bb_work', label: 'work' },
    assignee: { id: USER, label: 'cw' },
    reviewers: [],
    // BB-664 F4: no project context in this harness, no conductor candidate.
    conductor: null,
    // BAKERS-17: Type and Recipe open empty and stay empty untouched.
    ticketType: null,
    recipe: null,
    labels: [],
    // BB-257 AC-7: the Parent field is optional, and an untouched one adds
    // exactly this and changes nothing else about the submission.
    parent: null,
  });
  // The popup is gone — and now that means "off screen" rather than "not in the
  // transcript since the last clear".
  expect(d.frame()).not.toContain('[ Create with agent ]');
  await d.quit();
});

it('the popup owns every key — `q` neither quits nor types', async () => {
  const d = await openForm();
  await d.press('\x1b[B'); // BB-664 AC-8: off Project, onto Title.
  await d.press('q');
  expect(d.frame()).toContain('[ Create with agent ]');
  // `q` is >= ' ' and not an escape sequence, so on the TEXT field it types.
  // Read off the Title field's own value row: the old `toContain('q')` over the
  // whole frame could be answered by any `q` anywhere, the popup's own
  // `Esc cancel` hint row included.
  expect(d.activeValueRow('Title')).toBe('q');
  await d.quit();
});

// ---- field navigation --------------------------------------------------------

it('↓ and Tab move the active field forward, ↑ moves it back', async () => {
  const d = await openForm();
  // BB-664 AC-8 put Project first (no project in scope), BB-309 D1 put
  // Title next, so two ↓ reach the field this case starts from. Every
  // assertion below it is unchanged.
  await d.press('\x1b[B'); // ↓ off Project, onto Title
  await d.press('\x1b[B'); // ↓ off Title, onto Description
  await d.press('\x1b[B'); // ↓
  expect(d.frame()).toContain('▸ Parent:');
  await d.press('\t'); // Tab behaves exactly like ↓
  expect(d.frame()).toContain('▸ Assignee:');
  await d.press('\x1b[A'); // ↑
  expect(d.frame()).toContain('▸ Parent:');
  await d.press('\x1b[A');
  expect(d.frame()).toContain('▸ Description:');
  await d.quit();
});

it('field movement clamps at both ends of the list', async () => {
  const d = await openForm();
  // BB-664 AC-8: Project is the real first field with no project in scope.
  await d.press('\x1b[A'); // ↑ on the first field: no move
  expect(d.frame()).toContain('▸ Project:');
  for (let i = 0; i < 14; i++) await d.press('\x1b[B'); // ↓ past the end
  expect(d.frame()).toContain('▸ [ Create directly ]');
  await d.quit();
});

// ---- the text field ---------------------------------------------------------

it('printable keys type into the description, \\x7f backspaces, \\r newlines', async () => {
  const d = await openForm();
  await d.press('\x1b[B'); // BB-664 AC-8: off Project, onto Title.
  await d.press('H');
  await d.press('i');
  await d.press('!');
  expect(d.activeValueRow('Title')).toBe('Hi!');
  await d.press('\x7f'); // backspace
  expect(d.activeValueRow('Title')).toBe('Hi');
  await d.press('\r'); // newline
  await d.press('x');
  // The text widget draws one row per logical line, so a second POPUP row
  // appeared beneath the first.
  //
  // BB-326: this used to be measured by splitting the transcript on the
  // cursor-positioning escape, because the popup was written with absolute
  // positioning and carried no '\n' at all — and before that, by splitting on
  // '\n', which put the whole popup on ONE line and passed only because the
  // `https://x.test` in a since-removed meta row matched `x`. The renderer
  // paints a GRID, so the rows are simply rows; anchored on the active field's
  // label row, which is what "a second row of THIS field" means.
  const all = d.tui.rows();
  const titleRow = all.findIndex((row) => row.includes('▸ Title:'));
  expect(titleRow).toBeGreaterThan(-1);
  const cell = (offset: number): string =>
    (all[titleRow + offset] ?? '').replace(/[│\s]/g, '');
  expect(cell(1)).toBe('Hi');
  expect(cell(2)).toBe('x');
  await d.quit();
});

it('an escape sequence on the text field is ignored, not typed', async () => {
  const d = await openForm();
  await d.press('\x1b[B'); // BB-664 AC-8: off Project, onto Title.
  await d.press('A');
  await d.press('\x1b[3~'); // Del — an escape sequence: swallowed
  await d.press('\x1b[C'); // → on a TEXT field: also swallowed
  // The value is still the single character that was typed — read off the
  // field's own row, because `toContain('A')` over the frame was answered by
  // any capital A anywhere and would have held even if the sequence HAD been
  // inserted.
  expect(d.activeValueRow('Title')).toBe('A');
  const f = d.frame();
  expect(f).toContain('▸ Title:'); // no field movement either
  expect(f).not.toContain('[3~');
  await d.quit();
});

it('the text caret is a real TERMINAL cursor, on exactly the cell it sits on', async () => {
  // BB-326 — WHAT THIS EXPECTATION USED TO SAY, AND WHY IT CHANGED.
  //
  // It read: "the text caret inverts exactly the cell it sits on", and asserted
  // exactly one span with the inverse attribute on the active field's value row
  // — `Widget/text.ts` used to splice `\x1b[7m<char>\x1b[27m` into the row.
  //
  // The operator DECIDED to drop that: they drive the cockpit over mosh from a
  // phone, and mosh's local predictive echo — the thing that makes a typed
  // character appear before the network round trip — only works when the
  // terminal has a real cursor to predict at. An inverse cell is a repaint mosh
  // cannot predict, so every keystroke cost a full round trip.
  //
  // So the caret moved from the CHARACTER FRAME to the TERMINAL CURSOR, and the
  // assertion moves with it: `getCursorState()` is where the caret now exists at
  // all, exactly as `captureSpans()` was before. Same claim — one cell, the
  // right one — read at the layer that now holds it.
  //
  // IT ALSO FIXES A FALSE CLAIM the old version carried in a comment: "← is
  // swallowed by a text field, so the caret stays at the END of the value".
  // `Form/keys.ts` maps ← on a `text` field to `{ kind: 'cursor', dir: -1 }`
  // (BB-283) — it moves the insertion point, and always has. The old
  // assertion could not tell: "exactly one inverted cell" is true wherever the
  // caret is. This one names the cell, so the three presses are now a real
  // observation of the movement rather than filler.
  const d = await openForm();
  await d.press('\x1b[B'); // BB-664 AC-8: off Project, onto Title.
  for (const ch of 'abcdef') await d.press(ch);
  await d.press('\x1b[D'); // ← moves the insertion point one character left,
  await d.press('\x1b[D'); // three times: from after 'f' to between 'c' and
  await d.press('\x1b[D'); // 'd', i.e. offset 3.

  const rows = d.tui.rows();
  const at = rows.findIndex((row) => row.includes('▸ Title:'));
  expect(at).toBeGreaterThan(-1);
  const cursor = d.tui.renderer.getCursorState();
  // VISIBLE — the whole point of the change. The cockpit shows no cursor
  // anywhere else, so this is also the proof that focusing the slot is what
  // turned it on.
  expect(cursor.visible).toBe(true);
  // The value row is the one below the active label row; `getCursorState` is
  // 1-based and `rows` is 0-based, so the value row `at + 1` is cursor row
  // `at + 2`.
  expect(cursor.y).toBe(at + 2);
  // Offset 3 of `abcdef` — the cell holding 'd'. `rows` is 0-based and
  // `getCursorState().x` is 1-based, so the cell at value column 3 is screen
  // column `indexOf + 3 + 1`.
  const valueRow = rows[at + 1] ?? '';
  expect(valueRow.indexOf('abcdef')).toBeGreaterThan(-1);
  expect(valueRow[valueRow.indexOf('abcdef') + 3]).toBe('d');
  expect(cursor.x).toBe(valueRow.indexOf('abcdef') + 3 + 1);
  // Not vacuous: the value really is on that row and really is six characters.
  expect(d.activeValueRow('Title')).toBe('abcdef');
  // ...and the row itself no longer carries an inverse cell: the caret is not a
  // character any more, so nothing in the frame draws it.
  const spans = d.tui.captureSpans().lines[at + 1]?.spans ?? [];
  expect(
    spans.filter((span) => (span.attributes & INVERSE) !== 0),
  ).toHaveLength(0);
  await d.quit();
});

it('the cursor follows the insertion point INSIDE a wrapped value', async () => {
  // The second blocker the decision doc recorded against `TextareaRenderable`
  // was that it "publishes no source-offset mapping, which is what makes the
  // caret land on the right cell of a WRAPPED line". This is that case, driven:
  // a title longer than the popup's 54-column body, with the insertion point
  // moved back onto the FIRST row while the value occupies two.
  const d = await openForm();
  await d.press('\x1b[B'); // BB-664 AC-8: off Project, onto Title.
  const long =
    'a title long enough to wrap inside the New ticket popup and then some';
  for (const ch of long) await d.press(ch);
  // Hand-derived at the 54-column budget: the break falls before `popup`, so
  // row 0 is `a title long enough to wrap inside the New ticket` (49 columns)
  // and row 1 is `popup and then some` (19). From the end of the value, 19 ←
  // reach the START of row 1 and the twentieth reaches the END of row 0 — the
  // space the break ate. So twenty presses, and the cursor must jump a row UP.
  const back = 'popup and then some'.length + 1;
  for (let i = 0; i < back; i++) await d.press('\x1b[D');

  const rows = d.tui.rows();
  const at = rows.findIndex((row) => row.includes('▸ Title:'));
  const first = rows[at + 1] ?? '';
  expect(first).toContain('the New ticket');
  expect(rows[at + 2] ?? '').toContain('popup and then some');
  const cursor = d.tui.renderer.getCursorState();
  expect(cursor.visible).toBe(true);
  // The FIRST wrapped row, not the second — this is the whole assertion.
  expect(cursor.y).toBe(at + 2);
  // Column 49 of a 49-character row: one past its last character, which is the
  // cell the eaten space would have occupied.
  const ROW0 = 'a title long enough to wrap inside the New ticket';
  expect(first).toContain(ROW0);
  expect(cursor.x).toBe(first.indexOf(ROW0) + ROW0.length + 1);
  await d.quit();
});

it('the cursor moves with the FOREGROUND_ACTIVE FIELD, and goes away when no text field is', async () => {
  const d = await openForm();
  await d.press('\x1b[B'); // BB-664 AC-8: off Project, onto Title.
  for (const ch of 'abc') await d.press(ch);
  const titleRow = d.tui.renderer.getCursorState().y;

  // ↓ to Description, type — the cursor must be on the OTHER field's value now.
  await d.press('\x1b[B');
  for (const ch of 'zz') await d.press(ch);
  const descRow = d.tui.renderer.getCursorState().y;
  expect(d.tui.renderer.getCursorState().visible).toBe(true);
  expect(descRow).toBeGreaterThan(titleRow);

  // ↓ to Parent — an autocomplete. This popup boots with NO project, so the
  // candidate bag is ABSENT and the field draws `(no project context …)` with no
  // query row at all: there is nothing to type into, so the cursor must be
  // switched OFF rather than left hovering over a value nobody is editing.
  //
  // BB-326 (widget-fit F2) changed the OTHER half of that sentence and this
  // case is now the negative half of a pair: an autocomplete WITH a bag does get
  // a terminal cursor on its query row, which used to be a `▌` character —
  // `create-form-parent.test.ts` › *the Parent query row carries a terminal
  // cursor* is the positive half. Keeping both is what stops "no cursor here"
  // being read as "autocompletes have no cursor".
  await d.press('\x1b[B');
  expect(d.frame()).toContain('no project context');
  expect(d.tui.renderer.getCursorState().visible).toBe(false);

  // ...and back up to Description turns it on again, on the same row as before.
  await d.press('\x1b[A');
  expect(d.tui.renderer.getCursorState().visible).toBe(true);
  expect(d.tui.renderer.getCursorState().y).toBe(descRow);
  await d.quit();
});

it('an EMPTY active field keeps its `<empty>` row AND gets the cursor', async () => {
  // The field still has to occupy a row or the popup stops lining up, and it is
  // also exactly where an operator starts typing — so the cursor belongs here
  // even though there is no character under it.
  const d = await openForm();
  await d.press('\x1b[B'); // BB-664 AC-8: off Project, onto Title.
  const rows = d.tui.rows();
  const at = rows.findIndex((row) => row.includes('▸ Title:'));
  expect(rows[at + 1] ?? '').toContain('<empty>');
  const cursor = d.tui.renderer.getCursorState();
  expect(cursor.visible).toBe(true);
  expect(cursor.y).toBe(at + 2);
  await d.quit();
});

it('leaving the popup takes the cursor with it', async () => {
  // A cursor left visible over the dashboard would be a blinking block on a
  // screen with no text field at all — and `Esc` is the popup's own exit.
  const d = await openForm();
  for (const ch of 'abc') await d.press(ch);
  expect(d.tui.renderer.getCursorState().visible).toBe(true);
  await d.press('\x1b');
  expect(d.frame()).not.toContain('[ Create with agent ]');
  expect(d.tui.renderer.getCursorState().visible).toBe(false);
  await d.quit();
});

it('a control character below space is ignored on the text field', async () => {
  const d = await openForm();
  await d.press('\x1b[B'); // BB-664 AC-8: off Project, onto Title.
  await d.press('A');
  await d.press('\x01'); // Ctrl+A
  expect(d.frame()).toContain('▸ Title:');
  expect(d.agents.launches).toEqual([]);
  await d.quit();
});

// ---- selects ----------------------------------------------------------------

it('→ and ← cycle the active select and wrap, never reaching a cleared value', async () => {
  const d = await openForm();
  await goTo(d, 'assignee');
  await d.press('\x1b[C'); // →
  expect(d.frame()).toContain('Assignee: < tm >');
  await d.press('\x1b[C'); // → forward again
  expect(d.frame()).toContain('Assignee: < zz >');
  await d.press('\x1b[C'); // → wraps back to the first option
  expect(d.frame()).toContain('Assignee: < cw >');
  await d.press('\x1b[D'); // ← wraps to the LAST option
  expect(d.frame()).toContain('Assignee: < zz >');
  await d.press('\x1b[D'); // ← backwards
  expect(d.frame()).toContain('Assignee: < tm >');
  // An EMPTY select (BB-664 F4: no project context, no candidates) stays on
  // "none" in both directions — there is nothing to cycle to.
  await d.press('\x1b[B'); // reviewers
  await d.press('\x1b[B'); // to the conductor
  await d.press('\x1b[C');
  await d.press('\x1b[D');
  expect(d.frame()).toContain('Conductor: < — none — >');
  await d.quit();
});

it('cycling touches only the active select', async () => {
  // BAKERS-17: one workflow is left, so the three-position ring is the Type
  // select's clearable one: none, feature, bug.
  const d = await openForm();
  await goTo(d, 'ticketType');
  await d.press('\x1b[C');
  const f = d.frame();
  expect(f).toContain('Type: < feature >');
  expect(f).toContain('Assignee: < cw >');
  // ← back past none wraps to the LAST of the three.
  await d.press('\x1b[D');
  await d.press('\x1b[D');
  expect(d.frame()).toContain('Type: < bug >');
  await d.quit();
});

it('Enter on a select advances to the next field', async () => {
  const d = await openForm();
  await goTo(d, 'assignee');
  await d.press('\r');
  expect(d.frame()).toContain('▸ Reviewers:');
  await d.quit();
});

it('Space and other keys are inert on a select', async () => {
  const d = await openForm();
  await goTo(d, 'assignee');
  await d.press(' ');
  await d.press('z');
  const f = d.frame();
  expect(f).toContain('▸ Assignee:');
  expect(f).toContain('Assignee: < cw >');
  await d.quit();
});

// ---- the multiselect --------------------------------------------------------

it('→ / ← move the label cursor and clamp at both ends', async () => {
  const d = await openForm();
  await goTo(d, 'labels');
  expect(d.frame()).toContain('▸ Labels:');
  // The cursor starts on the first label.
  expect(d.frame()).toContain('›[ ] bug');
  await d.press('\x1b[C');
  expect(d.frame()).toContain('›[ ] ui');
  await d.press('\x1b[C'); // clamped at the last label
  expect(d.frame()).toContain('›[ ] ui');
  await d.press('\x1b[D');
  expect(d.frame()).toContain('›[ ] bug');
  await d.press('\x1b[D'); // clamped at the first label
  expect(d.frame()).toContain('›[ ] bug');
  await d.quit();
});

it('Space toggles the label under the cursor on and off', async () => {
  const d = await openForm();
  await goTo(d, 'labels');
  await d.press(' ');
  expect(d.frame()).toContain('›[x] bug');
  await d.press('\x1b[C');
  await d.press(' ');
  expect(d.frame()).toContain('›[x] ui');
  expect(d.frame()).toContain('[x] bug');
  await d.press(' '); // untoggle
  expect(d.frame()).toContain('›[ ] ui');
  await d.quit();
});

it('the toggled labels reach the submitted payload', async () => {
  const d = await openForm();
  await goTo(d, 'labels');
  await d.press(' '); // check `bug`
  await d.press('\x13');
  const specPath = d.agents.launches[0]?.env.BB_NEW_TICKET_INPUT as string;
  const payload = JSON.parse(readFileSync(specPath, 'utf8')) as {
    labels: { id: string; label: string }[];
  };
  expect(payload.labels).toEqual([{ id: LABEL_A, label: 'bug' }]);
  await d.quit();
});

it('Enter on the multiselect advances to the next field', async () => {
  const d = await openForm();
  await goTo(d, 'labels');
  await d.press('\r');
  expect(d.frame()).toContain('▸ Workflow:');
  await d.quit();
});

// ---- the action row ---------------------------------------------------------

it('Enter on the action row submits', async () => {
  const d = await openForm();
  await goTo(d, 'submit');
  expect(d.frame()).toContain('▸ [ Create with agent ]');
  await d.press('\r');
  expect(d.agents.launches).toHaveLength(1);
  expect(d.frame()).not.toContain('[ Create with agent ]');
  await d.quit();
});

it('a non-Enter key on the action row does nothing', async () => {
  const d = await openForm();
  await goTo(d, 'submit');
  await d.press(' ');
  await d.press('\x1b[C');
  expect(d.agents.launches).toEqual([]);
  expect(d.frame()).toContain('▸ [ Create with agent ]');
  await d.quit();
});

// ---- BB-326 Task 8: the key ladder outranks the widgets --------------------
//
// The one property a widget conversion must not cost, pinned before any
// conversion is attempted.
//
// `defaultTextareaKeyBindings` binds ↑/↓ inside the edit buffer and
// `SelectRenderable.handleKeyPress` binds them to its OWN cursor, while this
// form's contract binds them to FIELD TRAVERSAL
// (the BB-322 screen contract's key ladder, "Global, on every field"). The seam that decides which of the two wins is
// `InternalKeyHandler.emitWithPriority`: global listeners run before focused
// renderable ones and a `preventDefault()` in a global one stops every
// renderable handler seeing the key (measured against @opentui/core@0.5.1). So
// the ladder stays the authority and a widget is configured UNDER it — never
// the other way round.
//
// Stated as an observation rather than as a claim about the wiring: walking
// down the form must move the cursor and touch NOTHING else. The three selects
// are the sensitive part, because a widget that claimed ↓ would advance the
// value under the traversal and the operator would submit a ticket assigned to
// whoever happened to be N options down.
//
// It is not a vacuous guard. It was watched failing first, against a deliberate
// mutation of `Form/keys.ts` that gave ↓ to a select's own value cycle, which
// is exactly the shape of the defect a focused SelectRenderable would produce.
// The recorded failure, verbatim:
//
//     error: expect(received).toContain(expected)
//     Expected to contain: "▸ Labels:"
//     Received: "… ▸ Assignee: < zz > Conductor: < cw-framework > …"
//
// Read what that says: the traversal never left the Assignee row AND the value
// under it had advanced twice. One claimed key costs both the navigation and
// the data.
//
it('eight ↓ traverse the form and leave every select on its original value', async () => {
  const d = await openForm();
  await d.press('\x1b[B'); // BB-664 AC-8: off Project, onto Title.
  // The values the popup opens on — each select prefills to its first option.
  const opened = d.frame();
  expect(opened).toContain('▸ Title:');
  expect(opened).toContain('Assignee: < cw >');
  expect(opened).toContain('Conductor: < — none — >');
  expect(opened).toContain('Workflow: < work >');

  // Eight ↓ from Title: Description, Parent, Assignee, Reviewers, Conductor,
  // Type, Recipe (BAKERS-17), Labels. Presses land ON selects and pass over the reviewers multi, so a
  // widget claiming the key would be caught whether it claims on arrival or
  // on departure.
  for (let i = 0; i < 8; i++) await d.press('\x1b[B');

  const after = d.frame();
  // The traversal happened…
  expect(after).toContain('▸ Labels:');
  // …and cost nothing. Every select still reports what it was opened with.
  expect(after).toContain('Assignee: < cw >');
  expect(after).toContain('Conductor: < — none — >');
  expect(after).toContain('Type: < — none — >');
  expect(after).toContain('Workflow: < work >');
  // The multiselect's toggles are the same state under another kind: a widget
  // that claimed ↓ for its option cursor would move `›` without being asked.
  expect(after).toContain('›[ ] bug');
  expect(after).toContain('[ ] ui');

  // And the values that reach the payload are the opened ones, not the drawn
  // ones — the frame and the submission cannot disagree about this.
  await d.press('\x13'); // Ctrl+S
  const specPath = d.agents.launches[0]?.env.BB_NEW_TICKET_INPUT as string;
  const payload = JSON.parse(readFileSync(specPath, 'utf8')) as {
    assignee: { id: string; label: string };
    conductor: { id: string; label: string } | null;
    workflow: { id: string; label: string };
    labels: unknown[];
  };
  expect(payload.assignee).toEqual({ id: USER, label: 'cw' });
  // BB-664 F4: no project context in this harness, no conductor candidate.
  expect(payload.conductor).toBeNull();
  expect(payload.workflow).toEqual({ id: 'bb_work', label: 'work' });
  expect(payload.labels).toEqual([]);
  await d.quit();
});

// ---- the "no agent host" guard ----------------------------------------------

it('with no agent host injected `n` opens nothing and says so', async () => {
  const d = await boot({ agents: undefined });
  await d.press('n');
  expect(d.frame()).toContain('create agent unavailable');
  expect(d.frame()).not.toContain('[ Create with agent ]');
  await d.quit();
});

// ---- BB-257 AC-3 / AC-4, end to end through the real renderer --------------
//
// APPENDED ONLY: this file is one of the three AC-8 contract files, so nothing
// above changes. The scenarios the ticket is about, driven the way a writer
// drives them — there is no browser here, so this harness IS the validator the
// spec substitutes for Playwright-BDD (D10/D13).

it('S3 (AC-3): the project`s label terms are listed and togglable', async () => {
  const d = await openForm();
  // The read that renders this list addressed the vocabulary, not the entity
  // type alone — the whole defect in one assertion (F2).
  expect(d.client.collections).toContain('bb_term/label');
  expect(d.client.collections).not.toContain('bb_term/bb_term');

  await goTo(d, 'labels');
  expect(d.frame()).toContain('▸ Labels:');
  // One row per term, and no claim that the vocabulary is empty.
  expect(d.frame()).toContain('[ ] bug');
  expect(d.frame()).toContain('[ ] ui');
  expect(d.frame()).not.toContain('(none available)');

  await d.press(' '); // toggle the term under the cursor ON
  expect(d.frame()).toContain('›[x] bug');
  await d.press(' '); // …and OFF again
  expect(d.frame()).toContain('›[ ] bug');

  // Toggle two, drop one, and submit: only the still-selected terms travel.
  await d.press(' '); // bug on
  await d.press('\x1b[C');
  await d.press(' '); // ui on
  await d.press(' '); // ui off again
  await d.press('\x13'); // Ctrl+S
  const specPath = d.agents.launches[0]?.env.BB_NEW_TICKET_INPUT as string;
  const payload = JSON.parse(readFileSync(specPath, 'utf8')) as {
    labels: { id: string; label: string }[];
  };
  expect(payload.labels).toEqual([{ id: LABEL_A, label: 'bug' }]);
  await d.quit();
});

it('S4 (AC-4): a genuine label load failure is STATED, not shown as empty', async () => {
  const d = await openForm(
    {},
    { rows: rows(), failingCollections: [LABEL_BUNDLE] },
  );
  await goTo(d, 'labels');
  const f = d.frame();
  expect(f).toContain('▸ Labels:');
  expect(f).toContain('Labels could not be loaded');
  expect(f).toContain(`no ${LABEL_BUNDLE}`); // …with the reason
  expect(f).not.toContain('(none available)');
  // A failed OPTION read must not cost the writer the popup (D4's rejected
  // alternative): the form is open and every other field still works.
  expect(f).toContain('[ Create with agent ]');
  expect(f).toContain('Assignee: < cw >');
  await d.quit();
});
