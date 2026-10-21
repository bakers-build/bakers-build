// BB-294 AC 6 — the rendering is frozen BEFORE the refactor and asserted after.
// Exact strings, not patterns: the existing table suites match /BB-1/ and friends,
// which would pass through a changed column width, a lost label suffix or a
// reordered header. This one would not.
//
// BB-340 Task 7 — the two tables are no longer one renderer, so this file is no
// longer one shape twice. The TICKET table is the tree the list screen hands over,
// so its identity is the CELLS: the same values in the same column order, with the
// padding that used to sit between them now Yoga's business and asserted against a
// real renderer in `tests-bun/Screen/list-table.test.ts`.
//
// Task 13 made the RUN table's rows cells too. Its identity is therefore the same
// claim in the same form — the values, in column order, with their budgets — and
// the `text` beside it is what a surface with no layout prints. That text CHANGED
// with the operator's approval (it was column-padded), so it is re-pinned here
// rather than dropped: it is still the ticket detail's piped Runs section, and a
// lost column or a reordered header must still fail loudly.
//
// BB-345 Task 4 — the mapper this pins is `listTableRows(RUN_TABLE, …)` now,
// not `run-table`'s own `runTableRows`, which is deleted. The IMPORT moved; not
// one expectation did, which is the evidence the pipe's bytes did not move with
// the renderer.
//
// WHICH TERMINAL WIDTH DOES THIS PIN BELONG TO? None, and that is the point of
// it (BB-345 Task 8). Every expectation below is read off the TREE, which is
// built before Yoga has seen a terminal: a cell's value is cut against its own
// COLUMN's declared width and never against the screen's, so the same eight
// cells come out at 80, 120 and 160 columns alike. That is exactly the property
// spec D4 asks for — column widths that do not depend on the page or on the
// window — and a pin that moved with the terminal would be evidence against it.
//
// The GEOMETRY those cells are placed in is Yoga's answer and is pinned where
// it exists: `tests-bun/Screen/list-table-layout.test.ts`, on a real renderer,
// at 80, 120 and 160 columns. This file therefore asserts two things and
// deliberately not a third — the cell VALUES in column order, and the NODE IDS
// the tree keys them under (the identity `Kernel/mount.ts` patches by, and the
// one a click resolves through) — while measuring no columns at all.
//
// The blank leading every cell but the first is the column SEPARATOR (BB-345).
// It was the row's Yoga `gap` until the selection highlight became a continuous
// bar; a gap carries no text and so could not be painted, and it is a column of
// the following cell now. The row's total width is unchanged, and so is the
// painted frame — which is why the whole Bun suite passed that change with no
// pin moved.
import { expect, it } from 'vitest';
import {
  lineText,
  type SectionLine,
} from '../../src/Component/section-list/index.js';
import {
  listRowIds,
  listTableRows,
  listTableTree,
} from '../../src/Entity/collection.js';
import type { RunRow } from '../../src/Entity/run/Data/runs.js';
import { RUN_TABLE, TICKET_RUN_TABLE } from '../../src/Entity/run/Data/runs.js';
import type { TicketRow } from '../../src/Entity/ticket/Data/tickets.js';
import { TICKET_TABLE } from '../../src/Entity/ticket/Data/tickets.js';
import { cellValues, idsOf, nodeById } from '../render-tree.js';

/** One run row's cells as `[text, budget]` pairs, in column order. */
const runCells = (line: SectionLine | undefined): [string, number][] => {
  // BB-372 D3/D11 — `SectionLine` has a THIRD variant now (a rendered
  // `StyledLine`), so `not a string` no longer means `columns`. The row this
  // helper is handed is a run-table row and must really carry cells; asking for
  // `cells` is what says so.
  if (line === undefined || typeof line === 'string' || !('cells' in line))
    throw new Error(`not a columned row: ${JSON.stringify(line)}`);
  return line.cells.map((cell) => [cell.text, cell.width ?? -1]);
};

const ticketTable = (tickets: TicketRow[], emptyMessage = 'No tickets.') =>
  listTableTree({ ...TICKET_TABLE, emptyMessage }, tickets, undefined, {
    selectedIndex: -1,
  });

const cellsOf = (tickets: TicketRow[], id: string): string[] => {
  const node = nodeById(ticketTable(tickets), id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return cellValues(node);
};

const TICKET: TicketRow = {
  id: 'uuid-1',
  identifier: 'BB-294',
  title: 'Centralize the TUI list logic',
  state: 'spec',
  priority: 3,
  assigneeInitials: 'CW',
  ownerInitials: 'JD',
  derivedStatus: 'running',
  labels: ['work:code'],
  type: 'bb_chore',
  parent: 'BB-292',
  conductor: 'cw-framework',
  closed: false,
  frozen: false,
  stallReason: '',
};

const RUN: RunRow = {
  id: 'run-uuid-1',
  drupalId: 4784,
  ticketId: 'uuid-1',
  ticketIdentifier: 'BB-294',
  state: 'running',
  phase: 'spec',
  agent: 'claude',
  startedAt: '2026-08-06T12:00:00+00:00',
  heartbeat: '2026-08-06T12:04:00+00:00',
  claimExpiresAt: '2026-08-06T14:00:00+00:00',
  closed: false,
};

// A fixed clock: 5 minutes after the run started, and inside the claim window, so
// `deriveRunStatus` and `runStartedAge` are both deterministic.
const NOW = Math.floor(Date.parse('2026-08-06T12:05:00+00:00') / 1000);

it('the ticket table header is cell-identical', () => {
  expect(cellsOf([], 'ticket-header')).toEqual([
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

it('the ticket table row is cell-identical', () => {
  expect(cellsOf([TICKET], 'ticket-row-uuid-1')).toEqual([
    'BB-294',
    ' spec',
    ' 3',
    ' CW',
    ' JD',
    ' running',
    ' BB-292',
    ' cw-framework',
    ' Centralize the TUI list logic  [work:code]',
  ]);
});

it('the ticket table keys every node on the ENTITY, cell by cell', () => {
  // BB-345 Task 8 — the other half of "identity", and the half a value pin
  // cannot make: a re-sort moves a row's cells onto another row's node unless
  // the id says which ticket this is. `rowNodeId(noun, uuid)` is the row's, the
  // COLUMN's own key is the cell's, and both come off the one configuration —
  // so a screen can no longer publish one spelling as the click target while
  // keying its rows under another.
  const ids = idsOf(ticketTable([TICKET]));
  expect(ids).toContain('ticket-table');
  expect(ids).toContain('ticket-header');
  expect(ids).toContain('ticket-header-identifier');
  expect(ids).toContain('ticket-row-uuid-1');
  expect(ids).toContain('ticket-cell-uuid-1-identifier');
  expect(ids).toContain('ticket-cell-uuid-1-title');
  // No id is spelled twice: `mountTree` throws on a duplicate, and a duplicate
  // is what a positional key produces the moment two rows share a position.
  expect(new Set(ids).size).toBe(ids.length);
  // …and the ids the screen publishes for the mouse are the row ids above.
  expect(listRowIds(TICKET_TABLE, [TICKET])).toEqual(['ticket-row-uuid-1']);
});

it('the ticket table empty line is byte-identical', () => {
  expect(cellValues(ticketTable([])).at(-1)).toBe('No tickets.');
  expect(cellValues(ticketTable([], 'Nothing.')).at(-1)).toBe('Nothing.');
});

it('the run table header is cell-identical, and its printed text with it', () => {
  // BB-345 moved ONE number here, on purpose: PHASE's budget 10 -> 13. The
  // phase is the ticket state a run started in, so its vocabulary is the ticket
  // workflow's state_flow, whose longest member `qualification` is 13 characters
  // — a domain constant, not a measurement of any page. Nothing else moved: same
  // six columns in the same order carrying the same values, and the printed text
  // below is unchanged because the pipe joins cells with one space and never
  // pads to the budget (BB-340 Task 13).
  const [header] = listTableRows(RUN_TABLE, [], NOW);
  expect(runCells(header)).toEqual([
    ['RUN', 8],
    ['TICKET', 10],
    ['STATE', 8],
    ['PHASE', 13],
    ['AGENT', 8],
    ['STARTED', 0],
  ]);
  expect(lineText(header ?? '')).toBe('RUN TICKET STATE PHASE AGENT STARTED');
});

it('the run table row is cell-identical, and its printed text with it', () => {
  const [, row] = listTableRows(RUN_TABLE, [RUN], NOW);
  expect(runCells(row)).toEqual([
    ['#4784', 8],
    ['BB-294', 10],
    ['running', 8],
    // PHASE's budget, 10 -> 13 with BB-345 — see the header case above.
    ['spec', 13],
    ['claude', 8],
    ['5m ago', 0],
  ]);
  expect(lineText(row ?? '')).toBe('#4784 BB-294 running spec claude 5m ago');
});

it('the run table empty line is byte-identical', () => {
  expect(listTableRows(RUN_TABLE, [], NOW)[1]).toBe(
    'No runs for this project.',
  );
});

it('the ticket detail`s run list says TICKET, and differs in nothing else', () => {
  // BB-345 Task 4 — this claim used to be `runTableRows(…, { emptyMessage })`,
  // a per-call override on the deleted wrapper. It is a second CONFIGURATION now,
  // and the assertion is the stronger half of that: the message is the ticket's,
  // and every other member — the columns, their budgets, and the noun every row
  // node is keyed under — is the same value the project-wide screen renders.
  expect(listTableRows(TICKET_RUN_TABLE, [], NOW)[1]).toBe(
    'No runs for this ticket.',
  );
  expect(runCells(listTableRows(TICKET_RUN_TABLE, [RUN], NOW)[1])).toEqual(
    runCells(listTableRows(RUN_TABLE, [RUN], NOW)[1]),
  );
  expect(TICKET_RUN_TABLE.noun).toBe(RUN_TABLE.noun);
});
