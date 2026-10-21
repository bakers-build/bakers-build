import { expect, it } from 'vitest';
import type { SectionCells } from '../../../src/Component/section-list/index.js';
import {
  sectionRowNode,
  sectionRows,
} from '../../../src/Component/section-list/index.js';
import { workloadSummaryRows } from '../../../src/Component/workload-summary/index.js';
import { childrenOf } from '../../render-tree.js';

it('renders compact labelled counters with stable narrow-screen floors', () => {
  const rows = workloadSummaryRows([
    ['Open', 4],
    ['Running', 1],
    ['Waiting', 3],
    ['Unassigned', 2],
  ]);

  expect(rows).toHaveLength(1);
  const cells = (rows[0] as SectionCells).cells;
  expect(cells.map((cell) => cell.text)).toEqual([
    'Open 4',
    'Running 1',
    'Waiting 3',
    'Unassigned 2',
  ]);
  expect(cells.map(({ width, min, grow }) => ({ width, min, grow }))).toEqual([
    { width: 16, min: 8, grow: 1 },
    { width: 16, min: 8, grow: 1 },
    { width: 16, min: 8, grow: 1 },
    { width: 16, min: 8, grow: 1 },
  ]);
});

it('carries flexible counter budgets through the shared cell renderer', () => {
  const [row] = sectionRows([
    { heading: 'Current work', lines: workloadSummaryRows([['Open', 4]]) },
  ]).filter(({ cells }) => cells !== undefined);
  if (!row) throw new Error('counter row missing');

  const [cell] = childrenOf(sectionRowNode('work', row));
  expect(cell?.props).toMatchObject({
    width: 16,
    minWidth: 8,
    flexGrow: 1,
  });
});
