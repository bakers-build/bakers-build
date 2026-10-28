import { describe, expect, it } from 'bun:test';
import type { Renderable } from '@opentui/core';
import { footerRowsFor } from '../../src/Kernel/chrome.js';

/** Tickets publish footer actions → one row taller than the minimum footer. */
const TICKETS_FOOTER = footerRowsFor({
  actions: [
    { id: 'tickets-new', key: 'n', label: 'new' },
    { id: 'tickets-edit', key: 'e', label: 'edit' },
  ],
});

import type {
  Collection,
  DropshClient,
  RendererServices,
  ResolvedRoute,
} from '../../src/types.js';
import { chromeRowCount, chromeShape } from '../../tests/chrome-rows.js';
import { includedProjects } from '../fixtures/included-projects.js';
import { type BootedTui, bootTui, settle } from '../tui-harness.js';

// BB-326 Step C — THE BODY IS A SCROLLING VIEWPORT, AND THE FOOTER IS PINNED.
//
// What the operator asked for: "wäre gut wenn der platz zwischen header und
// footer scrollbar wäre" — the space between the header and the footer should
// scroll, with the footer at the bottom of the terminal.
//
// Before this step the frame was a FIXED BLOCK of rows: the kernel's `height()`
// was `terminalRows() - 8`, a magic constant that happens to equal a six-row
// chrome plus a one-row footer plus one, and every region was `flexShrink: 0`
// with nothing growing. So a short body left the footer floating directly under
// the last content row, and the whole frame ended one row above the terminal's
// bottom.
//
// Now `region-body` is a `ScrollBoxRenderable` with `flexGrow: 1`. It owns the
// viewport (Yoga measures it), it owns `scrollTop` (the clamp is the scrollbar's,
// not the kernel's), and the content it scrolls is VIRTUAL: two spacers around a
// window-sized row pool, sized so the box's `scrollHeight` is the screen's whole
// line count. That last part is not a refinement, it is the only workable shape —
// `@opentui/core@0.5.1` hands out 16 382 native renderables and then THROWS, so
// one `TextRenderable` per body line would take the cockpit down on a long run
// log rather than scroll it.
//
// The three things pinned here are the three the operator will see: the footer on
// the last row, the body filling everything between, and the cursor staying in
// view while a long list is walked.

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

/** Eighty tickets: more than any terminal this file boots can show at once. */
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
    get: async (path: string, params?: unknown) => {
      if (path.startsWith('bb_conductor/')) return conductorDoc;
      if (path === 'bb_ticket/bb_ticket') {
        // Honour `page[offset]` so ← / → are DATA paging here and not just two
        // keys that redraw the same rows: page two must be visibly different
        // rows, or the paging guard below would pass on a broken kernel.
        const query = String(
          (
            params as { getQueryString?: () => string } | undefined
          )?.getQueryString?.() ?? '',
        );
        const offset = Number(
          /page(?:\[|%5B)offset(?:\]|%5D)=(\d+)/.exec(query)?.[1] ?? 0,
        );
        const data = ticketListDoc.data.slice(offset, offset + LIST_PAGE);
        return {
          data,
          meta: { count: ticketListDoc.data.length },
          // `hasNext` is read off `links.next` (`Entity/collection.ts`), and
          // `ListScreen.goToPage` refuses to move forward without it — so a
          // fake that omits the link cannot page at all.
          links:
            offset + data.length < ticketListDoc.data.length
              ? { next: { href: 'next' } }
              : {},
        };
      }
      return { data: [] };
    },
    update: async () => ({}),
  };
  return { client, baseUrl: 'https://bakers.example' };
}

/** `LIST_PAGE_SIZE` in `src/Entity/cycle.ts` — the rows one page carries. */
const LIST_PAGE = 20;

const PROJECT_ROUTE: ResolvedRoute = {
  screen: 'project',
  projectId: PROJECT,
  projectName: 'a project',
};

/**
 * The project Tickets screen's chrome: a two-row header box and a top-tab bar.
 *
 * BB-340 Task 11 — counted off the COMPOSED TREE (`chromeRowCount`) since
 * `lib/hit-test.ts`'s `chromeRows` was deleted with the click mapping that
 * needed it (spec D6). Same number, read from the composition that draws it.
 */
const TICKETS_CHROME = chromeRowCount(chromeShape(2, true));

const regionOf = (tui: BootedTui, id: string): Renderable => {
  const shell = tui.renderer.root.getRenderable('shell');
  if (!shell) throw new Error('the kernel drew no shell');
  const region = shell.getRenderable(id);
  if (!region) throw new Error(`the kernel drew no ${id}`);
  return region;
};

const quit = async (tui: BootedTui): Promise<void> => {
  tui.mockInput.pressKey('q');
  await tui.running;
  await tui.stop();
};

/** Boot straight onto the project's ticket list. */
const bootTickets = async (rows: number): Promise<BootedTui> => {
  const tui = await bootTui({
    services: fakeServices(),
    columns: 120,
    rows,
    tui: { route: PROJECT_ROUTE },
  });
  await tui.press('\t');
  return tui;
};

describe('BB-326 Step C — the footer is pinned to the terminal', () => {
  // The magic 8 made the frame `rows - 1` lines tall, so the footer was always
  // one row above the bottom and the row below it was blank. A frame that is
  // laid out rather than placed has no reason to leave that row: the body grows
  // into whatever is left and the footer follows it.
  it.each([
    24, 30, 40, 60,
  ])('puts the status row in the padded footer of a %i-row terminal', async (rows) => {
    const tui = await bootTickets(rows);
    // `captureCharFrame()` ends its grid with a newline, so splitting it
    // yields one empty entry past the last physical row. FOOTER_ROWS = 2:
    // spacer / status — status sits on the last physical row.
    const screen = tui.rows();
    expect(screen.at(-1), 'nothing follows the grid but the split').toBe('');

    expect(
      screen[rows - 1],
      'the status row carries the footer keys',
    ).toContain('q:quit');
    expect(
      screen.filter((row) => row.includes('q:quit')).length,
      'and it is there exactly once',
    ).toBe(1);
    await quit(tui);
  });

  it.each([
    24, 40, 60,
  ])('grows the body over everything between the chrome and the footer at %i rows', async (rows) => {
    const tui = await bootTickets(rows);

    const body = regionOf(tui, 'region-body');
    const footer = regionOf(tui, 'region-footer');

    expect(body.screenY, 'the body starts where the chrome ends').toBe(
      TICKETS_CHROME,
    );
    // BB-375 — tickets publish actions → spacer + actions + basics + spacer.
    expect(
      footer.screenY,
      'the footer region starts above the padded status',
    ).toBe(rows - TICKETS_FOOTER);
    expect(footer.height, 'footer occupies actions + basics + spacers').toBe(
      TICKETS_FOOTER,
    );
    expect(
      body.screenY + body.height,
      'and the body fills every row in between',
    ).toBe(footer.screenY);
    await quit(tui);
  });
});

describe('BB-326 Step C — the ScrollBox owns the scroll position', () => {
  // Driven by the WHEEL, deliberately. On a list screen the arrow keys are the
  // screen's own cursor and never reach the kernel's fallback scroll, so a key
  // would be testing the ticket list rather than the box; the wheel is claimed
  // by nobody and goes straight to the ScrollBox.
  it(
    'moves its own scrollTop when the viewport is scrolled, and clamps it',
    async () => {
      const tui = await bootTickets(24);

      const body = regionOf(tui, 'region-body') as unknown as {
        scrollTop: number;
        scrollHeight: number;
      };
      expect(body.scrollTop, 'a fresh screen starts at the top').toBe(0);
      // One page of tickets plus the table heading — taller than the window the
      // chrome and the footer leave, which is what makes the box scrollable at
      // all. The box knows the WHOLE screen, not just what is painted.
      expect(
        body.scrollHeight,
        'the box knows the whole screen, not just the window',
      ).toBeGreaterThanOrEqual(LIST_PAGE + 1);
      // BB-375 — rounded filter chips (+6, two chip rows since BB-416's
      // `o owner` trigger fills the first row at 120 columns and wraps `c clear`
      // onto its own); frame is region-body (not content). Count/page are chrome
      // header meta, not a body strip.
      expect(body.scrollHeight, 'includes filter chips above the table').toBe(
        LIST_PAGE + 1 + 6,
      );
      expect(body.scrollHeight, 'and it overflows the window').toBeGreaterThan(
        24 - TICKETS_CHROME - TICKETS_FOOTER,
      );

      await tui.mockMouse.scroll(10, 10, 'down');
      await settle();
      await tui.renderOnce();
      expect(
        body.scrollTop,
        'the wheel scrolls the box itself',
      ).toBeGreaterThan(0);

      // Far past the end — a notch moves one row, so this is comfortably more
      // than the eighty-odd the screen has. The clamp is the scrollbar's, and the
      // kernel no longer carries one of its own.
      for (let i = 0; i < 150; i += 1)
        await tui.mockMouse.scroll(10, 10, 'down');
      await settle();
      await tui.renderOnce();
      // BB-375 — viewportSize is body rows minus the ScrollBox frame border.
      const bodyRows = 24 - TICKETS_CHROME - TICKETS_FOOTER;
      expect(
        body.scrollTop,
        'the last line of the screen is the furthest it goes',
      ).toBe(body.scrollHeight - (bodyRows - 2));

      await quit(tui);
    },
    { timeout: 20_000 },
  ); // ~3s on amd64, >5s on the arm64 runner (runner2)
});

describe('BB-326 Step C — the cursor stays in view', () => {
  it('scrolls a long list so the selected ticket is on screen', async () => {
    // 24 rows: a seventeen-row body window over eighty tickets.
    const tui = await bootTickets(24);
    expect(tui.frame(), 'the list starts at the top').toContain('BB-200');

    // Walk the cursor well past the bottom of the seventeen-row window.
    for (let i = 0; i < 18; i += 1) tui.mockInput.pressKey('\x1b[B');
    await settle();
    await tui.renderOnce();

    expect(tui.frame(), 'the row the cursor is on is on screen').toContain(
      'BB-218',
    );
    expect(
      tui.frame(),
      'and the top of the list has scrolled away',
    ).not.toContain('BB-200 ');

    await quit(tui);
  });

  // The counterpart, and the reason the follow is driven by the selection
  // MOVING rather than applied on every draw: a wheel notch triggers its own
  // repaint, so "always keep the cursor in view" would undo the scroll in the
  // very frame it caused and the wheel would be dead on every list screen.
  it('lets the wheel scroll away from the cursor, and follows it back on the next step', async () => {
    const tui = await bootTickets(24);
    const body = regionOf(tui, 'region-body') as unknown as {
      scrollTop: number;
    };

    // Move the cursor once, so a selection exists and is in view.
    await tui.press('\x1b[B');
    expect(body.scrollTop, 'the first step needs no scrolling').toBe(0);

    // Scroll the viewport away from the cursor with the wheel.
    await tui.mockMouse.scroll(10, 10, 'down');
    await settle();
    await tui.renderOnce();
    expect(
      body.scrollTop,
      'the wheel moved the viewport and the repaint left it there',
    ).toBeGreaterThan(0);

    // Moving the cursor again brings the window back to it. `scrollTo` puts a
    // selection that sits ABOVE the window on the window's first row, so the
    // landing position is the highlight's own row — here the ticket table's
    // first data row, one below its `IDENTIFIER …` heading.
    await tui.press('\x1b[A');
    expect(body.scrollTop, 'the window opens on the cursor').toBe(1);
    expect(tui.frame(), 'and the row it is on is on screen').toContain(
      'BB-200',
    );

    await quit(tui);
  });
});

// BB-326 Step C — PAGING IS NOT SCROLLING, AND THE BOX MUST NOT CONFUSE THEM.
//
// `ListScreen.handlePagingInput` claims ← and → to walk the COLLECTION: each one
// is a fresh control-plane read of a different twenty rows, and it has nothing to
// do with where the viewport sits. The risk this step introduces is specific and
// real: a `ScrollBoxRenderable` has a horizontal axis and a `handleKeyPress` that
// claims `left`/`right`/`h`/`l` on it. Turning `scrollX` on, or letting the
// renderer's `autoFocus` give the box focus on a click, would route those keys
// into the scrollbar and the ticket list would stop paging — silently, because
// the rows on screen would still look like rows.
describe('BB-326 Step C — ← / → still page the data', () => {
  it('walks the collection and leaves the scroll position alone', async () => {
    // Tall enough that filter + framed table chrome is on screen (BB-375).
    const tui = await bootTickets(48);
    const body = regionOf(tui, 'region-body') as unknown as {
      scrollTop: number;
    };

    expect(tui.frame(), 'page one').toContain('page 1');
    expect(tui.frame()).toContain('BB-200');
    expect(tui.frame(), 'page one stops at the page size').not.toContain(
      'BB-220',
    );

    await tui.press('\x1b[C');
    expect(tui.frame(), '→ is a new page, not a scroll').toContain('page 2');
    expect(tui.frame()).toContain('BB-220');
    expect(
      tui.frame(),
      'the first page is gone, not scrolled past',
    ).not.toContain('BB-200 ');
    expect(body.scrollTop, 'and the viewport did not move').toBe(0);

    await tui.press('\x1b[D');
    expect(tui.frame(), '← walks back').toContain('page 1');
    expect(tui.frame()).toContain('BB-200');
    expect(body.scrollTop).toBe(0);

    await quit(tui);
  });

  // AND THE SAME KEY MUST NOT BE ACTED ON TWICE.
  //
  // A click routes through the renderer's `autoFocus`, which walks up from the
  // hit renderable and focuses the first focusable ancestor — the body box, if
  // it is left focusable (measured: `focused=true`, `rendererFocus=region-body`).
  // A focused renderable subscribes its own keypress handler, and
  // `ScrollBarRenderable.handleKeyPress` claims `up`/`down`/`j`/`k` and scrolls a
  // FIFTH OF A VIEWPORT per press, which beside the kernel's own routing would
  // make one ↓ move the cursor by a row and the viewport by three.
  //
  // HONEST SCOPE: this case pins the OUTCOME — a click scrolls nothing and a ↓
  // inside the window scrolls nothing — and not the mechanism. Flipping
  // `bodyBox.focusable` back to `true` does NOT fail it: the box takes focus,
  // but no scroll follows in `@opentui/core@0.5.1`, so the double-scroll is
  // latent rather than live. The kernel keeps `focusable = false` because a
  // kernel that routes every key itself should not hand a second claim on those
  // keys to a widget; this case is what would notice if the latent path ever
  // woke up.
  it('does not scroll twice after a click has landed in the body', async () => {
    const tui = await bootTickets(24);
    const body = regionOf(tui, 'region-body') as unknown as {
      scrollTop: number;
    };
    // Terminal row 9 is a ticket row; `mockMouse` takes 0-based coordinates.
    await tui.mockMouse.click(10, 8);
    await settle();
    await tui.renderOnce();
    expect(body.scrollTop, 'a click scrolls nothing').toBe(0);

    // The cursor moves one row and stays inside the window, so nothing should
    // scroll at all.
    await tui.press('\x1b[B');
    expect(body.scrollTop, 'the cursor moved; the viewport did not').toBe(0);

    await quit(tui);
  });
});
