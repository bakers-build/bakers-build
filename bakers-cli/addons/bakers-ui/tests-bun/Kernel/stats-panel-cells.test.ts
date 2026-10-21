import { describe, expect, it } from 'bun:test';
import { BoxRenderable } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import {
  type SectionCells,
  sectionRowNode,
  sectionRows,
} from '../../src/Component/section-list/index.js';
import { statsPanelRows } from '../../src/Component/stats-panel/index.js';
import { mountTree } from '../../src/Kernel/mount.js';
import { columnNode } from '../../src/lib/vnode.js';

// BB-340 Task 13 — THE DASHBOARD'S COLUMNS ARE YOGA'S, AND THIS IS WHERE THAT
// IS CHECKED.
//
// `Component/stats-panel` used to compose a bar row into ONE STRING: the label
// fitted to a field by `lib/format.ts`'s `pad`, the counts right-aligned by a
// local `padNumber`. Both measured display columns (`lib/width.ts`), and both are
// gone — a row states its cells and their budgets, and the renderer places them.
//
// The claim below is the one a tree assertion cannot make: that the picture the
// renderer draws from those budgets is a column-aligned table. It is read off
// `captureCharFrame()` for that reason (spec D8), which is also why it is here
// and not beside `tests/Component/stats-panel/index.test.ts`.
//
// The Node suite's own claim is the structural half — every row of a block
// declares the same budgets in the same order — and neither half implies the
// other: identical budgets drawn by a renderer that ignored them would still
// pass there.

const BLOCK = statsPanelRows(
  [
    { label: 'bakers', numbers: [8, 53, 170] },
    { label: '— unattributed', numbers: [0, 1, 1658] },
  ],
  { columns: ['24h', '7d', '30d'], title: 'Tickets' },
);

const render = async (lines: SectionCells[], width = 80): Promise<string[]> => {
  const rows = sectionRows([{ heading: 'PER PROJECT', lines }]);
  const setup = await createTestRenderer({ width, height: rows.length + 2 });
  const shell = new BoxRenderable(setup.renderer, {
    id: 'shell',
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    flexDirection: 'column',
  });
  setup.renderer.root.add(shell);
  mountTree(
    setup.renderer,
    shell,
    columnNode('block', ...rows.map((row) => sectionRowNode('dashboard', row))),
  );
  await setup.renderOnce();
  const frame = setup.captureCharFrame().split('\n');
  setup.renderer.destroy();
  return frame;
};

describe('a bar block is drawn as a table', () => {
  it('draws the label, the bar and the counts in fixed columns', async () => {
    const frame = await render(BLOCK as SectionCells[]);

    // The geometry, stated once: a label column of 29 (the two-column indent
    // plus 27 of text), the 20-column bar, and three 8-column counts, each pair
    // one column apart — `rowNode`'s `gap`. So the bar occupies columns 30-49
    // and the counts end at 58, 67 and 76.
    //
    // Row 0 is the section heading `sectionRows` puts above the block.
    expect(frame[1]).toBe(
      `  Tickets${' '.repeat(47)}24h${' '.repeat(7)}7d${' '.repeat(6)}30d   `,
    );
    expect(frame[2]).toBe(
      `  bakers${' '.repeat(24)}██${'░'.repeat(18)}${' '.repeat(8)}8${' '.repeat(7)}53${' '.repeat(6)}170   `,
    );
    expect(frame[3]).toBe(
      `  — unattributed${' '.repeat(14)}${'█'.repeat(20)}${' '.repeat(8)}0${' '.repeat(8)}1${' '.repeat(5)}1658   `,
    );
  });

  it('right-aligns every count against the same column, whatever its width', async () => {
    const frame = await render(BLOCK as SectionCells[]);
    // A count ENDS where its column ends. `8` and `1658` are three digits apart
    // and must still finish in the same place — the property `padNumber`
    // produced by subtracting `displayWidth(value)` from the field, and the one
    // a left-aligned cell would silently lose.
    const endsAt = (row: string, value: string): number =>
      row.indexOf(value, 30) + value.length;
    expect(endsAt(frame[2] ?? '', '8')).toBe(endsAt(frame[3] ?? '', '0'));
    expect(endsAt(frame[2] ?? '', '170')).toBe(endsAt(frame[3] ?? '', '1658'));
    // …and the column titles end there too, so `30d` really does caption the
    // month rather than sitting one field to its left.
    expect(endsAt(frame[1] ?? '', '30d')).toBe(endsAt(frame[2] ?? '', '170'));
  });

  it('holds a label inside its own column rather than pushing the bar right', async () => {
    // A label longer than its budget is CUT BY THE RENDERER (`truncate`), which
    // is what `pad`'s ellipsis used to do — and the bar after it does not move,
    // which is what the block being readable depends on.
    const long = statsPanelRows([
      { label: 'a-very-long-project-name-that-will-not-fit', numbers: [1] },
      { label: 'x', numbers: [1] },
    ]) as SectionCells[];
    const frame = await render(long);

    const barAt = (row: string): number => row.search(/[█░]/);
    expect(barAt(frame[1] ?? '')).toBe(barAt(frame[2] ?? ''));
    expect(barAt(frame[1] ?? '')).toBeGreaterThan(0);
    // The label stops before the bar's column: one blank between them at least,
    // which is the gap the old `LABEL_GAP` constant existed to guarantee.
    expect((frame[1] ?? '')[barAt(frame[1] ?? '') - 1]).toBe(' ');
  });

  it('a wide-character label cannot shift the numbers', async () => {
    // Spec R9's neighbour, and the one case the budgets alone cannot settle: a
    // CJK label is two columns per character, so only a real renderer can say
    // whether the bar after it still starts where an ascii row's does.
    const wide = statsPanelRows([
      { label: 'ascii', numbers: [1] },
      { label: '日本語テスト', numbers: [2] },
    ]) as SectionCells[];
    const frame = await render(wide);

    // COUNTED FROM THE RIGHT EDGE, and that is not fussiness: a captured frame
    // holds a wide character as ONE JS character covering TWO columns, so an
    // index into the row is not its column and the CJK row is 74 characters of
    // an 80-column line. Everything from the bar rightwards is narrow, so a
    // distance measured back from the end IS a column distance — and asserting
    // it with `displayWidth` instead would put this ticket's own deleted
    // measurement into the test that checks it is gone (D8).
    const barEndsFromRight = (row: string): number =>
      row.length - (row.search(/[█░]/) + 20);
    expect(barEndsFromRight(frame[1] ?? '')).toBe(
      barEndsFromRight(frame[2] ?? ''),
    );
    expect(barEndsFromRight(frame[1] ?? '')).toBeGreaterThan(0);
  });
});
