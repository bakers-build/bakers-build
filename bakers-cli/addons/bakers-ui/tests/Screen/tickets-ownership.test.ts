import { describe, expect, it } from 'vitest';
import type { TicketRow } from '../../src/Entity/ticket/Data/tickets.js';
import { TicketsScreen } from '../../src/Entity/ticket/Screen/tickets.js';

const row = (id: string): TicketRow => ({
  id,
  identifier: `BB-${id}`,
  title: id,
  state: 'coding',
  priority: null,
  assigneeInitials: '',
  derivedStatus: 'idle',
  type: 'feature',
  parent: null,
  conductor: null,
  closed: false,
  frozen: false,
  stallReason: '',
});

class Subject extends TicketsScreen {
  // The ready value is a PAGE since BB-292 (rows plus `hasNext` plus the page
  // index), so seeding builds one; `hasNext: false` is a screen on its last page.
  seed(rows: TicketRow[]): void {
    this.replaceReady({ rows, hasNext: false, page: 0, window: null });
  }
}

describe('Tickets ownership', () => {
  it('saves criteria and selection by stable ticket id', () => {
    const screen = new Subject();
    screen.seed([row('t1'), row('t2')]);
    screen.previewCriteria({
      query: '',
      state: 'coding',
      closed: false,
      parent: null,
      who: null,
    });
    screen.selectId('t2');

    expect(screen.saveState()).toEqual({
      criteria: {
        query: '',
        state: 'coding',
        closed: false,
        parent: null,
        who: null,
      },
      // The saved token carries the page index too (BB-292 D5), so a round
      // trip through a ticket detail returns to the page the operator left.
      page: 0,
      selectedTicketId: 't2',
      viewportAnchor: 't2',
    });
  });

  it('applies mutations in screen-owned rows', () => {
    const screen = new Subject();
    screen.seed([row('t1')]);
    screen.applyMutation({ id: 't1', title: 'newer' });
    expect(screen.row('t1')?.title).toBe('newer');
  });
});
