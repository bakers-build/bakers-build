import type { VNode } from '@opentui/core';
import { expect, it } from 'vitest';
import type { FieldDecl } from '../../src/Form/index.js';
import { renderDeclaredFieldsTree } from '../../src/Widget/index.js';
import { FieldTextarea } from '../../src/Widget/textarea.js';
import { childIdsOf, nodeById, renderTree } from '../render-tree.js';

// BB-283 / BB-326 — the widget half of the text-cursor regression: a movable
// insertion point is invisible until the WRAPPED renderer draws it (AC-4). The
// logical offset has to be translated onto the soft-wrapped rows `wrapToWidth`
// emits — the translation the ticket calls the actual work.
//
// BB-326 CHANGED WHAT DRAWS IT, ON AN OPERATOR DECISION. The insertion point
// used to be an inverse-video cell spliced into the row (`\x1b[7m…\x1b[27m`).
// It is now a real TERMINAL cursor, because the operator drives the cockpit over
// mosh from a phone and mosh's local predictive echo only works when the
// terminal has a cursor to predict at.
//
// BB-340 Task 9 CHANGED WHERE IT LIVES. The widget used to PUBLISH a caret —
// row, column, width, height, text, offset — which the component, the screen and
// the frame each rebased in turn until `Kernel/caret-slot.ts` placed a renderable
// absolutely over the composed rows. The renderable is a NODE in the field's own
// column now, so every one of those six numbers is either a prop on it or a fact
// about its position that Yoga owns:
//
//     caret.row       → WHICH child of `field-<id>` the block is
//     caret.column    → `field-<id>-input-row`'s `paddingLeft`
//     caret.width     → `field-<id>-input`'s `width`, minus the cursor's column
//     caret.height    → the block's and the widget's `height`
//     caret.text      → the widget's `value`
//     caret.offset    → the widget's `caretOffset`
//     caret.placeholder → the widget's `placeholder`
//
// The translation under test is unchanged — which wrapped row a source offset
// belongs to, and where in that row it sits. Only its consumer moved.
//
// Paired with `tests/Form/text-cursor.test.ts` (keys + reducer).

const field: FieldDecl = { id: 'd', label: 'Description', kind: 'text' };

/** What the field's insertion-point widget declares, or nothing. */
interface Insertion {
  value?: string;
  caretOffset?: number;
  placeholder?: string | null;
  height?: number;
  width?: number;
}

const treeOf = (
  value: string,
  cursor: number,
  active: boolean,
  width = 14,
): VNode =>
  renderDeclaredFieldsTree(
    [field],
    { active: active ? 0 : -1, cursor, d: value },
    {},
    { width },
  );

const insertionOf = (
  value: string,
  cursor: number,
  active: boolean,
  width = 14,
): Insertion | undefined => {
  const node = nodeById(treeOf(value, cursor, active, width), 'field-d-input');
  if (node === undefined) return undefined;
  expect(node.type).toBe(FieldTextarea);
  return node.props as Insertion;
};

/** The rendered rows with the two-column active/idle marker stripped off row 0. */
const body = (rows: string[]): string[] => [
  (rows[0] ?? '').slice(2),
  ...rows.slice(1),
];

it('the rows carry the value and NOTHING else — no caret is drawn into them', () => {
  // Budget 14 - 4 = 10 columns: 'aaa bbb ccc ddd' wraps to 'aaa bbb' / 'ccc ddd',
  // the break eating the space at offset 7. With the field IDLE those two rows
  // are text, and the bytes that used to draw a caret are gone from them.
  const rows = body(renderTree(treeOf('aaa bbb ccc ddd', 8, false)));
  expect(rows[0]).toBe('Description:');
  expect(rows[1]).toBe('    aaa bbb');
  expect(rows[2]).toBe('    ccc ddd');
  expect(rows.join('\n')).not.toContain('\x1b[7m');
});

it('the active field`s value block is the widget, never a second copy in text', () => {
  // The rule that made the old double paint safe, and that makes this one
  // unnecessary: the widget owns those cells, so emitting them as text as well
  // would paint the same characters twice, once under a live cursor.
  const rows = renderTree(treeOf('aaa bbb ccc ddd', 8, true));
  expect(rows).toEqual(['▸ Description:']);
});

it('the caret lands on the wrapped row the insertion point belongs to (AC-4)', () => {
  // Offset 8 is the first 'c' — the SECOND wrapped row, at its column 0. In the
  // published text those two rows are 'aaa bbb\nccc ddd', so the first 'c' is at
  // offset 8 there too — the break ate exactly one space, so the two offsets
  // coincide here; the case where they do NOT is the next test.
  const insertion = insertionOf('aaa bbb ccc ddd', 8, true);
  expect(insertion?.value).toBe('aaa bbb\nccc ddd');
  expect(insertion?.caretOffset).toBe(8);
  expect(insertion?.height).toBe(2);
  // The block starts under the LABEL, four columns in — what `caret.column`
  // said — and it is one column wider than the 10 the value may use, because a
  // cursor at the end of a row sits one past its last character.
  const tree = treeOf('aaa bbb ccc ddd', 8, true);
  expect(
    (nodeById(tree, 'field-d-input-row')?.props as { paddingLeft?: number })
      ?.paddingLeft,
  ).toBe(4);
  expect(insertion?.width).toBe(11);
  // …and it really is the field's SECOND row: the label above it, nothing else.
  expect(childIdsOf(tree, 'field-d')).toEqual([
    'field-d-row-0',
    'field-d-input-row',
  ]);
});

it('the published offset is the offset into the WRAPPED text, not the value', () => {
  // Two spaces at the break: the wrap eats BOTH, so the wrapped text is two
  // characters shorter than the value and every offset past the break shifts.
  // Value:   'aaa bbb  ccc ddd'  — the first 'c' is at source offset 9.
  // Wrapped: 'aaa bbb\nccc ddd'  — and there it is at offset 8.
  const insertion = insertionOf('aaa bbb  ccc ddd', 9, true);
  expect(insertion?.value).toBe('aaa bbb\nccc ddd');
  expect(insertion?.caretOffset).toBe(8);
});

it('a caret at the end of the value sits one past the last character', () => {
  const insertion = insertionOf('aaa', 3, true);
  expect(insertion?.value).toBe('aaa');
  expect(insertion?.caretOffset).toBe(3);
  expect(insertion?.height).toBe(1);
  expect(insertion?.placeholder).toBeNull();
});

it('an EMPTY value publishes the `<empty>` placeholder and a caret at 0', () => {
  // The block still reads `<empty>` so the field keeps its line — as the
  // widget's PLACEHOLDER now, which is the renderable's own way of saying the
  // same thing the composed row said.
  const insertion = insertionOf('', 0, true);
  expect(insertion?.value).toBe('');
  expect(insertion?.caretOffset).toBe(0);
  expect(insertion?.height).toBe(1);
  expect(insertion?.placeholder).toBe('<empty>');
  // …and while the field is IDLE the same `<empty>` is a row of text.
  expect(body(renderTree(treeOf('', 0, false)))[1]).toBe('    <empty>');
});

it('no caret while the field is not active', () => {
  expect(insertionOf('aaa bbb ccc ddd', 8, false)).toBeUndefined();
});

it('the block belongs to the field that is active, never to another one', () => {
  // What `caret.row` being ABSOLUTE used to guard: the second field's block
  // began after the first field's label and its two wrapped rows, and an
  // off-by-one there put the cursor on somebody else's line. A node cannot be in
  // the wrong field's column, so the claim is stated as the structure it now is.
  const second: FieldDecl = { id: 'e', label: 'Second', kind: 'text' };
  const tree = renderDeclaredFieldsTree(
    [field, second],
    { active: 1, cursor: 1, d: 'aaa bbb ccc ddd', e: 'zz' },
    {},
    { width: 14 },
  );
  expect(nodeById(tree, 'field-d-input')).toBeUndefined();
  const insertion = nodeById(tree, 'field-e-input')?.props as Insertion;
  expect(insertion.value).toBe('zz');
  expect(insertion.caretOffset).toBe(1);
  // The idle field above still draws all three of its rows as text…
  expect(renderTree(tree)).toEqual([
    '  Description:',
    '    aaa bbb',
    '    ccc ddd',
    '▸ Second:',
  ]);
  // …and the block is the second child of the active field's own column.
  expect(childIdsOf(tree, 'field-e')).toEqual([
    'field-e-row-0',
    'field-e-input-row',
  ]);
});
