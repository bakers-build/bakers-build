import { expect, it } from 'vitest';
import { listTableTree } from '../../src/Entity/collection.js';
import {
  TICKET_TABLE,
  type TicketRow,
} from '../../src/Entity/ticket/Data/tickets.js';
import { scrollTo } from '../../src/lib/scroll.js';
import { idsOf } from '../render-tree.js';

it('scrollTo leaves the offset alone when the row is already visible', () => {
  expect(scrollTo(5, 0, 16)).toBe(0);
  expect(scrollTo(0, 0, 16)).toBe(0);
  expect(scrollTo(15, 0, 16)).toBe(0);
});

it('scrollTo scrolls up so a row above the window becomes the top row', () => {
  expect(scrollTo(3, 10, 16)).toBe(3);
});

it('scrollTo scrolls down so a row at/below the bottom edge is the last row', () => {
  // row 16 with height 16 sits one past the [0,16) window → offset = 16-16+1 = 1
  expect(scrollTo(16, 0, 16)).toBe(1);
  expect(scrollTo(20, 1, 16)).toBe(5);
});

it('project ticket-list: the selected row stays inside the window across the whole list', () => {
  // Regression for the AC-2 off-by-one: the ticket table prepends a header row,
  // so the selected ticket index i renders at physical row 1 + i. Walking the
  // selection down a >height list, that physical row must never scroll off the
  // window (the round-5 review reproduced 80x24/height 16/30 tickets → the
  // highlight fell one row past the bottom and no row was highlighted).
  const tickets = Array.from({ length: 30 }, (_, i) => ({
    id: `t${i}`,
    identifier: `BB-${i}`,
    state: 'coding',
    priority: null,
    assigneeInitials: '',
    derivedStatus: 'idle',
    title: `ticket ${i}`,
  }));
  // The physical rows the table declares: the header node plus one node per
  // ticket. Counted off the TREE since BB-340 Task 7 — the list screen has no
  // row surface left — and it is still `1 + tickets.length`, which is the whole
  // premise the `selRow = 1 + i` below rests on.
  const bodyRows = idsOf(
    listTableTree(TICKET_TABLE, tickets as TicketRow[], undefined, {
      selectedIndex: -1,
    }),
  ).filter((id) => id === 'ticket-header' || id.startsWith('ticket-row-'));
  const height = 16;
  let offset = 0;
  for (
    let selectedTicket = 0;
    selectedTicket < tickets.length;
    selectedTicket++
  ) {
    const selRow = 1 + selectedTicket; // mirrors screenView().selRow (kernel)
    offset = scrollTo(selRow, offset, height);
    expect(
      selRow >= offset && selRow < offset + height,
      `selectedTicket=${selectedTicket} selRow=${selRow} offset=${offset} height=${height} — highlight off-screen`,
    ).toBeTruthy();
    expect(
      selRow < bodyRows.length,
      'selected row within rendered rows',
    ).toBeTruthy();
  }
});
