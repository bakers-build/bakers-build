import type { MouseEvent, Renderable, VNode } from '@opentui/core';
import { describe, expect, it } from 'vitest';
import { tabBarFor } from '../../src/Component/top-tabs/index.js';
import {
  bodyRowsFor,
  CHROME_HEADER_BOX_ID,
  type ChromeInput,
  chromeHeight,
  chromeTree,
  FOOTER_ROWS,
  footerTree,
  frameTrees,
  modalBoxWidth,
  modalOrigin,
  modalTree,
  TAB_BAR_ID,
  tabNodeId,
} from '../../src/Kernel/chrome.js';
import { bodyWindowRoot } from '../../src/Kernel/mount.js';
import { resolveBbVersion } from '../../src/lib/version.js';
import {
  BACKGROUND_ACTIVE,
  BOLD,
  BORDER,
  BORDER_EMPHASIS,
  columnNode,
  DEFAULT_BACKGROUND,
  FOREGROUND,
  FOREGROUND_ACTIVE,
  FOREGROUND_HIGHLIGHT,
  textNode,
} from '../../src/lib/vnode.js';
import { chromeRowIds, chromeRowTexts, chromeShape } from '../chrome-rows.js';
import { childIdsOf, idsOf, nodeById, renderTree } from '../render-tree.js';
import { ROOT_TABS } from '../tab-bars.js';

// BB-340 Task 4 — the chrome is NODES, and this file is what says it still
// carries the same characters in the same order.
//
// It replaces `tests/Kernel/frame.test.ts`, and every expectation below is that
// file's expectation with its SGR escapes removed. Those escapes were the
// captured byte stream of the pre-OpenTUI kernel, and they were the right
// subject while the chrome WAS a string; now the styling is an attribute on a
// `StyledText` chunk that the renderer resolves, so the byte-level check moved
// to the one reader that can see bytes: `tests/pty/verify-colors.mjs`. That
// division is spec D8 — `renderTree` answers "is this text in the tree, in this
// order" and nothing about columns or colour, and `captureCharFrame`/the PTY
// drivers answer what the terminal shows.
//
// So the glyphs, the row order and the row COUNT are pinned here; the palette
// slots and the inverse footer are pinned on a real pty.

const input = (over: Partial<ChromeInput> = {}): ChromeInput => ({
  tab: null,
  busy: false,
  reloadable: false,
  modal: false,
  width: 120,
  ...over,
});

/**
 * A screen-owned header, as a screen hands it over since BB-340 D1: ONE node,
 * a column, with one child per header row.
 *
 * It used to be `header: ['a', 'b', 'c']` — the last `readonly string[]` on the
 * screen contract, and the clause of A1 the 2026-08-13 review found unmet. The
 * kernel needs the header's ROW COUNT before Yoga has run, which is why the
 * strings survived twelve conversions; a column's CHILDREN answer that question
 * without a layout pass, so nothing has to be measured and nothing has to be a
 * string.
 */
const ownHeader = (...rows: readonly string[]): VNode =>
  columnNode(
    'own-header',
    ...rows.map((text, index) =>
      textNode({ id: `own-header-${index}`, content: text }),
    ),
  );

describe('chromeTree — the header box, the tab bar and the separator', () => {
  // The Dashboard as the kernel draws it: a two-row header box, one blank gap,
  // then the root tab bar (BB-375 — tabs sit with the body). Six rows; three
  // of them (frames + gap) carry no text.
  //
  // BB-340 Task 12 — THE BOX'S FRAME LEFT THE TEXT, exactly as the modal's did
  // in Task 9b. Rows 0 and 3 used to be `'╭─ ╳ bakers.build ─…─╮'` and `'╰─…─╯'`, two
  // composed strings that needed `displayWidth` to size their dash runs. They
  // are a `BoxRenderable`'s own border now, so `renderTree` — which sees text
  // and order and nothing else (spec D8) — reads them as empty. Their glyphs,
  // their column count and their colour moved to the one reader that can see a
  // buffer: `tests-bun/Kernel/chrome-cells.test.ts`, plus
  // `tests/pty/verify-anchor.mjs` on a real pty.
  //
  // The content rows lost their `'│ '`/`' │'` and their padding for the same
  // reason: the border is the box's and the padding is the box's.
  const DASHBOARD_CHROME = [
    '',
    'bakers.build dashboard',
    'tickets over closed_date · runs over created  ·  generated 2026-08-02T00:00:00+00:00',
    '',
    // BB-340 Task 11 — NOT padded to the terminal width any more. The bar is
    // a row of one node per tab now (so a click resolves to the tab it lands
    // on), and the blank columns to its right are the terminal's own rather
    // than spaces the composition wrote. On screen that is the same picture:
    // `tests-bun/Kernel/top-tab-bar.test.ts` reads the bar off a real render
    // buffer and right-trims it, exactly as it did before.
    // BB-375 — one blank between header box and tabs.
    '',
    // Without a workspace-lead capability the root bar is My work, Projects
    // and Conductors (`Component/top-tabs/index.ts`).
    '  My work    Projects   [Conductors]',
  ];

  const dashboard = (over: Partial<ChromeInput> = {}): ChromeInput =>
    input({
      title: 'bakers.build dashboard',
      meta: 'tickets over closed_date · runs over created  ·  generated 2026-08-02T00:00:00+00:00',
      tab: { level: 'root', tab: 'conductors', tabs: ROOT_TABS },
      ...over,
    });

  it('composes the header box, the tab bar and the separator the kernel used to write', () => {
    // Read as ROWS — `chromeRowTexts` joins the tab-bar row's per-tab nodes
    // back into the one row they paint (Task 11).
    expect(chromeRowTexts(dashboard())).toEqual(DASHBOARD_CHROME);
  });

  it('drops the tab-bar row and tab-gap when the screen has no tabs', () => {
    const rows = chromeRowTexts(input({ title: 't', meta: 'm', width: 40 }));
    // Top frame, two header rows, bottom frame — SEPARATOR_ROWS = 0 (BB-375).
    expect(rows).toHaveLength(4);
    expect(rows[1]).toBe('t');
    expect(rows[2]).toBe('m');
    expect(rows[3]).toBe('');
  });

  it('puts a screen-owned header in the box instead of the title/meta pair', () => {
    const rows = chromeRowTexts(
      input({
        title: 'ignored',
        meta: 'ignored',
        header: ownHeader('a', 'b', 'c'),
      }),
    );
    // Two frames plus three content rows; no separator (BB-375).
    expect(rows).toHaveLength(5);
    expect(rows[1]).toContain('a');
    expect(rows[3]).toContain('c');
  });

  it('sizes the chrome from the handed header’s CHILDREN, with no layout pass', () => {
    // The whole reason the header could stay a `string[]` until now: the body
    // window is sized before Yoga runs, so the count has to come out of the
    // description rather than out of the layout. A column's children are that
    // count — read here on Node, with no renderer in the process at all.
    //
    // Derived by hand: two frame rows, the rows the screen handed over, no tab
    // bar / gap, no separator (BB-375).
    expect(chromeHeight(input({ header: ownHeader('a') }))).toBe(2 + 1);
    expect(chromeHeight(input({ header: ownHeader('a', 'b', 'c') }))).toBe(
      2 + 3,
    );
    // …and the screen's own rows are what the box carries, not a re-composition
    // of them: the node the screen built is in the tree under its own id.
    expect(
      nodeById(
        chromeTree(input({ header: ownHeader('a', 'b') })),
        'own-header-1',
      ),
    ).toBeDefined();
  });

  it('has exactly one node per chrome row — the count `chromeHeight` publishes', () => {
    // The pairing the layout suite's independent reference is built on: the
    // tree's ROW count and the number the body window is sized against are one
    // number. If `chromeTree` gains or loses a row without `chromeHeight`
    // saying so, this fails.
    //
    // BB-340 Task 11: counted as the chrome root's direct children rather
    // than as the strings `renderTree` finds, because the tab-bar row is a row
    // of one node per tab now — several texts, one row.
    for (const over of [
      {},
      { tab: null },
      { header: ownHeader('a', 'b', 'c', 'd') },
    ]) {
      const shape = dashboard(over);
      const rows = chromeRowIds(shape);
      // Hand-derived floor: smallest chrome is two frames + two header rows
      // (no tab → no gap; SEPARATOR_ROWS = 0).
      expect(rows.length).toBeGreaterThanOrEqual(4);
      expect(rows).toHaveLength(chromeHeight(shape));
    }
  });

  it('paints header title FOREGROUND_HIGHLIGHT and meta FOREGROUND (BB-375)', () => {
    const tree = chromeTree(input({ title: 'Title', meta: 'Meta line' }));
    const title = nodeById(tree, 'chrome-header-0');
    const meta = nodeById(tree, 'chrome-header-1');
    expect(
      (title?.props as { attributes?: unknown } | undefined)?.attributes,
    ).toBe(BOLD);
    expect((title?.props as { fg?: unknown } | undefined)?.fg).toBe(
      FOREGROUND_HIGHLIGHT,
    );
    expect((meta?.props as { fg?: unknown } | undefined)?.fg).toBe(FOREGROUND);
  });
});

// BB-340 Task 11 (spec D6) — THE CHROME TAKES ITS OWN CLICKS.
//
// `lib/hit-test.ts` is deleted with this task, and with it the kernel's
// `row === topTabRow(shape)` / `row === boxContentRow(header.length - 1)`
// arithmetic. What replaces it is the renderer's own hit test: the pointer
// lands on a node, and the node the composition put there is the one that knows
// what a click on it means.
describe('chromeTree — the clicks the chrome routes itself', () => {
  const mouse = (over: Partial<MouseEvent> = {}): MouseEvent =>
    ({ type: 'down', button: 0, x: 0, y: 0, ...over }) as MouseEvent;
  const handlerOn = (
    tree: VNode,
    id: string,
  ): ((event: MouseEvent) => void) => {
    const node = nodeById(tree, id);
    const handler = (node?.props as { onMouse?: (e: MouseEvent) => void })
      ?.onMouse;
    if (!handler) throw new Error(`no onMouse on ${id}`);
    return handler;
  };

  it('puts one node per tab on the bar row, keyed by the tab it is', () => {
    const tree = chromeTree(
      input({
        title: 't',
        meta: 'm',
        tab: { level: 'root', tab: 'conductors', tabs: ROOT_TABS },
      }),
    );
    // The pieces the bar is drawn from, in order — the tabs interleaved with
    // their joins. Only the tabs are keyed by a tab id, because only they are
    // clickable: the join between two tabs belongs to neither.
    expect(childIdsOf(tree, TAB_BAR_ID)).toEqual([
      `${TAB_BAR_ID}-pad`,
      tabNodeId('my-work'),
      `${TAB_BAR_ID}-join-1`,
      tabNodeId('projects'),
      `${TAB_BAR_ID}-join-3`,
      tabNodeId('conductors'),
    ]);
    // And the row still reads exactly as the composed bar did: the pieces
    // joined ARE `tabBarFor`, with the leading space the bar was written with.
    expect(renderTree(nodeById(tree, TAB_BAR_ID) as VNode).join('')).toBe(
      ` ${tabBarFor({ level: 'root', tab: 'conductors', tabs: ROOT_TABS })}`,
    );
  });

  it('resolves a click on the bar to the tab under the pointer', () => {
    const seen: string[] = [];
    const tree = chromeTree(
      input({
        tab: { level: 'root', tab: 'conductors', tabs: ROOT_TABS },
        onTabClick: (id) => seen.push(id),
      }),
    );
    const onMouse = handlerOn(tree, TAB_BAR_ID);
    onMouse(mouse({ target: { id: tabNodeId('projects') } as Renderable }));
    expect(seen, 'the child under the pointer names its tab').toEqual([
      'projects',
    ]);
    // The join between two tabs belongs to neither, and the bar's own empty
    // space past the last tab belongs to no tab at all: both are inert, as the
    // gaps between the old column spans were.
    onMouse(mouse({ target: { id: `${TAB_BAR_ID}-join-1` } as Renderable }));
    onMouse(mouse({ target: { id: TAB_BAR_ID } as Renderable }));
    expect(seen).toEqual(['projects']);
  });

  it('acts on the left press alone, never on the release or a right button', () => {
    const seen: string[] = [];
    const tree = chromeTree(
      input({
        tab: { level: 'root', tab: 'conductors', tabs: ROOT_TABS },
        onTabClick: (id) => seen.push(id),
      }),
    );
    const onMouse = handlerOn(tree, TAB_BAR_ID);
    const target = { id: tabNodeId('projects') } as Renderable;
    // One physical click also sends `up`, and a drag arrives as its own type;
    // acting on either fires the navigation twice.
    onMouse(mouse({ target, type: 'up' }));
    onMouse(mouse({ target, type: 'drag' }));
    onMouse(mouse({ target, button: 2 }));
    expect(seen).toEqual([]);
  });

  /**
   * GONE WITH THE `string[]` HEADER, and this is the case that used to be here.
   *
   * The kernel published an `onHeaderClick(column, keptWidth)` and put it on
   * every header row, because the screen-owned bar was drawn as the box's last
   * row and a STRING has no children for the renderer to hit: the click arrived
   * as a buffer column, the kernel shifted it by the box's two frame columns
   * (`HEADER_TEXT_COLUMN`), and the screen looked the column up in a span map it
   * published beside its own text (`detailTabSpans`). That was the last
   * coordinate translation in the chrome and the last reader of `displayWidth`
   * in the ticket's own bar component (retired; what survived of that file is
   * the heading map in `Entity/ticket/Component/sections`).
   *
   * A header row is a node now, so every bar is a row of one node per tab and
   * the renderer resolves the tab under the pointer — the same mechanism the top
   * tab bar has used since Task 11, asserted for the ticket level's entries in
   * `tests/Component/top-tabs/index.test.ts` (one clickable part per tab) and end
   * to end in `tests-bun/Kernel/route-boot.test.ts` (a real click at a real
   * column still switches the right tab, and the bar's empty space is still
   * inert).
   */
  it('offers the header no click intent of its own any more', () => {
    const ids = idsOf(chromeTree(input({ header: ownHeader('a', 'b', 'c') })));
    // No kernel-numbered header row at all: the rows are the screen's, under its
    // own ids, and the kernel neither renames nor re-wraps them. (The box
    // itself stays `chrome-header-box` — it is the kernel's chrome.)
    expect(ids.filter((id) => /^chrome-header-\d+$/.test(id))).toEqual([]);
    expect(ids).toContain('own-header-2');
  });

  it('leaves the bar inert when the kernel offers no click intent', () => {
    // A composition with no callbacks is what every pure test builds; it must
    // not throw when the renderer delivers a click to it.
    const tree = chromeTree(
      input({ tab: { level: 'root', tab: 'conductors', tabs: ROOT_TABS } }),
    );
    expect(() =>
      handlerOn(
        tree,
        TAB_BAR_ID,
      )(mouse({ target: { id: tabNodeId('projects') } as Renderable })),
    ).not.toThrow();
  });

  // BB-472: the cockpit is a fixed value for a process lifetime, and an
  // operator running several must be able to tell them apart at a glance.
  it('shows the active workspace name in the header title', () => {
    const tree = chromeTree(
      input({
        title: 't',
        meta: 'm',
        tab: { level: 'root', tab: 'conductors', tabs: ROOT_TABS },
        workspace: 'keytec',
      }),
    );
    const header = nodeById(tree, CHROME_HEADER_BOX_ID);
    expect((header?.props as { title?: string } | undefined)?.title).toContain(
      'keytec',
    );
  });

  it('omits any workspace suffix when none is resolved', () => {
    const tree = chromeTree(
      input({
        title: 't',
        meta: 'm',
        tab: { level: 'root', tab: 'conductors', tabs: ROOT_TABS },
      }),
    );
    const header = nodeById(tree, CHROME_HEADER_BOX_ID);
    expect((header?.props as { title?: string } | undefined)?.title).toBe(
      ' ╳ bakers.build ',
    );
  });

  it('header/tab bar omit fill; active tab BACKGROUND_ACTIVE + FOREGROUND_ACTIVE (BB-375)', () => {
    const tree = chromeTree(
      input({
        title: 't',
        meta: 'm',
        tab: { level: 'root', tab: 'conductors', tabs: ROOT_TABS },
      }),
    );
    const header = nodeById(tree, CHROME_HEADER_BOX_ID);
    const bar = nodeById(tree, TAB_BAR_ID);
    expect(
      (header?.props as { borderColor?: unknown } | undefined)?.borderColor,
    ).toBe(BORDER);
    expect(
      (header?.props as { titleColor?: unknown } | undefined)?.titleColor,
    ).toBe(BORDER_EMPHASIS);
    expect(
      (header?.props as { backgroundColor?: unknown } | undefined)
        ?.backgroundColor,
    ).toBeUndefined();
    expect(
      (bar?.props as { backgroundColor?: unknown } | undefined)
        ?.backgroundColor,
    ).toBeUndefined();
    const active = nodeById(tree, tabNodeId('conductors'));
    const inactive = nodeById(tree, tabNodeId('projects'));
    expect((active?.props as { fg?: unknown } | undefined)?.fg).toBe(
      FOREGROUND_ACTIVE,
    );
    expect((active?.props as { bg?: unknown } | undefined)?.bg).toBe(
      BACKGROUND_ACTIVE,
    );
    expect((inactive?.props as { fg?: unknown } | undefined)?.fg).toBe(
      FOREGROUND,
    );
    expect((inactive?.props as { bg?: unknown } | undefined)?.bg).toBe(
      DEFAULT_BACKGROUND,
    );
  });
});

// BB-340 Task 12 — THE FOOTER'S PADDING IS AN OVERFLOW, NOT A FIT.
//
// The row used to be `ESC[7m + fitLine(hint + status, width) + ESC[0m`: measured
// to exactly the terminal's columns, because a `TextRenderable` inverts the cells
// its glyphs cover and none beyond them, and the status bar has spanned the
// terminal since the cockpit's first frame. `fitLine` is gone with `lib/ansi.ts`,
// so the row is over-padded by a WHOLE terminal's worth of spaces and the layout
// throws the surplus away.
//
// That is why every expectation below names `PAD` instead of a column count: what
// this file can see is the text, and the text now deliberately runs past the
// terminal. That it comes out at exactly `width` INVERTED columns is the claim of
// `tests-bun/Kernel/chrome-cells.test.ts`, which reads the spans off a real
// buffer — spec D8's division, and the same one that moved the modal's border in
// Task 9b.
describe('footerTree — status (+ optional actions), no wash spacer (BB-375)', () => {
  /** The over-pad the status row carries for a terminal of `width` columns. */
  const PAD = (width: number): string => ' '.repeat(width);
  const VER = `bakers ${resolveBbVersion()}`;
  const footerText = (tree: ReturnType<typeof footerTree>): string =>
    renderTree(tree).join('');

  it('pins FOOTER_ROWS to one (status only)', () => {
    expect(FOOTER_ROWS).toBe(1);
  });

  it('composes pipe-separated basics and styles active keys with FOREGROUND_ACTIVE fg', () => {
    const tree = footerTree(
      input({
        // Ladder from screens is ignored — kernel owns the key row.
        status: ' ↑↓ · Enter · Tab · Esc · q quit ',
        reloadable: true,
      }),
    );
    expect(footerText(tree)).toBe(
      ` ${VER} │ R:reload │ ↑↓ │ Enter │ Esc:back │ W:workspace │ q:quit${PAD(120)}`,
    );
    expect(
      (nodeById(tree, 'footer-esc-key')?.props as { fg?: unknown })?.fg,
    ).toBe(FOREGROUND_ACTIVE);
    expect(
      (
        nodeById(tree, 'footer-esc-sfx')?.props as {
          content?: string;
          fg?: unknown;
        }
      )?.content,
    ).toBe(':back');
    expect(
      (nodeById(tree, 'footer-esc-sfx')?.props as { fg?: unknown })?.fg,
    ).toBe(BORDER);
    expect(
      (nodeById(tree, 'footer-quit-key')?.props as { fg?: unknown })?.fg,
    ).toBe(FOREGROUND_ACTIVE);
    expect(
      (nodeById(tree, 'footer-quit-sfx')?.props as { content?: string })
        ?.content,
    ).toBe(':quit');
  });

  it('BB-376 D7 — the reload chip says (auto) while a signal watcher is live', () => {
    expect(
      footerText(
        footerTree(
          input({
            // Ladder-shaped status is ignored by footerNotice.
            status: ' ↑↓ · Enter · Tab · Esc · q quit ',
            reloadable: true,
            autoRefresh: true,
          }),
        ),
      ),
    ).toBe(
      ` ${VER} │ R:reload (auto) │ ↑↓ │ Enter │ Esc:back │ W:workspace │ q:quit${PAD(120)}`,
    );
  });

  it('BB-376 D7 — an absent auto-refresh flag reads as plain reload', () => {
    expect(
      footerText(
        footerTree(
          input({
            status: ' ↑↓ · Enter · Tab · Esc · q quit ',
            reloadable: true,
            autoRefresh: false,
          }),
        ),
      ),
    ).toBe(
      ` ${VER} │ R:reload │ ↑↓ │ Enter │ Esc:back │ W:workspace │ q:quit${PAD(120)}`,
    );
  });

  it('keeps the key row and paints a spinner at the right while busy', () => {
    const tree = footerTree(
      input({
        toast: 'saved',
        busy: true,
        reloadable: true,
        width: 40,
        nowMs: 0,
      }),
    );
    const text = footerText(tree);
    expect(text).not.toContain('saved');
    expect(text).toContain('R:reload');
    expect(text).toContain('q:quit');
    expect(text).not.toContain('Loading…');
    expect(
      (nodeById(tree, 'footer-spinner')?.props as { content?: string })
        ?.content,
    ).toBe(' ⠋');
    expect(
      (nodeById(tree, 'footer-loading')?.props as { content?: string })
        ?.content,
    ).toBe(' loading ');
    expect(nodeById(tree, 'footer-toast')).toBeUndefined();
  });

  it('falls back to version + basics when the screen names no status', () => {
    expect(footerText(footerTree(input({ width: 40 })))).toBe(
      ` ${VER} │ ↑↓ │ Enter │ Esc:back │ W:workspace │ q:quit${PAD(40)}`,
    );
  });

  it('prefixes a standing notice and paints the action toast at the right', () => {
    const tree = footerTree(
      input({
        status: 'view-only',
        toast: 'tunnel started',
        width: 80,
        toastAgeMs: 80,
      }),
    );
    const text = footerText(tree);
    expect(text).toContain(
      ` view-only │ ${VER} │ ↑↓ │ Enter │ Esc:back │ W:workspace │ q:quit`,
    );
    expect(text).toContain(' ✓ tunnel started');
    expect(
      (nodeById(tree, 'footer-toast')?.props as { content?: string })?.content,
    ).toBe(' ✓ tunnel started ');
  });

  it('animates the toast mark from a dot to a check', () => {
    const fresh = footerTree(input({ toast: 'tunnel started', toastAgeMs: 0 }));
    expect(
      (nodeById(fresh, 'footer-toast')?.props as { content?: string })?.content,
    ).toBe(' · tunnel started ');
    const settled = footerTree(
      input({ toast: 'tunnel started', toastAgeMs: 80 }),
    );
    expect(
      (nodeById(settled, 'footer-toast')?.props as { content?: string })
        ?.content,
    ).toBe(' ✓ tunnel started ');
  });

  it('is FOOTER_ROWS tall — the number the body window is sized against', () => {
    const tree = footerTree(input({ status: 's' }));
    expect(idsOf(tree)).toEqual(expect.arrayContaining(['footer-row-0']));
    expect(idsOf(tree)).not.toContain('footer-spacer');
    const fill = nodeById(tree, 'footer-fill');
    expect(
      (
        fill?.props as
          | { backgroundColor?: unknown; height?: unknown }
          | undefined
      )?.backgroundColor,
    ).toBeUndefined();
    expect((fill?.props as { height?: unknown } | undefined)?.height).toBe(
      FOOTER_ROWS,
    );
    expect(
      (
        nodeById(tree, 'footer-row-0')?.props as
          | { backgroundColor?: unknown }
          | undefined
      )?.backgroundColor,
    ).toBeUndefined();
  });

  it('renders screen action-items as styled key chips with pipes (BB-375)', () => {
    const tree = footerTree(
      input({
        actions: [
          { id: 'tickets-new', key: 'n', label: 'new' },
          { id: 'tickets-edit', key: 'e', label: 'edit' },
        ],
        width: 40,
      }),
    );
    // Actions row directly above basics — FOOTER_ROWS + 1.
    expect(footerText(tree)).toBe(
      ` n:New │ e:Edit${PAD(40)} ${VER} │ ↑↓ │ Enter │ Esc:back │ W:workspace │ q:quit${PAD(40)}`,
    );
    expect(
      (nodeById(tree, 'tickets-new-key')?.props as { fg?: unknown })?.fg,
    ).toBe(FOREGROUND_ACTIVE);
    expect(
      (nodeById(tree, 'tickets-edit-sfx')?.props as { content?: string })
        ?.content,
    ).toBe(':Edit');
    expect(nodeById(tree, 'footer-spacer-actions')).toBeUndefined();
    expect(
      (nodeById(tree, 'footer-fill')?.props as { height?: unknown })?.height,
    ).toBe(FOOTER_ROWS + 1);
  });
});

describe('modalTree — the boxed popup', () => {
  // BB-340 Task 9b — THE BORDER LEFT THE TEXT.
  //
  // Every expectation below used to include the box's own characters, because
  // the box WAS a stack of `'│ ' + fitLine(line) + ' │'` rows. The border is a
  // real Yoga border now — which is what lets a converted screen's tree go
  // inside it at all — so `renderTree` (spec D8: text and order, never layout)
  // can no longer see it, and the rows it does see are the box's CONTENT. The
  // border's own glyphs and colour are asserted where they can be: against real
  // Yoga in `tests-bun/Kernel/modal-box.test.ts`, and on a real pty by
  // `tests/pty/verify-colors.mjs`.
  const MODAL_BODY = [
    '▸ Title:',
    '    <empty>',
    '  Description:',
    '    <empty>',
    '  Parent:    —',
    '    (no project context — open a project to pick a parent)',
    '  Assignee:  < cw >',
    '  Conductor: < cw-framework >',
    '  Labels:',
    '    [ ] bug',
    '  Workflow:  < feature >',
    '  [ Create with agent ]',
    '  [ Create directly ]',
  ];
  // BB-340 Task 12 — the box's header, separators and status carry their
  // string VERBATIM. They used to be `fitLine`d to the box's inner width, which
  // padded each of them to 60 columns; the box paints its own background across
  // that width and clips whatever overruns it, so the padding bought nothing
  // once `lib/ansi.ts` went.
  const MODAL_BOX = [
    '⚡ New ticket · bakers',
    '',
    ...MODAL_BODY,
    '',
    ' ↑↓ field · ←→ change · Space toggle',
    ' Ctrl+S agent · Ctrl+D direct · Esc cancel',
  ];
  /** The popup's rows as the tree a converted screen hands over. */
  const bodyTreeOf = (rows: readonly string[]): VNode =>
    columnNode(
      'popup-body',
      ...rows.map((line, index) =>
        textNode({ id: `popup-body-${index}`, content: line }),
      ),
    );

  const popup = input({
    modal: true,
    title: '⚡ New ticket',
    meta: 'bakers',
    // One `status` carrying an embedded newline: the box's assembly flat-maps on
    // `\n`, which is how the two hint rows become two box rows.
    status:
      ' ↑↓ field · ←→ change · Space toggle\n Ctrl+S agent · Ctrl+D direct · Esc cancel',
  });

  it('boxes the header, the body and the multi-line status the kernel used to write', () => {
    const tree = modalTree(popup, bodyTreeOf(MODAL_BODY));
    expect(renderTree(tree)).toEqual(MODAL_BOX);
    expect(
      (tree.props as { borderColor?: unknown } | undefined)?.borderColor,
    ).toBe(BORDER_EMPHASIS);
  });

  it('publishes the box width the caller centres the box with', () => {
    // 60 inner columns is the cap; below it the box tracks the terminal.
    expect(modalBoxWidth(120)).toBe(64);
    expect(modalBoxWidth(50)).toBe(46);
  });

  it('places the box one row higher than a centre, against the height Yoga gave it', () => {
    // The rule the kernel applies, with the box's height as an INPUT — a
    // converted screen's body has no row count until the layout has run, which
    // is why `modalRows` could not survive Task 9b.
    expect(modalOrigin(popup, 40, 20).top).toBe(9);
    // Yoga's own centring would be `floor((40 - 20) / 2)` = 10.
    expect(modalOrigin(popup, 40, 20).top).toBe(Math.floor((40 - 20) / 2) - 1);
    // …and it never lets the box's first row leave the screen.
    expect(modalOrigin(popup, 20, 30).top).toBe(1);
    // Horizontally it is the same floor the box has always been drawn at.
    expect(modalOrigin(popup, 40, 20).left).toBe((120 - 64) / 2);
  });

  it('narrows the box on a narrow terminal, and joins title and meta into one row', () => {
    const rows = renderTree(
      modalTree(
        input({ modal: true, title: 't', meta: 'm', status: 's', width: 50 }),
        bodyTreeOf(['body']),
      ),
    );
    // Header + blank + body + blank + status; the two border rows are the
    // renderer's now and are not content.
    expect(rows).toHaveLength(5);
    expect(rows[0]).toBe('t · m');
    expect(rows.at(-1)).toBe('s');
  });

  // BB-472: a modal box carries no `headerBox` title prop of its own, so
  // without this the workspace name a full screen shows in its border
  // (above) simply disappeared behind any popup opened over it — including
  // the workspace-picker popup itself, which is exactly where an operator
  // most needs to see what is still active while choosing what to switch to.
  it('names the active workspace in the modal header row', () => {
    const rows = renderTree(
      modalTree(
        input({
          modal: true,
          title: 'Which workspace?',
          meta: '2 accessible workspace(s)',
          workspace: 'keytec',
          width: 50,
        }),
        bodyTreeOf(['body']),
      ),
    );
    expect(rows[0]).toBe(
      'Which workspace? · workspace: keytec · 2 accessible workspace(s)',
    );
  });

  it('puts a CONVERTED screen’s tree in the box instead of rows (spec D1/D5)', () => {
    // The whole reason the border had to stop being text: a tree cannot go
    // inside a string. The header and the status still ride with it.
    const tree = modalTree(
      popup,
      columnNode('form', textNode({ id: 'f', content: 'a field' })),
    );
    expect(renderTree(tree)).toEqual([
      MODAL_BOX[0],
      MODAL_BOX[1],
      'a field',
      MODAL_BOX.at(-3),
      MODAL_BOX.at(-2),
      MODAL_BOX.at(-1),
    ]);
    expect(idsOf(tree)).toContain('f');
  });
});

// BB-326 Step B / BB-340 Task 4 — THE REGIONS.
//
// The kernel used to place every composed line at a `top` it computed itself,
// which is how a framework bought for its Yoga layout ended up computing no
// layout at all. To lay the frame out, the caller has to know which parts a
// frame HAS — and the only honest source for that is the composition, which is
// the code that decides how many header rows there are, whether a tab bar was
// drawn and whether this frame is a box instead.
describe('frameTrees — the regions the caller lays out', () => {
  // The body a screen hands over, rooted exactly as `presentation()` roots it —
  // `region-body-window`, the slot the kernel mounts an empty tree in. The
  // window this function used to compose for a row surface is gone with the
  // surface (BB-340 Task 12).
  const body = bodyWindowRoot(
    columnNode(
      'rows',
      ...['one', 'two', 'three', 'four', 'five'].map((line, index) =>
        textNode({ id: `row-${index}`, content: line }),
      ),
    ),
  );

  it('are chrome, body and footer, in the order they are painted', () => {
    expect(
      frameTrees(input({ title: 't', meta: 'm' }), body).map(([id]) => id),
    ).toEqual(['chrome', 'body', 'footer']);
  });

  it('is ONE region for a modal — a box has no chrome/body/footer to split', () => {
    // Everything around the box's body is `fitLine`d into its own row, so there
    // is no boundary the caller could lay out against: the status is a boxed row
    // like any other. Publishing a single region is the honest answer, and it is
    // what lets the kernel place the box (one origin) instead of 20 rows.
    expect(
      frameTrees(input({ modal: true, title: 't', meta: 'm' }), body).map(
        ([id]) => id,
      ),
    ).toEqual(['modal']);
  });

  it('keys each region tree under the id the kernel mounted it as', () => {
    // `patchTree` reuses a standing tree only when the ROOT id matches, so a
    // composition that renamed a region would silently rebuild it every frame.
    for (const [id, tree] of frameTrees(input({ title: 't' }), body)) {
      expect((tree.props as { id?: string }).id).toBe(
        id === 'body' ? 'region-body-window' : `region-${id}`,
      );
    }
  });

  it('passes the screen`s own tree through whole, rather than a window into it', () => {
    // The successor of the `bodyRows` this used to publish: there is no window
    // to count rows of any more, because the screen's tree is mounted whole and
    // the ScrollBox scrolls the real nodes.
    const [, painted] = frameTrees(input({ title: 't' }), body).find(
      ([id]) => id === 'body',
    ) as [unknown, VNode];
    expect(painted).toBe(body);
    expect(renderTree(painted)).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
    ]);
  });
});

// The chrome's height, and the body window that is everything it leaves.
//
// `chromeHeight` reads `chromeRows` — the HIT TEST's answer to the same
// question, over this module's own header — so the rows a click skips and the
// rows the chrome occupies are one number with one definition. The composed
// tree's node count is asserted against it above, and the laid-out pane is
// asserted against it again in `tests-bun/Kernel/layout.test.ts`.
describe('chromeHeight — one definition of how many rows the chrome takes', () => {
  it('is hand-derived for both chrome shapes', () => {
    // BB-340 Task 11: hand-derived rather than read off `chromeRows`, which
    // is deleted with `lib/hit-test.ts`. The number the body window is sized
    // against is checked against the composition above (one node per row) and
    // against the laid-out pane in `tests-bun/Kernel/layout.test.ts`; here it
    // is checked against the rows a reader can count.
    const shown = input({ title: 'bakers.build dashboard', meta: 'meta' });
    // Two frame rows, two header rows, tab-gap, bar; no body separator (BB-375).
    expect(
      chromeHeight({
        ...shown,
        tab: { level: 'root', tab: 'conductors', tabs: ROOT_TABS },
      }),
    ).toBe(6);
    // The same without a bar (and without the tab-gap).
    expect(chromeHeight(shown)).toBe(4);
  });

  // BB-346 A7, AS A RECORD OF THAT TRADE — and it is only that.
  //
  // What it observed: the ticket screen traded a header row for a bar row, and the
  // chrome came out exactly as tall as it had been. Stated as an equality between
  // the two shapes rather than against a literal, so a future chrome change moved
  // both sides together instead of turning this into a stale number. F4 was a CLAIM
  // the spec made about arithmetic; this was the observation of it.
  //
  // NEITHER SHAPE BELOW IS THE TICKET SCREEN'S ANY MORE. BB-369 D1 put a `State:`
  // row in the header box, so the live ticket shape is `chromeShape(3, true)` —
  // three box content rows AND the chrome's bar row. BB-375 puts the gap above
  // the bar, so a bar screen is SIX and the ticket screen is SEVEN. This case
  // still passes because it is arithmetic over two shapes that both stopped
  // describing the screen, which is exactly the failure mode
  // `tests/retired-vocabulary.test.ts` exists to forbid and cannot catch: the rot is
  // in the words, not in the numbers. So the words are past tense now.
  //
  // WHERE THE PRESENT TENSE LIVES: `tests-bun/Kernel/render-geometry.test.ts`
  // measures the delta on the real renderer —
  // `firstBody(ticket) - firstBody(bar)` is 1, "exactly the state row taller than a
  // bar screen, measured on both". Read the pair together: this one is the 346
  // record, that one is the 369 observation, and they do not disagree.
  it('BB-346 A7 recorded: the retired trade was equal; HEADER_TAB_GAP breaks that coincidence', () => {
    const before = chromeShape(3, false); // title, labels, detail bar; no bar row
    const after = chromeShape(2, true); // title, labels; gap + top bar row
    // Historical equality no longer holds: the gap exists only when there is a
    // bar (BB-375). Assert the present heights instead of a stale coincidence.
    expect(chromeHeight(before)).toBe(5);
    expect(chromeHeight(after)).toBe(6);
  });
});

// BB-326 Step C — THE BODY WINDOW IS DERIVED, NOT A MAGIC CONSTANT.
describe('bodyRowsFor — everything the chrome and the status row leave', () => {
  const shown = input({ title: 'bakers.build dashboard', meta: 'meta' });
  const withTab = {
    ...shown,
    tab: { level: 'root', tab: 'conductors', tabs: ROOT_TABS },
  } as const;

  it('is the terminal minus the chrome minus the one-row footer', () => {
    // Hand-derived: two frame + two header + gap + bar = six; footer = 1.
    expect(bodyRowsFor(withTab, 40)).toBe(33);
    expect(bodyRowsFor(withTab, 24)).toBe(17);
    // No bar: four chrome rows, so the window is two rows taller.
    expect(bodyRowsFor(shown, 40)).toBe(35);
  });

  it('keeps one row of body however short the terminal is', () => {
    expect(bodyRowsFor(withTab, 4)).toBe(1);
  });

  it('makes a full frame exactly as tall as the terminal', () => {
    // The pin for the row the operator got back, restated over the three parts
    // the kernel now stacks instead of over one flat `string[]`: with a body
    // long enough to fill it, chrome + body + footer is the whole terminal and
    // nothing is left over below the status row.
    for (const terminalRows of [24, 30, 40, 60]) {
      expect(
        chromeHeight(withTab) +
          bodyRowsFor(withTab, terminalRows) +
          FOOTER_ROWS,
        `at ${terminalRows} rows`,
      ).toBe(terminalRows);
    }
  });
});
