import type { VNode } from '@opentui/core';
import { expect, it } from 'vitest';
import type { FieldDecl } from '../../src/Form/index.js';
import { displayWidth } from '../../src/lib/width.js';
import { renderDeclaredFieldsTree } from '../../src/Widget/index.js';
import { FieldTextarea } from '../../src/Widget/textarea.js';
import { childIdsOf, nodeById, renderTree } from '../render-tree.js';

// BB-326 (widget-fit F2) — the filter screens' QUERY ROW gets a terminal
// cursor, exactly as the two `text` fields did.
//
// WHY, AND WHY NOT `InputRenderable`. The widget-fit decision doc named `Input`
// as F2's candidate and called it "the one place `InputRenderable` is genuinely
// right". Measured, it is not: `InputRenderable` forces `height = 1` and does
// not wrap, so at the popup's 54-column budget a 70-character query painted only
// its LAST 31 characters — the head of what the operator typed was off screen.
// The contract's reason for wrapping this row is precisely that ("never clipped,
// because the writer must be able to read back what they typed"), so the
// candidate contradicts the requirement rather than costing a little. Forcing
// `height = 2` and `wrapMode: 'word'` painted nothing at all.
//
// The renderable that DOES serve it is the one already adopted for `title` and
// `description`: `Widget/textarea.ts`'s controlled `FieldTextarea`, handed
// pre-wrapped rows and an offset, owning only the cell and the terminal cursor.
//
// BB-340 Task 9 — and it is a NODE in the field's own column now. The widget
// used to publish a caret that `Kernel/caret-slot.ts` placed absolutely over the
// composed query row; the block IS the query row, so nothing is painted twice and
// nothing rebases anything. What the caret's six numbers said is asserted here as
// the widget's props and its position among its field's children.
//
// The visible consequence, deliberate since BB-326: the query row's `▌` is
// GONE. It was a character in the row; the insertion point is a real cursor,
// which is the whole point of the operator's mosh decision (a repainted inverse
// cell cannot be locally predicted; a cursor can).

const parent: FieldDecl = {
  id: 'p',
  label: 'Parent',
  kind: 'autocomplete',
  from: 'parents',
  query: 'pq',
  pageSize: 50,
  absentNote: '(no project context — open a project to pick a parent)',
};

const candidates = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `k${i}`,
    label: `BB-${100 + i} · candidate ${i}`,
  }));

/** What the field's insertion-point widget declares, or nothing. */
interface Insertion {
  value?: string;
  caretOffset?: number;
  placeholder?: string | null;
  height?: number;
  width?: number;
}

interface Drawn {
  tree: VNode;
  rows: string[];
  insertion: Insertion | undefined;
}

const draw = (
  values: Record<string, unknown>,
  options: Record<string, unknown>,
  over: { active?: boolean; width?: number; error?: string } = {},
): Drawn => {
  const tree = renderDeclaredFieldsTree(
    [parent],
    { active: over.active === false ? -1 : 0, cursor: 0, ...values },
    options,
    {
      width: over.width ?? 58,
      ...(over.error === undefined
        ? {}
        : { errorFor: () => over.error as string }),
    },
  );
  const node = nodeById(tree, 'field-p-input');
  if (node !== undefined) expect(node.type).toBe(FieldTextarea);
  return {
    tree,
    rows: renderTree(tree),
    insertion: node?.props as Insertion | undefined,
  };
};

it('the query row no longer draws a `▌`: the insertion point is a cursor', () => {
  const { rows, insertion } = draw(
    { p: null, pq: 'BB-10' },
    { parents: candidates(3) },
  );
  expect(insertion?.value).toBe('search: BB-10');
  expect(rows.join('\n')).not.toContain('▌');
});

it('the widget OWNS the query row — it is not also a row of text', () => {
  // The claim that made the old double paint safe, one layer down: the
  // renderable was handed exactly the characters the composed row carried, so
  // painting over the row could not change the screen. There is one copy now,
  // and it is the widget's.
  const { tree, rows } = draw(
    { p: null, pq: 'BB-10' },
    { parents: candidates(3) },
  );
  expect(rows).not.toContain('    search: BB-10');
  // Row 0 is the picked value, then the block, then the suggestions — the order
  // the composed rows had, as the field's own children.
  const ids = childIdsOf(tree, 'field-p');
  expect(ids[0]).toBe('field-p-row-0');
  expect(ids[1]).toBe('field-p-input-row');
  expect(ids.length).toBeGreaterThan(2);
});

it('the block sits at the query row`s indent and reserves its rows', () => {
  const { tree, insertion } = draw(
    { p: null, pq: 'BB-10' },
    { parents: candidates(3) },
  );
  expect(
    (nodeById(tree, 'field-p-input-row')?.props as { paddingLeft?: number })
      ?.paddingLeft,
  ).toBe(4);
  expect(insertion?.height).toBe(1);
  // One column wider than the 54 the query may use: a cursor at the end of a row
  // sits one past its last character, and one outside the viewport would make
  // the editor scroll sideways.
  expect(insertion?.width).toBe(58 - 4 + 1);
  // The query is APPEND-ONLY — `Form/form.ts`'s autocomplete branch inserts at
  // the end and backspaces from the end — so the insertion point is the end of
  // the row, which is the cell the `▌` used to occupy.
  expect(insertion?.caretOffset).toBe('search: BB-10'.length);
});

it('an EMPTY query still has a block and still gets the cursor', () => {
  // `search: ` keeps its trailing space, so the cursor lands one column past the
  // colon-space — the same cell the `▌` sat in when nothing had been typed.
  const { insertion } = draw({ p: null, pq: '' }, { parents: candidates(3) });
  expect(insertion?.value).toBe('search: ');
  expect(insertion?.caretOffset).toBe(8);
  // Never empty — the row always carries its prefix — so nothing stands in.
  expect(insertion?.placeholder).toBeNull();
});

it('a query that WRAPS puts the cursor on the last wrapped row', () => {
  const long =
    'a-very-long-query-that-will-need-to-wrap-across-two-rows-for-sure-x';
  const { tree, insertion } = draw(
    { p: null, pq: long },
    { parents: candidates(3) },
  );
  expect(insertion?.height).toBeGreaterThan(1);
  // The block reserves exactly the rows the wrap produced — a disagreement here
  // is a row count the layout would reserve wrongly, which is what a single-row
  // assertion cannot catch.
  expect((insertion?.value ?? '').split('\n').length).toBe(insertion?.height);
  expect(
    (nodeById(tree, 'field-p-input-row')?.props as { height?: number })?.height,
  ).toBe(insertion?.height);
  expect(insertion?.caretOffset).toBe((insertion?.value ?? '').length);
  // …and no character of the query was lost on the way into it. Whitespace is
  // the only thing a break may eat — this query is one unbreakable token, so it
  // takes a soft break after `search:` and a hard one inside itself — which is
  // why the comparison ignores whitespace and nothing else.
  const flat = (text: string): string => text.replace(/\s+/g, '');
  expect(flat(insertion?.value ?? '')).toBe(flat(`search: ${long}`));
  // Every row of the block fits the query row's own budget.
  for (const row of (insertion?.value ?? '').split('\n')) {
    expect(displayWidth(row)).toBeLessThanOrEqual(58 - 4);
  }
});

it('an IDLE field has no block — the query row is not even drawn', () => {
  const { rows, insertion } = draw(
    { p: null, pq: 'BB-10' },
    { parents: candidates(3) },
    { active: false },
  );
  expect(rows.some((row) => row.includes('search:'))).toBe(false);
  expect(insertion).toBeUndefined();
});

it('an ABSENT bag has no block — there is no query row to sit on', () => {
  // The field draws its declaration's own note instead, and a cursor parked on
  // a note is a cursor on a row nobody can type into.
  const { rows, insertion } = draw({ p: null, pq: '' }, {});
  expect(rows[1]).toContain('(no project context');
  expect(insertion).toBeUndefined();
});

it('a FAILED bag has no block either', () => {
  const { rows, insertion } = draw(
    { p: null, pq: 'x' },
    { parents: [] },
    {
      error: '⚠ Parent options could not be loaded: boom',
    },
  );
  expect(rows[1]).toContain('could not be loaded');
  expect(insertion).toBeUndefined();
});
