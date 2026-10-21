// The TICKET list's table: its columns, their order and the values they carry.
//
// BB-340 Task 7 — it was `ticketTableRows`, a component wrapping
// `lib/table.ts`. Both are gone: the list screen builds the table itself from
// `TICKET_COLUMNS` through `listTableTree`, so this drives that pair directly and
// reads the CELLS rather than a padded line. The one case that cannot be made
// here any more is the fixed-column offset — the columns are placed by Yoga now,
// so it is asserted against a real renderer in
// `tests-bun/Screen/list-table.test.ts`.
import { expect, it } from 'vitest';
import { listTableTree } from '../../../../src/Entity/collection.js';
import {
  TICKET_TABLE,
  type TicketRow,
} from '../../../../src/Entity/ticket/Data/tickets.js';
import { cellValues, nodeById } from '../../../render-tree.js';

const table = (
  tickets: TicketRow[],
  emptyMessage?: string,
): ReturnType<typeof listTableTree> =>
  listTableTree(
    emptyMessage === undefined
      ? TICKET_TABLE
      : { ...TICKET_TABLE, emptyMessage },
    tickets,
    undefined,
    { selectedIndex: -1 },
  );

/** The cell texts of one node, in column order. */
const cells = (
  tree: ReturnType<typeof listTableTree>,
  id: string,
): string[] => {
  const node = nodeById(tree, id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return cellValues(node);
};

/** A node's props, by id — the layout a cell DECLARES. */
const propsOf = (
  tree: ReturnType<typeof listTableTree>,
  id: string,
): Record<string, unknown> => {
  const node = nodeById(tree, id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return node.props as Record<string, unknown>;
};

const TICKET: TicketRow = {
  id: 't1',
  identifier: 'BB-1',
  title: 'A title',
  state: 'spec',
  priority: 2,
  assigneeInitials: 'CW',
  ownerInitials: 'JD',
  derivedStatus: 'running',
  labels: ['bug'],
  parent: 'BB-175',
  conductor: 'cw-framework',
} as TicketRow;

it('renders a header and one row per ticket, cell by cell', () => {
  const tree = table([TICKET]);
  expect(cells(tree, 'ticket-row-t1')).toEqual([
    'BB-1',
    // The blank leading every cell but the first is the column SEPARATOR
    // (BB-345): it was the row's Yoga `gap`, which carries no text and so
    // could not be painted by the selected row's highlight. The row's total
    // width is unchanged, and so is the painted frame.
    ' spec',
    ' 2',
    ' CW',
    ' JD',
    ' running',
    ' BB-175',
    ' cw-framework',
    ' A title  [bug]',
  ]);
});

it('RUN cell prefers stall_reason over derived_status', () => {
  const row = cells(
    table([
      {
        ...TICKET,
        derivedStatus: 'running',
        stallReason: 'frozen',
      } as TicketRow,
    ]),
    'ticket-row-t1',
  );
  expect(row).toContain(' frozen');
  expect(row).not.toContain(' running');
});

it('header names PARENT + COND between RUN and TITLE', () => {
  expect(cells(table([]), 'ticket-header')).toEqual([
    'IDENTIFIER',
    ' STATE',
    ' PRIO',
    ' WHO',
    ' BY',
    ' RUN',
    ' PARENT',
    ' COND',
    ' TITLE',
  ]);
});

it('row shows parent identifier + conductor label (AC-1/3)', () => {
  const row = cells(
    table([{ ...TICKET, identifier: 'BB-193', title: 'T', state: 'coding' }]),
    'ticket-row-t1',
  );
  expect(row).toContain(' BB-175');
  expect(row).toContain(' cw-framework');
});

it('null parent/conductor render the — sentinel (AC-2/4)', () => {
  const row = cells(
    table([
      {
        ...TICKET,
        title: 'T',
        state: 'todo',
        priority: null,
        assigneeInitials: '',
        ownerInitials: '',
        derivedStatus: 'idle',
        parent: null,
        conductor: null,
        labels: undefined,
      } as TicketRow,
    ]),
    'ticket-row-t1',
  );
  // PRIO, WHO, BY, PARENT and COND all fall back to the sentinel.
  expect(row.filter((cell) => cell === ' —')).toHaveLength(5);
});

it('an over-long conductor label is cut at the column WITH AN ELLIPSIS', () => {
  // COND is 14 columns: 13 of the label plus the `…` that says the rest was
  // removed, so a cut label cannot be read as the whole one. See the Bun case
  // for the painted clip and for TITLE keeping its offset either way.
  const row = cells(
    table([
      { ...TICKET, conductor: 'a-really-long-conductor-name-way-over-14' },
    ]),
    'ticket-row-t1',
  );
  // The leading blank is the column separator (BB-345); the ellipsis is
  // `cellText`'s and is unaffected by the fill, which is appended after it.
  expect(row).toContain(' a-really-long…');
});

it('an empty project renders the header and the empty message, and no row', () => {
  const tree = table([]);
  expect(cellValues(tree).at(-1)).toBe('No tickets.');
  expect(nodeById(tree, 'ticket-row-t1')).toBeUndefined();
});

it('a custom emptyMessage overrides the default when there are no rows', () => {
  expect(
    cellValues(table([], 'No tasks match the current search/filters.')).at(-1),
  ).toBe('No tasks match the current search/filters.');
});

it('a long project prefix keeps its ticket number, and the column stays aligned', () => {
  const tree = table([
    { ...TICKET, id: 't1', identifier: 'ANERKENNUNGSPORTAL-123' },
    { ...TICKET, id: 't2', identifier: 'BB-7' },
  ]);
  const long = propsOf(tree, 'ticket-cell-t1-identifier');
  const short = propsOf(tree, 'ticket-cell-t2-identifier');
  expect(long.content).toBe('ANERKENNUNGSPORTAL-123');
  expect(short.width).toBe(long.width);
  // The title is still the row's grower and declares no width of its own.
  expect(propsOf(tree, 'ticket-cell-t1-title').width).toBeUndefined();
});
