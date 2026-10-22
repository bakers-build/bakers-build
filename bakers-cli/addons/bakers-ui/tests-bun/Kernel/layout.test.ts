import { describe, expect, it } from 'bun:test';
import type { Renderable } from '@opentui/core';
import type {
  Collection,
  DropshClient,
  RendererServices,
  ResolvedRoute,
} from '../../src/types.js';
import { chromeRowCount, chromeShape } from '../../tests/chrome-rows.js';
import { type BootedTui, bootTui } from '../tui-harness.js';

// BB-326 Step B — THE FRAME IS LAID OUT, NOT PLACED.
//
// The swap bought OpenTUI partly for Yoga and then computed every row's `top`
// by hand: `top + index` on an absolutely positioned `TextRenderable`, with
// `flexDirection` and `flexGrow` unused anywhere in the kernel. So the frame
// was a fixed block of rows rather than something that fills the terminal, and
// the arithmetic that decides where the body starts existed in two places —
// here and in the click hit test.
//
// What this file pins is that the POSITIONS ARE YOGA'S. Every assertion below
// reads `screenY`/`height` off the renderables AFTER layout and compares them
// against the COMPOSED TREE — `chromeRowCount`, the number of row nodes
// `chromeTree` builds for the same screen shape. Nothing here asserts a `top`
// the kernel wrote, because the kernel no longer writes one for a non-modal
// frame.
//
// BB-340 Task 11 (spec D6) — that reference used to be `chromeRows`, from the
// deleted `src/lib/hit-test.ts`. The tree is the successor and it is a STRONGER
// reference, not a weaker one: `chromeRows` was a formula about the composition
// and could agree with Yoga while disagreeing with what is drawn, whereas the
// row nodes ARE what is drawn. `tests/chrome-rows.ts` states the relocation, and
// `tests/Kernel/chrome.test.ts` pins the tree's row count against the
// `chromeHeight` the body window is sized with, so the two numbers this file
// compares still come from two places.
//
// What it deliberately does NOT pin: that the body FILLS the terminal, or where
// the footer ends up. Those are Step C's, and they live in
// `Kernel/scroll-box.test.ts`. This file is still worth its place afterwards
// because it asserts the SHAPE of the column — one pane per region, in painting
// order, chrome as tall as the rows it composes, no gap between the panes —
// which Step C changes the sizes of and not the structure.

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
      if (path === 'bb_ticket/bb_ticket') return ticketListDoc;
      return { data: [] };
    },
    update: async () => ({}),
  };
  return {
    client,
    baseUrl: 'https://bakers.example',
    // The New-ticket modal is only reachable from the Dashboard when an agent
    // host is injected; the modal case below needs that route.
    agents: {
      launch: async () => {
        throw new Error('not under test');
      },
      list: async () => [],
      focus: async () => {},
      hide: async () => {},
      kill: async () => {},
    },
  };
}

const PROJECT_ROUTE: ResolvedRoute = {
  screen: 'project',
  projectId: PROJECT,
  projectName: 'a project',
};

const regionOf = (tui: BootedTui, id: string): Renderable => {
  const shell = tui.renderer.root.getRenderable('shell');
  if (!shell) throw new Error('the kernel drew no shell');
  const region = shell.getRenderable(id);
  if (!region) throw new Error(`the kernel drew no ${id}`);
  return region;
};

const regionIds = (tui: BootedTui): string[] => {
  const shell = tui.renderer.root.getRenderable('shell');
  if (!shell) throw new Error('the kernel drew no shell');
  return shell.getChildren().map((child) => child.id);
};

const quit = async (tui: BootedTui): Promise<void> => {
  tui.mockInput.pressKey('q');
  await tui.running;
  await tui.stop();
};

describe('BB-326 Step B — the frame is a Yoga column', () => {
  it('hangs one container per frame region off the shell, in painting order', async () => {
    const tui = await bootTui({
      services: fakeServices(),
      columns: 120,
      rows: 40,
      tui: { route: PROJECT_ROUTE },
    });
    await tui.press('\t');

    expect(regionIds(tui)).toEqual([
      'region-chrome',
      'region-body',
      'region-footer',
      'region-modal',
    ]);
    await quit(tui);
  });

  it('lets Yoga decide where the body starts — and it agrees with the composed chrome', async () => {
    const tui = await bootTui({
      services: fakeServices(),
      columns: 120,
      rows: 40,
      tui: { route: PROJECT_ROUTE },
    });
    await tui.press('\t');

    const chrome = regionOf(tui, 'region-chrome');
    const body = regionOf(tui, 'region-body');
    const footer = regionOf(tui, 'region-footer');

    // The project Tickets screen: a two-row header box and a top-tab bar.
    const shape = chromeShape(2, true);
    // Hand-derived, so the pane and the tree cannot agree on nothing: two frame
    // rows, two header rows, the bar and one separator (BB-375).
    expect(chromeRowCount(shape), 'the composed chrome is six rows').toBe(6);
    expect(chrome.screenY, 'the chrome opens the frame').toBe(0);
    expect(
      chrome.height,
      'and is as tall as the rows the composition builds',
    ).toBe(chromeRowCount(shape));
    expect(body.screenY, 'the body follows it, stacked by Yoga').toBe(
      chromeRowCount(shape),
    );
    expect(footer.screenY, 'and the footer follows the body with no gap').toBe(
      body.screenY + body.height,
    );
    await quit(tui);
  });

  it('stacks the body rows itself — no row carries a computed offset', async () => {
    const tui = await bootTui({
      services: fakeServices(),
      columns: 120,
      rows: 40,
      tui: { route: PROJECT_ROUTE },
    });
    await tui.press('\t');

    const body = regionOf(tui, 'region-body');
    // BB-326 Step C: `region-body` is a `ScrollBoxRenderable`, so its children
    // are the SCROLLED CONTENT — the two virtualisation spacers as well as the
    // window's rows. BB-340: the window's rows are a MOUNTED TREE inside that
    // content (`region-body-window`, between the spacers), so the rows are
    // reached through it rather than filtered out of the box's own children.
    // What the case is about is unchanged: a row's screen position is still the
    // layout's answer and not a `top` the kernel wrote.
    // BB-340 Task 7: the Tickets screen hands over a tree of its OWN, so the
    // window holds one child — the table — and the rows are its children. One
    // level deeper, the same rows, the same claim about who placed them.
    const window = body.getRenderable('region-body-window');
    if (!window) throw new Error('the kernel mounted no body window');
    // BB-375 — frame is region-body ScrollBox; present tree is filter + table.
    const root = window.getChildren()[0];
    if (!root) throw new Error('the screen mounted no body tree');
    const table =
      root.getChildren().find((child) => child.id === 'ticket-table') ??
      root
        .getChildren()
        .flatMap((child) => child.getChildren?.() ?? [])
        .find((child) => child.id === 'ticket-table') ??
      root;
    const painted = table.getChildren().filter((row) => row.visible);
    expect(painted.length, 'the body window is painted').toBeGreaterThan(5);
    const firstY = painted[0]?.screenY ?? body.screenY;
    const misplaced = painted.filter(
      (row, index) => row.screenY !== firstY + index,
    ).length;
    expect(misplaced, 'every body row sits one below the last').toBe(0);
    await quit(tui);
  });

  it('parks the whole non-modal column behind a modal, and vice versa', async () => {
    const tui = await bootTui({
      services: fakeServices(),
      columns: 120,
      rows: 40,
    });

    expect(regionOf(tui, 'region-modal').visible, 'no modal on boot').toBe(
      false,
    );
    expect(regionOf(tui, 'region-body').visible).toBe(true);

    // `n` on the Dashboard opens the New-ticket popup.
    await tui.press('n');

    expect(regionOf(tui, 'region-modal').visible, 'the box is painted').toBe(
      true,
    );
    for (const id of ['region-chrome', 'region-body', 'region-footer']) {
      expect(regionOf(tui, id).visible, `${id} is parked`).toBe(false);
    }

    // Escape first: `q` is text to a modal, by design (`handleKey` gates the
    // quit on `!active()?.modal`), so quitting from here would hang.
    await tui.press('\x1b');
    expect(regionOf(tui, 'region-modal').visible, 'the box is gone').toBe(
      false,
    );
    expect(regionOf(tui, 'region-body').visible, 'the column is back').toBe(
      true,
    );
    await quit(tui);
  });
});
