// BB-294 AC 4 — one column-driven renderer, replacing two near-copy tables.
//
// BB-340 Task 7 — the renderer is `listTableTree` and its output is a VNode
// tree, so the cases that used to read a padded string read the NODES instead:
// the width a column declares, the gap the row declares, and the value a cell
// carries. What a reader must not conclude from that is that the layout stopped
// being asserted — it moved to where it is now decided. Padding, the column gap
// and truncation are Yoga's and the renderer's, and `tests-bun/Screen/list-table.test.ts`
// asserts all three against a real one (D8: this file may not measure display
// columns, or it becomes `lib/width.ts` under a third name).
import { expect, it } from 'vitest';
import { lineText } from '../../src/Component/section-list/index.js';
import {
  type ListColumn,
  type ListTable,
  listRowIds,
  listTableRows,
  listTableTree,
} from '../../src/Entity/collection.js';
import {
  BACKGROUND_ACTIVE,
  BOLD,
  DEFAULT_BACKGROUND,
  FOREGROUND,
  FOREGROUND_ACTIVE,
} from '../../src/lib/vnode.js';
import { cellValues, idsOf, nodeById } from '../render-tree.js';

interface Row {
  id: string;
  name: string;
  count: number;
}

const COLUMNS: readonly ListColumn<Row, void>[] = [
  {
    key: 'name',
    label: 'NAME',
    width: 6,
    fields: ['name'],
    get: (r) => r.name,
  },
  {
    key: 'count',
    label: 'N',
    width: 3,
    fields: ['count'],
    get: (r) => r.count,
  },
  {
    key: 'tail',
    label: 'TAIL',
    width: 0,
    fields: ['name'],
    get: (r) => `<${r.name}>`,
  },
];

/**
 * BB-345 — THE LIST, declared once, and the per-frame options beside it.
 *
 * `noun` and `emptyMessage` describe the list and moved into the configuration;
 * `selectedIndex` is the one member that changes between two frames of the same
 * list, so it stays a per-call option.
 */
const TABLE = {
  noun: 'probe',
  columns: COLUMNS,
  emptyMessage: 'none',
} as const satisfies ListTable<Row, void>;

const OPTIONS = { selectedIndex: -1 };

/** The node with this id, or a failure naming it. */
const node = (
  tree: ReturnType<typeof listTableTree>,
  id: string,
): NonNullable<ReturnType<typeof nodeById>> => {
  const found = nodeById(tree, id);
  if (found === undefined) throw new Error(`no node ${id}`);
  return found;
};

/** A node's props, by id — the layout a cell DECLARES. */
const propsOf = (
  tree: ReturnType<typeof listTableTree>,
  id: string,
): Record<string, unknown> => node(tree, id).props as Record<string, unknown>;

it('declares each column`s width, and carries the separator IN the cell', () => {
  const tree = listTableTree(
    TABLE,
    [{ id: 'r1', name: 'ab', count: 7 }],
    undefined,
    OPTIONS,
  );
  // BB-345 — the ` ` between two columns used to be the row's Yoga `gap`, and
  // a gap carries no text, so no attribute could paint it: the selected row's
  // highlight came out as one fragment per cell. The separator is a leading
  // blank column of the cell that FOLLOWS it now, which is why every cell but
  // the first is one column wider than its column declares. The row's total is
  // unchanged — the same `sum(width) + (n - 1)` the gap produced — and the
  // painted frame with it (`tests-bun/Screen/list-table-layout.test.ts`).
  expect(propsOf(tree, 'probe-cell-r1-name').width).toBe(6);
  expect(propsOf(tree, 'probe-cell-r1-count').width).toBe(3 + 1);
  expect(propsOf(tree, 'probe-row-r1').gap).toBe(0);
  expect(cellValues(node(tree, 'probe-header'))).toEqual([
    'NAME',
    ' N',
    ' TAIL',
  ]);
});

it('FILLS every budgeted cell to its own column, so a row-wide attribute is a bar', () => {
  // The raw `props.content`, deliberately not through `cellValues` — which
  // trims the fill precisely because every other suite asks what the row SAYS.
  // This is the node-level half of the operator's report; the painted half is
  // the one-inverse-run assertion in the Bun suite.
  const tree = listTableTree(
    TABLE,
    [{ id: 'r1', name: 'ab', count: 7 }],
    undefined,
    OPTIONS,
  );
  // NAME is 6 columns wide and first, so no separator: value plus four blanks.
  expect(propsOf(tree, 'probe-cell-r1-name').content).toBe('ab    ');
  // N is 3 wide and second: one separator column, the value, two blanks.
  expect(propsOf(tree, 'probe-cell-r1-count').content).toBe(' 7  ');
});

it('width 0 is the TRAILING column: no width, and it takes what is left', () => {
  const tree = listTableTree(
    TABLE,
    [{ id: 'r1', name: 'ab', count: 7 }],
    undefined,
    OPTIONS,
  );
  const tail = propsOf(tree, 'probe-cell-r1-tail');
  expect(tail.width).toBeUndefined();
  expect(tail.flexGrow).toBe(1);
  // BB-345 — the leading blank is the separator the row's `gap` used to be.
  expect(cellValues(node(tree, 'probe-row-r1')).at(-1)).toBe(' <ab>');
});

it('an over-wide value is CUT WITH AN ELLIPSIS, so the cut is legible', () => {
  // The regression this pins (BB-340, after Task 7): the renderer's own
  // `truncate` cuts at the last word boundary and adds nothing, so `cancelled`
  // in an 8-column STATE column reached the operator as `cancelle` — which
  // reads as a typo rather than as a truncation. `pad()` cut at `width - 1` and
  // appended `…`; the cell says the same thing now, and `truncate` stays on as
  // the renderer's backstop.
  const tree = listTableTree(
    TABLE,
    [{ id: 'r1', name: 'abcdefgh', count: 7 }],
    undefined,
    OPTIONS,
  );
  const name = propsOf(tree, 'probe-cell-r1-name');
  expect(name.content).toBe('abcde…');
  expect(name.truncate).toBe(true);
});

it('a value that FITS its column is untouched — no ellipsis at the edge', () => {
  // The other half of the boundary: cutting at `width` rather than at
  // `width - 1` would eat the last character of every exactly-fitting value.
  const tree = listTableTree(
    TABLE,
    [{ id: 'r1', name: 'abcdef', count: 7 }],
    undefined,
    OPTIONS,
  );
  expect(propsOf(tree, 'probe-cell-r1-name').content).toBe('abcdef');
});

it('the TRAILING column has no budget, so its value is never cut', () => {
  // `width: 0` means "unpadded, no budget" — the column takes what the fixed
  // ones left, and how much that is is Yoga's answer and not this file's. `pad`
  // rendered it raw for the same reason.
  const tree = listTableTree(
    TABLE,
    [{ id: 'r1', name: 'a-very-long-name-indeed', count: 7 }],
    undefined,
    OPTIONS,
  );
  // BB-345 — the value is still whole and still uncut; what follows it is the
  // fill a GROWING cell carries, which is over-long on purpose because nothing
  // declares how wide such a cell resolves to. `cellValues` is what strips it;
  // the raw prop is asserted here so that "the trailing column is never cut"
  // and "the trailing column is filled" are two separate failures.
  expect(propsOf(tree, 'probe-cell-r1-tail').content).toMatch(
    /^ <a-very-long-name-indeed> {500,}$/,
  );
});

it('no rows renders the header plus the empty message and nothing else', () => {
  const tree = listTableTree(
    { ...TABLE, emptyMessage: 'No rows.' },
    [],
    undefined,
    OPTIONS,
  );
  // BB-345 — the separator each cell after the first now carries; the empty
  // message is not a table row and carries none.
  expect(cellValues(tree)).toEqual(['NAME', ' N', ' TAIL', 'No rows.']);
});

it('threads the context into get, so a clock-dependent cell is possible', () => {
  const columns: readonly ListColumn<Row, number>[] = [
    {
      key: 'age',
      label: 'AGE',
      width: 0,
      fields: ['name'],
      get: (r, now) => now - r.count,
    },
  ];
  const tree = listTableTree(
    { noun: 'probe', columns, emptyMessage: 'none' },
    [{ id: 'r1', name: 'a', count: 10 }],
    30,
    OPTIONS,
  );
  // The lone column of this probe is a grower (`width: 0`), so its fill is the
  // over-long one — BB-345. What the cell SAYS is `20`.
  expect(propsOf(tree, 'probe-cell-r1-age').content).toMatch(/^20 {500,}$/);
});

it('renders null and undefined as an empty cell, as pad did', () => {
  const columns: readonly ListColumn<Row, void>[] = [
    { key: 'a', label: 'A', width: 3, fields: ['name'], get: () => null },
    { key: 'b', label: 'B', width: 0, fields: ['name'], get: () => undefined },
  ];
  const tree = listTableTree(
    { noun: 'probe', columns, emptyMessage: 'none' },
    [{ id: 'r1', name: 'x', count: 1 }],
    undefined,
    OPTIONS,
  );
  // BB-345 — an empty VALUE, which is what this pins, and the cell's fill
  // around it: `a` is 3 columns wide and first, `b` is the grower after it.
  expect(propsOf(tree, 'probe-cell-r1-a').content).toBe('   ');
  expect(propsOf(tree, 'probe-cell-r1-b').content).toMatch(/^ {501,}$/);
  expect(cellValues(node(tree, 'probe-row-r1'))).toEqual(['', '']);
});

it('every row STATES its highlight, so a moved cursor can clear the old one', () => {
  // The regression this pins: `patchTree` writes the props the next tree
  // declares and cannot clear one it omits. BB-375 — selection is FOREGROUND_ACTIVE fg
  // stated on every row (default fg on the unselected), not an INVERSE bit.
  const tree = listTableTree(
    TABLE,
    [
      { id: 'r1', name: 'a', count: 1 },
      { id: 'r2', name: 'b', count: 2 },
    ],
    undefined,
    { selectedIndex: 1 },
  );
  expect(propsOf(tree, 'probe-cell-r1-name').fg).toBe(FOREGROUND);
  expect(propsOf(tree, 'probe-cell-r1-name').bg).toBe(DEFAULT_BACKGROUND);
  expect(propsOf(tree, 'probe-cell-r2-name').fg).toBe(FOREGROUND_ACTIVE);
  expect(propsOf(tree, 'probe-cell-r2-name').bg).toBe(BACKGROUND_ACTIVE);
});

it('the header row is bold and the data rows are not', () => {
  // BB-345 — the finding this pins: `listTableTree` built a header row and
  // built it with `bold` unset, so the title line carried 14 bold cells, the tab
  // bar 48 and the selected row 73 inverse while the header row carried NONE and
  // read as one more data row.
  const tree = listTableTree(
    TABLE,
    [{ id: 'r1', name: 'ada', count: 1 }],
    undefined,
    { selectedIndex: -1 },
  );
  // Asserted on `attributes` and not on a `bold` prop, because there is no such
  // prop: `textNode` FOLDS `bold` and `selected` into the one `attributes` mask
  // the renderable actually carries. That mask is also why the data row's
  // assertion below is a real one rather than a tautology — `attributes` is
  // stated on every row, OFF included, since `applyProps` writes only what the
  // next tree declares and cannot clear a prop a later tree omits.
  expect((propsOf(tree, 'probe-header-name').attributes as number) & BOLD).toBe(
    BOLD,
  );
  expect(
    (propsOf(tree, 'probe-cell-r1-name').attributes as number) & BOLD,
  ).toBe(0);
});

it('a configuration may declare no header at all', () => {
  // The project picker is the one list that does: it is a question with choices
  // rather than a table of records (BB-345 D8).
  const tree = listTableTree(
    { ...TABLE, header: false },
    [{ id: 'r1', name: 'ada', count: 1 }],
    undefined,
    { selectedIndex: -1 },
  );
  expect(nodeById(tree, 'probe-header-name')).toBeUndefined();
  // BB-345 — the separators the cells after the first carry; unchanged
  // otherwise.
  expect(cellValues(tree)).toEqual(['ada', ' 1', ' <ada>']);
});

it('the pipe surface is built from the same configuration', () => {
  // BB-345 D7 — `bakers ui bakers.build-nnn | cat` has no layout, so it gets the same
  // list described as CELLS rather than rendered: each cell carries the value and
  // the column's own budget, and `lineText` joins them with one space. One
  // configuration therefore feeds both surfaces, which is what retires the last
  // per-entity column→SectionLine mapper (`runTableRows`).
  const lines = listTableRows(
    TABLE,
    [{ id: 'r1', name: 'ada', count: 1 }],
    undefined,
  );
  expect(lines[0]).toEqual({
    cells: [
      { text: 'NAME', width: 6 },
      { text: 'N', width: 3 },
      { text: 'TAIL', width: 0 },
    ],
  });
  expect(lines[1]).toEqual({
    cells: [
      { text: 'ada', width: 6 },
      { text: '1', width: 3 },
      { text: '<ada>', width: 0 },
    ],
  });
  // The pipe pads to NO budget — one space between columns is the whole
  // alignment, exactly as `lineText` already printed the run table's rows.
  expect(lineText(lines[1] ?? '')).toBe('ada 1 <ada>');
});

it('the piped list prints its empty message and nothing else', () => {
  expect(listTableRows(TABLE, [], undefined)).toEqual([
    {
      cells: [
        { text: 'NAME', width: 6 },
        { text: 'N', width: 3 },
        { text: 'TAIL', width: 0 },
      ],
    },
    'none',
  ]);
});

it('a headerless configuration prints headerless', () => {
  // The header follows `table.header` on BOTH surfaces, so the picker's "no
  // header" is one statement rather than two that have to agree.
  expect(listTableRows({ ...TABLE, header: false }, [], undefined)).toEqual([
    'none',
  ]);
});

it('the piped cells are the RAW values, never the tree`s truncated ones', () => {
  // `cellText`'s ellipsis exists because a Yoga budget cuts silently; a pipe has
  // no budget to cut against, and `runTableRows` emitted the raw value too. A
  // value cut here would be a cut nobody asked for.
  const [, row] = listTableRows(
    TABLE,
    [{ id: 'r1', name: 'abcdefgh', count: 1 }],
    undefined,
  );
  if (row === undefined || typeof row === 'string')
    throw new Error('the data row is not a columned row');
  expect(row.cells[0]?.text).toBe('abcdefgh');
});

it('the row ids come from the configuration, so they cannot be spelled twice', () => {
  // `listRowIds` and `listTableTree` read ONE `noun` now. The failure that makes
  // unrepresentable: a screen keying its rows one way while publishing another
  // spelling as the node a click lands on, whose only symptom is a click that
  // resolves to nothing.
  const rows = [{ id: 'r1', name: 'ada', count: 1 }];
  expect(listRowIds(TABLE, rows)).toEqual(['probe-row-r1']);
  expect(idsOf(listTableTree(TABLE, rows, undefined, OPTIONS))).toContain(
    'probe-row-r1',
  );
});

// BB-549 — a column may opt into sizing itself to its content, rather than
// cutting the one part (a ticket's number) a fixed width cannot predict.
const FIT_TABLE = {
  noun: 'fit',
  columns: [
    { ...COLUMNS[0], fit: true },
    ...COLUMNS.slice(1),
  ] as readonly ListColumn<Row, void>[],
  emptyMessage: 'none',
} as const satisfies ListTable<Row, void>;

it('a fit column grows to its longest value, so nothing is cut', () => {
  const tree = listTableTree(
    FIT_TABLE,
    [
      { id: 'r1', name: 'abcdefghijklmn', count: 7 },
      { id: 'r2', name: 'ab', count: 1 },
    ],
    undefined,
    OPTIONS,
  );
  expect(propsOf(tree, 'fit-cell-r1-name').content).toBe('abcdefghijklmn');
  expect(propsOf(tree, 'fit-cell-r1-name').width).toBe(14);
});

it('every row and the header share the one fitted width, so the column stays aligned', () => {
  const tree = listTableTree(
    FIT_TABLE,
    [
      { id: 'r1', name: 'abcdefghijklmn', count: 7 },
      { id: 'r2', name: 'ab', count: 1 },
    ],
    undefined,
    OPTIONS,
  );
  expect(propsOf(tree, 'fit-cell-r2-name').width).toBe(14);
  expect(propsOf(tree, 'fit-header-name').width).toBe(14);
  // The short row is PADDED to the fitted width, which is what alignment is.
  expect(propsOf(tree, 'fit-cell-r2-name').content).toBe('ab            ');
});

it('a fit column never shrinks below what it declares, or below its own header', () => {
  const tree = listTableTree(
    FIT_TABLE,
    [{ id: 'r1', name: 'a', count: 1 }],
    undefined,
    OPTIONS,
  );
  // NAME declares 6 and its label is 4 columns: the floor is the declaration.
  expect(propsOf(tree, 'fit-cell-r1-name').width).toBe(6);
});

it('a column without `fit` still cuts at its declared width', () => {
  const tree = listTableTree(
    TABLE,
    [{ id: 'r1', name: 'abcdefgh', count: 7 }],
    undefined,
    OPTIONS,
  );
  expect(propsOf(tree, 'probe-cell-r1-name').content).toBe('abcde…');
});
