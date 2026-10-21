import type { VNode } from '@opentui/core';
import {
  BOX_FRAME_ROWS,
  CHROME_HEADER_BOX_ID,
  type ChromeInput,
  chromeTree,
} from '../src/Kernel/chrome.js';
import { columnNode, textNode } from '../src/lib/vnode.js';
import { childIdsOf, nodeById, renderTree } from './render-tree.js';

/**
 * BB-340 Task 11 (spec D6) — THE CHROME'S ROWS, READ OFF THE COMPOSED TREE.
 *
 * This replaces `src/lib/hit-test.ts`'s `chromeRows`/`boxContentRow`, which the
 * suites used as the INDEPENDENT answer to "how many rows does this screen's
 * chrome take, and which of them is the meta bar". That module is deleted with
 * this task: the mouse no longer maps a terminal row to a body line, so the only
 * caller left of that arithmetic was the tests themselves — a reference that
 * exists solely to check another number is not independent, it is a second copy.
 *
 * What replaces it is the composition ITSELF. `chromeTree` builds one node per
 * chrome row, so the row count and the row order are facts about the tree rather
 * than a formula restating it, and they are readable on Node with no renderer.
 * `tests/Kernel/chrome.test.ts` pins that pairing (the tree's rows === the
 * `chromeHeight` the body window is sized against, with a hand-derived floor so
 * the two cannot agree on nothing), and `tests-bun/Kernel/layout.test.ts` checks
 * the LAID-OUT pane against it. The cross-check moved; it did not disappear.
 *
 * A test helper, in `tests/` for the reason `render-tree.ts` gives: in `src/` it
 * would count against the ticket's line target for a thing the product never
 * runs.
 */
/**
 * The id of one row of a {@link chromeShape}'s header, so a caller can ask for
 * "the box's third content row" by name.
 *
 * The shape's rows used to be nameless (`header: ['', '', '']`) and the suites
 * addressed them by the ids the CHROME gave them — `chrome-header-2`. Since
 * BB-340's header conversion the rows of a screen-owned header carry the
 * SCREEN's ids, so a shape has to name its own; `chrome-header-<i>` now means
 * specifically "a row of the kernel's title/meta default", which a shape is not.
 */
export const shapeHeaderRowId = (index: number): string =>
  `shape-header-${index}`;

export const chromeShape = (
  boxContentRows: number,
  hasTopBar: boolean,
): ChromeInput => ({
  // The header's CONTENT does not matter to a row count — only how many rows
  // there are — so the shape is stated as the count the caller means, exactly as
  // `chromeRows({ boxContentRows, hasTopBar })` used to state it. One CHILD per
  // row, which is the contract a screen's header carries.
  header: columnNode(
    'shape-header',
    ...Array.from({ length: boxContentRows }, (_row, index) =>
      textNode({ id: shapeHeaderRowId(index), content: '' }),
    ),
  ),
  tab: hasTopBar
    ? {
        level: 'root',
        tab: 'dashboard',
        tabs: [{ id: 'dashboard', label: 'Dashboard' }],
      }
    : null,
  busy: false,
  reloadable: false,
  modal: false,
  width: 120,
});

/**
 * The header box's two frame rows, named where they fall.
 *
 * BB-340 Task 12 — the box is a real `BoxRenderable` now, so its top and
 * bottom are drawn from a `border` prop and carry neither a node nor any text.
 * They are still ROWS, though: they take two of the terminal's rows and every
 * chrome row below them sits two lower for it, which is what `chromeRowOf` and
 * `chromeRowCount` exist to answer. So they are named here rather than skipped —
 * the alternative is a helper whose row numbers are two off the terminal's, and
 * the clicks half this suite sends are addressed in terminal rows.
 *
 * What they carry is asserted where it can be seen: the glyphs and the colour in
 * `tests-bun/Kernel/chrome-cells.test.ts`, against real Yoga and a real buffer.
 */
const HEADER_BOX_ROWS = [
  `${CHROME_HEADER_BOX_ID}-border-top`,
  `${CHROME_HEADER_BOX_ID}-border-bottom`,
] as const;
if (HEADER_BOX_ROWS.length !== BOX_FRAME_ROWS) {
  throw new Error(
    `BB-340: the header box draws ${BOX_FRAME_ROWS} frame rows; tests/chrome-rows.ts names ${HEADER_BOX_ROWS.length}.`,
  );
}

/**
 * The header box's content rows, one level below the box.
 *
 * BB-340's header conversion put a node between them: the box holds the ONE
 * column a screen hands over (or the one the chrome composes from title/meta) and
 * the rows are that column's children. The nesting is what keeps the handover
 * whole — the screen's own node with the screen's own ids goes into the box
 * unchanged, rather than being unwrapped into rows the kernel re-parents.
 */
const headerRowIdsOf = (tree: VNode, boxId: string): string[] => {
  const [column] = childIdsOf(tree, boxId);
  return column === undefined ? [] : childIdsOf(tree, column);
};

/** Every chrome row, top to bottom — a node's id, or a header-box frame row. */
export const chromeRowIds = (input: ChromeInput): string[] => {
  const tree = chromeTree(input);
  return childIdsOf(tree, 'region-chrome').flatMap((id) =>
    id === CHROME_HEADER_BOX_ID
      ? [HEADER_BOX_ROWS[0], ...headerRowIdsOf(tree, id), HEADER_BOX_ROWS[1]]
      : [id],
  );
};

/**
 * Each chrome ROW as the text it carries, top to bottom.
 *
 * A row is usually one text node, but the tab-bar row is a row of one node per
 * tab (Task 11), so its pieces are joined back here: what a reader wants to
 * check is the row that appears on screen, not how many nodes it took. A
 * header-box frame row reads as EMPTY, because the tree genuinely holds no text
 * for it — see {@link HEADER_BOX_ROWS}.
 */
export const chromeRowTexts = (input: ChromeInput): string[] => {
  const tree = chromeTree(input);
  return chromeRowIds(input).map((id) => {
    const node = nodeById(tree, id);
    return node === undefined ? '' : renderTree(node as VNode).join('');
  });
};

/** How many rows the chrome draws — the successor of `chromeRows(shape)`. */
export const chromeRowCount = (input: ChromeInput): number =>
  chromeRowIds(input).length;

/**
 * The 1-BASED terminal row a chrome node is drawn on — the successor of
 * `boxContentRow(i)`/`topTabRow(shape)`.
 *
 * Found by the node's id in the composed order rather than computed from a frame
 * count, so a header row added or moved carries the tests with it.
 */
export const chromeRowOf = (input: ChromeInput, id: string): number =>
  chromeRowIds(input).indexOf(id) + 1;
