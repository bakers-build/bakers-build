import { expect, it } from 'vitest';
import type { SectionCells } from '../../../src/Component/section-list/index.js';
import { teamMemberWorkloadRows } from '../../../src/Component/team-member-workload-list/index.js';

it('renders zero-work members alongside active members', () => {
  const rows = teamMemberWorkloadRows([
    { userId: 'u1', label: 'Ada', open: 2, running: 1, waiting: 1 },
    { userId: 'u2', label: 'Grace', open: 0, running: 0, waiting: 0 },
  ]);

  expect(rows).toHaveLength(3);
  expect((rows[0] as SectionCells).cells.map((cell) => cell.text)).toEqual([
    'Member',
    'Open',
    'Running',
    'Waiting',
  ]);
  expect((rows[2] as SectionCells).cells.map((cell) => cell.text)).toEqual([
    'Grace',
    '0',
    '0',
    '0',
  ]);
});

it('gives the member column a narrow floor and fixed count columns', () => {
  const rows = teamMemberWorkloadRows([
    {
      userId: 'u1',
      label: 'A very long member name',
      open: 1,
      running: 1,
      waiting: 0,
    },
  ]);
  const cells = (rows[1] as SectionCells).cells;

  expect(
    cells.map(({ width, min, grow, right }) => ({ width, min, grow, right })),
  ).toEqual([
    { width: 24, min: 12, grow: 1, right: undefined },
    { width: 9, min: undefined, grow: undefined, right: true },
    { width: 9, min: undefined, grow: undefined, right: true },
    { width: 9, min: undefined, grow: undefined, right: true },
  ]);
});
