import { expect, it } from 'bun:test';
import type {
  RendererServices,
  ResolvedRoute,
  TuiOptions,
} from '../../src/types.js';
import {
  type FakeClientOptions,
  fakeClient,
} from '../../tests/test-support.js';
import { bootTui } from '../tui-harness.js';

// BB-326 (widget-fit F2) — the filter pickers' query row has a REAL TERMINAL
// CURSOR, driven end to end through the kernel.
//
// The Node tests prove the insertion point is declared with the right text and
// offset. They cannot prove it reaches the terminal: that is the mounted
// `FieldTextarea` calling `setCursorPosition`. `renderer.getCursorState()` is
// where that lands, and it is the same seam the edit form's `text` fields reach.
//
// Why this needed no new seam: both filter screens are MODAL, so the widget is a
// node inside the tree the modal box holds —
// exactly the path the two `text` fields already use. The handoff that
// commissioned the F2 conversion assumed these screens were non-modal and would
// need the slot generalised to the scrolling BODY region. They are not.

const PROJECT = 'pppppppp-0000-0000-0000-000000000001';
const TICKETS = 'bb_ticket/bb_ticket';

const ticket = (id: string, identifier: string, title: string) => ({
  type: 'bb_ticket--bb_ticket',
  id,
  attributes: { identifier, title, state: 'todo', workflow: 'bb_work' },
});

const clientOptions = (): FakeClientOptions => ({
  documents: {
    [TICKETS]: {
      data: [
        ticket('t1', 'BB-137', 'multiple conductors per repo'),
        ticket('t2', 'BB-236', 'a declared form kernel'),
      ],
    },
  },
});

const PROJECT_ROUTE: ResolvedRoute = {
  screen: 'project',
  projectId: PROJECT,
  projectName: 'bakers',
};

/** The debounce in IMMEDIATE mode — no assertion sleeps past a real timer. */
const immediate = (fn: () => void): (() => void) => {
  fn();
  return () => {};
};

async function boot(over: Partial<TuiOptions> = {}) {
  const services: RendererServices = {
    client: fakeClient(clientOptions()),
    baseUrl: 'https://x.test',
  };
  const tui = await bootTui({
    services,
    tui: {
      project: 'bakers',
      cwd: '/repo',
      route: PROJECT_ROUTE,
      debounce: immediate,
      ...over,
    },
  });
  const press = (key: string): Promise<void> => tui.press(key);
  /** The project boots on its Overview tab; the picker lives under Tickets. */
  const openPicker = async (): Promise<void> => {
    await press('\t');
    await press('p');
  };
  const quit = async (): Promise<void> => {
    await press('\x1b');
    tui.mockInput.pressKey('q');
    await tui.running;
    await tui.stop();
  };
  return { tui, press, openPicker, quit };
}

/** The screen row (0-based) the picker's query is drawn on. */
const queryRow = (rows: string[]): number =>
  rows.findIndex((row) => row.includes('search:'));

it('the parent picker puts a real terminal cursor at the end of the query', async () => {
  const d = await boot();
  await d.openPicker();
  const rows = d.tui.rows();
  expect(rows.join('\n')).toContain('⚡ Filter by parent');

  const at = queryRow(rows);
  expect(at).toBeGreaterThan(-1);
  // The glyph is GONE — the insertion point is not a character any more.
  expect(rows.join('\n')).not.toContain('▌');

  const cursor = d.tui.renderer.getCursorState();
  // VISIBLE is the whole point: the cockpit shows no cursor anywhere else, so
  // this is also the proof that the modal slot focused for this screen.
  expect(cursor.visible).toBe(true);
  // `getCursorState` is 1-based, `rows` is 0-based.
  expect(cursor.y).toBe(at + 1);
  // One past the last character of `search: ` — the cell the `▌` occupied.
  const row = rows[at] ?? '';
  expect(cursor.x).toBe(row.indexOf('search: ') + 'search: '.length + 1);

  await d.quit();
});

it('typing moves the cursor along the query, one column per character', async () => {
  const d = await boot();
  await d.openPicker();
  const before = d.tui.renderer.getCursorState();
  for (const ch of 'BB-2') await d.press(ch);

  const rows = d.tui.rows();
  const at = queryRow(rows);
  expect(rows[at]).toContain('search: BB-2');
  const cursor = d.tui.renderer.getCursorState();
  expect(cursor.visible).toBe(true);
  expect(cursor.y).toBe(at + 1);
  // Four characters typed, four columns moved — and the reducer, not the widget,
  // is what advanced it: `FieldTextarea` declines every key.
  expect(cursor.x).toBe(before.x + 4);

  await d.quit();
});

it('the slot does not double a keystroke on the query row EITHER', async () => {
  // `field-textarea-view-only.test.ts` pins this for the picker's insert and
  // backspace too. The reason for capturing unsettled is a measured near-miss:
  // on this control the doubling is INVISIBLE to the ordinary harness.
  //
  // Per keystroke the order is: global ladder → reducer → `draw()` → `place()`
  // resets the widget to the reducer's value → THEN the focused renderable's
  // handler runs and appends. So the widget ends one character ahead. On the
  // filter picker the keystroke ALSO kicks the debounced re-query, whose
  // `replaceReady` schedules one more draw — and `press()`'s 40 ms settle lets
  // that draw land, resetting the slot before the frame is captured. Measured
  // with the override deleted: `press()` reported a clean `search: BB-2`,
  // while the frame taken with NO settle read `search: BB-22`.
  //
  // That masking is timing, not safety: the extra draw is exactly what a slow
  // link delays, and a slow link is the whole reason this control has a cursor.
  // So this case captures the frame the instant the handlers have run.
  const d = await boot();
  await d.openPicker();
  for (const ch of 'BB-') await d.press(ch);

  d.tui.mockInput.pressKey('2');
  await d.tui.renderOnce();

  const rows = d.tui.rows();
  const at = queryRow(rows);
  const query = (rows[at] ?? '').replace(/│/g, '').trim();
  expect(query, 'four typed characters, four on the row').toBe('search: BB-2');

  await d.quit();
});

it('leaving the picker takes the cursor with it', async () => {
  // A cursor left blinking over the ticket list behind a closed picker is the
  // failure this catches.
  const d = await boot();
  await d.openPicker();
  expect(d.tui.renderer.getCursorState().visible).toBe(true);
  await d.press('\x1b');
  expect(d.tui.rows().join('\n')).not.toContain('⚡ Filter by parent');
  expect(d.tui.renderer.getCursorState().visible).toBe(false);

  d.tui.mockInput.pressKey('q');
  await d.tui.running;
  await d.tui.stop();
});
