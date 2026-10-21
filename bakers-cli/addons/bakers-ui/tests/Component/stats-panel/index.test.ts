import { describe, expect, it } from 'vitest';
import type { SectionCells } from '../../../src/Component/section-list/index.js';
import {
  BAR_EMPTY,
  BAR_FULL,
  BAR_WIDTH,
  statsPanelRows,
} from '../../../src/Component/stats-panel/index.js';
import type { Cell } from '../../../src/lib/vnode.js';

// BB-256 spec D11 — `/usage`-style bar rows. Entity-agnostic by construction:
// nothing below mentions a ticket, a run, a project or a user, because the
// component's own types do not.
//
// BB-340 Task 13 — the rows are CELLS, not padded strings. The component
// states each column's Yoga budget and the renderer places the value inside it,
// so nothing here measures a display column any more. What a cell is worth in
// columns on a real terminal is asserted where it can be: `tests-bun`, against
// real Yoga (spec D8).

/** The cells of row `index`; it must be a columned row, never prose. */
const cellsOf = (
  rows: ReturnType<typeof statsPanelRows>,
  index: number,
): readonly Cell[] => {
  const row = rows[index];
  if (row === undefined || typeof row === 'string')
    throw new Error(`row ${index} is not a columned row: ${String(row)}`);
  return (row as SectionCells).cells;
};

/** The bar cell of a row — the one whose text is made of bar glyphs. */
const barOf = (
  rows: ReturnType<typeof statsPanelRows>,
  index: number,
): string =>
  cellsOf(rows, index).find((cell) =>
    new RegExp(`^[${BAR_FULL}${BAR_EMPTY}]+$`).test(cell.text),
  )?.text ?? '';

/** The texts of the cells the component right-aligns — the number columns. */
const numbersOf = (
  rows: ReturnType<typeof statsPanelRows>,
  index: number,
): string[] =>
  cellsOf(rows, index)
    .filter((cell) => cell.right === true)
    .map((cell) => cell.text);

describe('the bar is scaled to the largest value in its OWN group', () => {
  it('renders the largest row full and a zero row empty', () => {
    const rows = statsPanelRows([
      { label: 'Last 24 hours', numbers: [0] },
      { label: 'Last 7 days', numbers: [38] },
      { label: 'Last 30 days', numbers: [237] },
    ]);

    expect(barOf(rows, 0)).toBe(BAR_EMPTY.repeat(BAR_WIDTH));
    expect(barOf(rows, 2)).toBe(BAR_FULL.repeat(BAR_WIDTH));
    // The middle row is proportional to the group's own maximum, not to a quota:
    // there is no quota here, which is the one place the `/usage` analogy breaks.
    expect(barOf(rows, 1)).toBe(
      BAR_FULL.repeat(3) + BAR_EMPTY.repeat(BAR_WIDTH - 3),
    );
  });

  it('scales against its own group, so the same value differs between groups', () => {
    const small = statsPanelRows([
      { label: 'a', numbers: [5] },
      { label: 'b', numbers: [10] },
    ]);
    const large = statsPanelRows([
      { label: 'a', numbers: [5] },
      { label: 'b', numbers: [1000] },
    ]);

    expect(barOf(small, 0)).toBe(
      BAR_FULL.repeat(BAR_WIDTH / 2) + BAR_EMPTY.repeat(BAR_WIDTH / 2),
    );
    expect(barOf(large, 0)).toBe(BAR_EMPTY.repeat(BAR_WIDTH));
  });

  it('renders an all-zero group as empty bars, not a division by zero', () => {
    const rows = statsPanelRows([
      { label: 'Last 24 hours', numbers: [0] },
      { label: 'Last 7 days', numbers: [0] },
    ]);

    rows.forEach((_row, index) => {
      expect(numbersOf(rows, index).join()).not.toContain('NaN');
      expect(barOf(rows, index)).toBe(BAR_EMPTY.repeat(BAR_WIDTH));
    });
  });

  it('every bar is exactly BAR_WIDTH glyphs, in a cell of that budget', () => {
    const rows = statsPanelRows([
      { label: 'a', numbers: [1] },
      { label: 'b', numbers: [7] },
      { label: 'c', numbers: [999] },
    ]);
    rows.forEach((_row, index) => {
      // Both halves matter: the glyph count is the bar's own claim, and the cell
      // budget is what stops a wider bar pushing the numbers out of their column.
      expect(barOf(rows, index)).toHaveLength(BAR_WIDTH);
      const bar = cellsOf(rows, index).find(
        (cell) => cell.text === barOf(rows, index),
      );
      expect(bar?.width).toBe(BAR_WIDTH);
    });
  });
});

describe('a breakdown row carries all three windows', () => {
  // Spec D11: the breakdown shows the three windows TOGETHER and uses the bar for
  // the month, so AC-5/AC-6 hold without a hidden `d`/`w`/`m` keystroke.
  const rows = statsPanelRows(
    [
      { label: 'alpha', numbers: [7, 38, 237] },
      { label: 'beta', numbers: [0, 2, 16] },
    ],
    { columns: ['24h', '7d', '30d'] },
  );

  it('prints a column header above the numbers', () => {
    expect(numbersOf(rows, 0)).toEqual(['24h', '7d', '30d']);
    // The header names the columns and nothing else — no bar, no label.
    expect(barOf(rows, 0)).toBe('');
    expect(cellsOf(rows, 0).map((cell) => cell.text)).not.toContain('alpha');
  });

  it('prints all three numbers plus a bar for the month', () => {
    expect(cellsOf(rows, 1)[0]?.text).toContain('alpha');
    expect(numbersOf(rows, 1)).toEqual(['7', '38', '237']);
    // The month is the largest of the group, so its bar is full.
    expect(barOf(rows, 1)).toBe(BAR_FULL.repeat(BAR_WIDTH));
  });

  it('scales the bar by the MONTH column, not by the first number', () => {
    // `beta`'s day count is 0 while its month count is 16/237 of the maximum —
    // a bar keyed on the first number would render it empty and misreport it.
    expect(barOf(rows, 2)).not.toBe(BAR_EMPTY.repeat(BAR_WIDTH));
  });
});

describe('a group title fills the header row’s label field', () => {
  // BB-324 D4 — the caller names a group; the component stays entity-neutral
  // and only knows it was handed a string.

  it('emits a header row for a title alone, with no bar and no columns', () => {
    const rows = statsPanelRows([{ label: 'alpha', numbers: [7] }], {
      title: 'Tickets',
    });

    expect(rows).toHaveLength(2);
    expect(cellsOf(rows, 0)[0]?.text).toContain('Tickets');
    expect(barOf(rows, 0)).toBe('');
    expect(numbersOf(rows, 0)).toEqual([]);
  });

  it('puts the title over the labels and the column titles over the numbers', () => {
    const rows = statsPanelRows(
      [
        { label: 'alpha', numbers: [7, 38, 237] },
        { label: 'beta', numbers: [0, 2, 16] },
      ],
      { columns: ['24h', '7d', '30d'], title: 'Runs' },
    );

    expect(cellsOf(rows, 0)[0]?.text).toContain('Runs');
    expect(numbersOf(rows, 0)).toEqual(['24h', '7d', '30d']);
    expect(barOf(rows, 0)).toBe('');
    // ONE GEOMETRY, and the structural form of the claim the padded rows made by
    // measuring: the header and every data row declare the same cell budgets in
    // the same order, so Yoga cannot put the title anywhere but over the labels.
    const budgets = (index: number): (number | undefined)[] =>
      cellsOf(rows, index).map((cell) => cell.width);
    expect(budgets(0)).toEqual(budgets(1));
    expect(budgets(1)).toEqual(budgets(2));
  });

  it('renders the columns-only header exactly as it did without the option', () => {
    // The no-title call must be unchanged — the reason the older
    // "the header names no label" assertion above still holds.
    const withoutTitle = statsPanelRows(
      [{ label: 'alpha', numbers: [1, 2, 3] }],
      { columns: ['24h', '7d', '30d'] },
    );
    const withEmptyTitle = statsPanelRows(
      [{ label: 'alpha', numbers: [1, 2, 3] }],
      { columns: ['24h', '7d', '30d'], title: '' },
    );
    expect(withEmptyTitle[0]).toEqual(withoutTitle[0]);
  });

  it('emits no header row at all when neither option is given', () => {
    const rows = statsPanelRows([{ label: 'alpha', numbers: [1] }]);
    expect(rows).toHaveLength(1);
    expect(cellsOf(rows, 0)[0]?.text).toContain('alpha');
  });
});

describe('the columns are budgets, and nothing pads them', () => {
  it('a label reaches its cell as the caller wrote it', () => {
    // The whole of the change BB-340 Task 13 makes: `pad` used to fill the
    // label to its field here, which needed `lib/width.ts` to measure it in
    // display columns first. The cell carries the value and its budget; the
    // renderer places it (R5/D8).
    const rows = statsPanelRows([{ label: 'x'.repeat(200), numbers: [1] }]);
    expect(cellsOf(rows, 0)[0]?.text).toBe(`  ${'x'.repeat(200)}`);
    expect(cellsOf(rows, 0)[0]?.text).not.toContain('…');
  });

  it('a wide-character label declares the same budget as an ascii one', () => {
    // Spec R9's neighbour: the numbers cannot be shifted by a CJK label, because
    // the label's column is a budget rather than a count of characters.
    const rows = statsPanelRows([
      { label: 'ascii', numbers: [1] },
      { label: '日本語テスト', numbers: [2] },
    ]);
    expect(cellsOf(rows, 0).map((c) => c.width)).toEqual(
      cellsOf(rows, 1).map((c) => c.width),
    );
  });

  it('every number column is right-aligned in the same budget', () => {
    const rows = statsPanelRows(
      [
        { label: 'a', numbers: [1, 2, 3] },
        { label: 'b', numbers: [100, 2000, 30000] },
      ],
      { columns: ['24h', '7d', '30d'] },
    );
    for (const index of [0, 1, 2]) {
      const numbers = cellsOf(rows, index).filter((c) => c.right === true);
      expect(numbers).toHaveLength(3);
      expect(new Set(numbers.map((c) => c.width)).size).toBe(1);
    }
  });
});

describe('an empty row set renders the caller’s message', () => {
  it('renders the empty message as prose and no bar', () => {
    // Spec R7 — an empty control plane must say so, not render an empty body
    // that reads as a failed load. Prose, not columns: there is nothing to align.
    const rows = statsPanelRows([], {
      emptyMessage: 'No activity in the last 30 days.',
    });
    expect(rows).toEqual(['  No activity in the last 30 days.']);
  });

  it('renders nothing at all when the caller offers no message', () => {
    expect(statsPanelRows([])).toEqual([]);
  });
});
