import { describe, expect, it } from 'bun:test';
import type { Renderable } from '@opentui/core';
import type {
  Collection,
  DropshClient,
  RendererServices,
  ResolvedRoute,
} from '../../src/types.js';
import { includedProjects } from '../fixtures/included-projects.js';
import { type BootedTui, bootTui, settle } from '../tui-harness.js';

// BB-326 Step A — THE ROW POOL.
//
// The kernel used to `destroy()` every row renderable and build a fresh set on
// EVERY frame — ~38 objects per draw, each carrying a Zig-side `TextBuffer` and
// `TextBufferView`. That is the one thing in the swap with a plausible claim on
// the A6 regression (542.8 -> 705.7 ms cold start, 94.7 -> 114.9 MB peak RSS),
// because the SGR round-trip the plan blamed measured 13 us per frame.
//
// The contract this file pins is deliberately about OBJECT IDENTITY, not about
// pixels: what a screen looks like is already asserted by the other thirteen
// files here, by `render-geometry.test.ts` in particular, and by the five pty
// drivers. Identity is the part no existing test can see, and it is the part
// that decides whether the renderer re-allocates.
//
// Read `rowsOf` before adding a case: with a pool, `getChildren()` returns the
// WHOLE pool — the painted rows and the parked surplus. `paintedRowsOf` is the
// visible prefix, which is what corresponds to `composeFrame`'s output.

const PROJECT = 'aaaaaaaa-0000-0000-0000-000000000001';

const conductorDoc = {
  data: [
    {
      id: 'c1',
      type: 'bb_conductor--bb_conductor',
      attributes: { status: 'running', last_seen: '2026-08-10T09:00:00+00:00' },
      relationships: { project_id: { data: { id: PROJECT } } },
    },
  ],
  included: [
    {
      id: PROJECT,
      type: 'bb_project--bb_project',
      attributes: { name: 'a project' },
    },
  ],
};

// Long enough that the body fills every terminal height these cases use, so the
// frame's length really is a function of the terminal and the assertions below
// are about the pool rather than about how much content happens to exist.
const ticketListDoc = {
  data: Array.from({ length: 80 }, (_, index) => ({
    id: `ticket-${index}`,
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: `BB-${200 + index}`,
      title: `ticket number ${index}`,
      state: 'coding',
      derived_status: 'running',
    },
    relationships: { labels: { data: [] } },
  })),
};

// WHAT MAKES THE POOL GROW AND SHRINK NOW, and why the cases below stopped
// resizing the terminal.
//
// They used to ride on the kernel's virtual window, which exists only for a
// screen that is still BRIDGED: `frameTrees` slices such a body to the visible
// rows and the two spacers stand for the rest, so its painted row count is a
// function of the TERMINAL. Each conversion took the cases off another screen —
// Task 7 off the ticket list, Task 8 off the ticket detail, and they landed on
// the project picker as the last bridged screen that is not a modal. Task 9
// Step 4 converts the picker, and with it the last such screen: every remaining
// bridged body is a modal (which the kernel never windows, `scrollSize =
// bodyRows`) or a loading/error state three rows tall. A terminal that can no
// longer change a painted row count has no claim left to make.
//
// The MECHANISM the cases are about outlives its old subject. `patchTree` is
// what the row pool became: it grows a standing tree by the nodes the next one
// adds and PARKS the ones it drops rather than destroying them (see
// `Kernel/mount.ts`).
//
// WHERE THAT PARKING STOPS, since spec F2 was implemented: at a NAVIGATION. The
// kernel retires the screen-owned regions when the router's visit count moves, so
// a body you have left is destroyed rather than parked — the growth F2 forbids,
// and the reason the second case below asserts the opposite of what it used to.
// Parking is now what happens WITHIN one screen: a page, a filter, a collapsed
// section. Both directions still bite: a kernel that destroyed on every draw
// would fail the redraw case, and one that never destroyed would fail the
// navigation case.

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
      if (path === 'bb_ticket/bb_ticket') return ticketListDoc;
      return { data: [] };
    },
    update: async () => ({}),
  };
  return { client, baseUrl: 'https://bakers.example' };
}

const PROJECT_ROUTE: ResolvedRoute = {
  screen: 'project',
  projectId: PROJECT,
  projectName: 'a project',
};

/**
 * Boot on the project's TICKETS tab — the 80-row table, so every terminal
 * height below is filled and the frame's length is a function of the terminal
 * rather than of how much content happens to exist. The deep link lands on the
 * project Dashboard, so one Tab moves to the table.
 */
const bootOnTickets = async (
  columns: number,
  rows: number,
): Promise<BootedTui> => {
  const tui = await bootTui({
    services: fakeServices(),
    columns,
    rows,
    tui: { route: PROJECT_ROUTE },
  });
  await tui.press('\t');
  return tui;
};

/** Every renderable at the bottom of a region's subtree, in painting order. */
const leavesOf = (node: Renderable): Renderable[] => {
  const children = node.getChildren();
  return children.length === 0 ? [node] : children.flatMap(leavesOf);
};

/**
 * Every row, painted and parked alike, across every region pane.
 *
 * Step B moved the rows one level down, under one container per frame region
 * (`region-chrome` / `region-body` / `region-footer` / `region-modal`).
 * BB-340 moved the BODY's rows one level down again: the region's lines are a
 * mounted VNode tree now, and the body's tree hangs inside the ScrollBox as
 * `region-body-window` — between the two virtualisation spacers, which is why
 * it cannot simply BE the box. So this descends to the leaves rather than
 * counting a fixed depth: the retained set is what the case is about, and it is
 * the same set at either depth. The spacers are leaves too and are still
 * counted, exactly as they were when they were the body pane's own children.
 */
const rowsOf = (tui: BootedTui): Renderable[] => {
  const shell = tui.renderer.root.getRenderable('shell');
  if (!shell) throw new Error('the kernel drew no shell');
  return shell
    .getChildren()
    .flatMap((pane) => pane.getChildren())
    .flatMap(leavesOf);
};

/** Only the rows the frame is currently painted into. */
const paintedRowsOf = (tui: BootedTui): Renderable[] =>
  rowsOf(tui).filter((row) => row.visible);

/**
 * How many of `after`'s first `before.length` entries are the SAME OBJECT as
 * the corresponding entry of `before`.
 *
 * Counted rather than asserted position by position on purpose: a failing
 * `expect(row).toBe(other)` makes Bun pretty-print both operands, and a
 * `Renderable` is an object graph hanging off FFI pointers into the Zig core —
 * serialising two of them aborts the runtime (SIGABRT, no output at all), so
 * the very first red run tells you nothing. A number is safe to print.
 */
const reusedCount = (
  before: readonly Renderable[],
  after: readonly Renderable[],
): number =>
  before.reduce(
    (total, row, index) => total + (after[index] === row ? 1 : 0),
    0,
  );

/**
 * How many of `before` are still somewhere in `after`.
 *
 * The positional form above is the right question only when the frame keeps
 * its length. When the BODY grows, every row is still the same object but the
 * footer's row moves down the flattened list, so position stops being the
 * measure of reuse and membership starts being it.
 */
const survivorCount = (
  before: readonly Renderable[],
  after: readonly Renderable[],
): number => {
  const live = new Set(after);
  return before.filter((row) => live.has(row)).length;
};

const resize = async (
  tui: BootedTui,
  columns: number,
  rows: number,
): Promise<void> => {
  tui.resize(columns, rows);
  await settle();
  await tui.renderOnce();
};

const quit = async (tui: BootedTui): Promise<void> => {
  tui.mockInput.pressKey('q');
  await tui.running;
  await tui.stop();
};

describe('BB-326 Step A — the kernel retains its row renderables', () => {
  it('paints the next frame into the SAME renderables', async () => {
    const tui = await bootOnTickets(120, 40);
    const before = [...paintedRowsOf(tui)];
    expect(before.length).toBeGreaterThan(10);

    await tui.press('j');

    const after = paintedRowsOf(tui);
    expect(after.length).toBe(before.length);
    expect(
      reusedCount(before, after),
      'every painted row is the same object it was before the redraw',
    ).toBe(before.length);
    expect(
      before.filter((row) => row.isDestroyed).length,
      'no row was destroyed to draw the next frame',
    ).toBe(0);
    await quit(tui);
  });

  /**
   * RETARGETED, BB-340 spec F2 — and the claim it used to make is now the
   * defect, not the contract.
   *
   * It asserted that leaving the ticket list for the Dashboard and coming back
   * PAINTED THE SAME ROW OBJECTS: `survivorCount(list, tall) === list.length`,
   * with none of them destroyed in between. That is only true of a kernel that
   * parks a departed screen's subtree forever, which is exactly what F2 forbids
   * ("`leave()` must destroy the screen's subtree, or a session accumulates the
   * trees of every screen ever visited") and what the 2026-08-13 review found
   * unimplemented. Reuse across a NAVIGATION was never Step A's subject: the row
   * pool exists so that a REDRAW does not re-allocate, which the case above pins,
   * and so that a RESIZE does not, which the case below pins on a screen that is
   * mounted whole. Nothing is lost by inverting this one; the growth claim it also
   * carried is kept.
   */
  it('frees the rows of a screen it left, and paints new ones on the way back', async () => {
    // The long body first, so there really are rows to free.
    const tui = await bootOnTickets(120, 44);
    const list = [...paintedRowsOf(tui)];
    expect(list.length, 'the ticket list is the long body').toBeGreaterThan(20);

    // The screen's own rows, told apart from the chrome's by the ids the kernel
    // gives its own composition. F2 is about the SCREEN's subtree: the header
    // box's rows, the tab bar and the footer are the kernel's, their ids are a
    // bounded set, and they are deliberately kept across a navigation. Footer
    // ActionItem chips use screen ids (`tickets-new-key`) rather than a
    // `footer-` prefix — exclude those key/sfx chips too.
    const bodyRows = list.filter(
      (row) =>
        !/^(chrome|footer|region)-/.test(row.id) && !/-(key|sfx)$/.test(row.id),
    );
    expect(
      bodyRows.length,
      'most of that body is the list itself',
    ).toBeGreaterThan(20);

    await tui.press('\x1b[Z'); // Shift+Tab: back to the project Dashboard
    const short = [...paintedRowsOf(tui)];
    expect(
      bodyRows.filter((row) => row.isDestroyed).length,
      "the departed list's own rows are destroyed, not parked",
    ).toBe(bodyRows.length);

    await tui.press('\t'); // …and forward onto the list again
    const tall = paintedRowsOf(tui);
    expect(tall.length, 'a longer body paints more rows').toBeGreaterThan(
      short.length,
    );
    expect(
      survivorCount(bodyRows, tall),
      'and every row of it is a new one, never a revived corpse',
    ).toBe(0);
    await quit(tui);
  });

  /**
   * BB-340 Task 7 — the same claim for a screen that is MOUNTED WHOLE.
   *
   * A converted screen has no window, so its painted row count is a function of
   * its data and not of the terminal. What must still hold is the case above's
   * real subject: a resize repaints into the renderables that are already
   * standing and destroys none of them.
   */
  it('rebuilds nothing on a resize of a screen that is mounted whole', async () => {
    const tui = await bootOnTickets(120, 20);
    const short = [...paintedRowsOf(tui)];

    await resize(tui, 120, 44);

    const tall = paintedRowsOf(tui);
    expect(
      tall.length,
      'the converted body paints its own rows whatever the height',
    ).toBe(short.length);
    expect(
      survivorCount(short, tall),
      'and every one of them is the same object',
    ).toBe(short.length);
    expect(
      short.filter((row) => row.isDestroyed).length,
      'nothing was destroyed to draw the taller frame',
    ).toBe(0);

    // And the guarantee mounting a body WHOLE has to keep: 80 rows inside a
    // 20-row terminal are clipped by the body's ScrollBox, not painted past the
    // bottom. The footer is the proof — it is the frame's last row.
    await resize(tui, 120, 20);
    const rendered = tui.rows();
    const last = rendered.findLastIndex((row) => row !== '');
    expect(last, 'the frame ends inside the terminal').toBeLessThan(20);
    expect(rendered[last], 'and its last row is the status footer').toContain(
      'q:quit',
    );
    await quit(tui);
  });

  it('parks the surplus when the body gets shorter — nothing stale is painted', async () => {
    const tui = await bootOnTickets(120, 44);
    const tall = paintedRowsOf(tui).length;

    await tui.press('\x1b[Z'); // Shift+Tab: the 80-row list gives way to the Dashboard

    const painted = paintedRowsOf(tui);
    expect(painted.length, 'fewer rows are painted').toBeLessThan(tall);
    // The screen is the proof, and it is a stronger one than a row count: a pool
    // that only ever grew would leave the 80-row list's tail standing under the
    // Dashboard, so the identifiers themselves must be gone.
    const rendered = tui.rows();
    expect(
      rendered.join('\n'),
      'no row of the body that just left is still on screen',
    ).not.toContain('BB-2');
    const last = rendered.findLastIndex((row) => row !== '');
    expect(last, 'the frame ends inside the terminal').toBeLessThan(44);
    expect(
      rendered[last],
      'and the last painted row is the status footer',
    ).toContain('q:quit');
    await quit(tui);
  });

  it('does not leak renderables across repeated resizes', async () => {
    const tui = await bootOnTickets(120, 44);
    const ceiling = rowsOf(tui).length;

    for (let round = 0; round < 4; round += 1) {
      await resize(tui, 120, 18);
      await resize(tui, 120, 44);
    }

    expect(
      rowsOf(tui).length,
      'the pool is bounded by the tallest frame ever painted',
    ).toBe(ceiling);
    await quit(tui);
  });
});
