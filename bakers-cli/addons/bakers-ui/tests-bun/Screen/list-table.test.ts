import { afterEach, describe, expect, it } from 'bun:test';
import { listTableTree } from '../../src/Entity/collection.js';
import {
  TICKET_TABLE,
  type TicketRow,
} from '../../src/Entity/ticket/Data/tickets.js';
import { mountTree } from '../../src/Kernel/mount.js';
import { type BareHarness, createHarness } from '../tui-harness.js';

/**
 * BB-340 Task 7 — the ticket table's LAYOUT, against real Yoga.
 *
 * `lib/table.ts` padded every column with `pad()` (which measured display
 * columns through `lib/width.ts`) and truncated an over-wide value with an
 * ellipsis, so the fixed-column layout was a property of a string and could be
 * asserted on one. It is a property of the renderer now: each cell declares its
 * column's `width` and `truncate: true`, and Yoga places them. The vitest suite
 * may not measure columns (D8) — this is where the same facts are checked, in the
 * one place they became true.
 */
const live: BareHarness[] = [];
const newHarness = async (columns: number): Promise<BareHarness> => {
  const harness = await createHarness({ columns, rows: 8 });
  live.push(harness);
  return harness;
};
afterEach(() => {
  for (const harness of live.splice(0)) harness.renderer.destroy();
});

const ticket = (over: Partial<TicketRow>): TicketRow =>
  ({
    id: 't1',
    identifier: 'BB-1',
    title: 'TITLE-MARK',
    state: 'todo',
    priority: null,
    assigneeInitials: 'CW',
    derivedStatus: 'idle',
    parent: 'BB-175',
    conductor: 'x',
    ...over,
  }) as TicketRow;

const paint = async (
  harness: BareHarness,
  tickets: TicketRow[],
): Promise<string[]> => {
  mountTree(
    harness.renderer,
    harness.root,
    listTableTree(TICKET_TABLE, tickets, undefined, { selectedIndex: -1 }),
  );
  await harness.renderOnce();
  // The render buffer is a GRID, so every row is `width` cells wide; the composed
  // rows these are compared against were not. Trimming the right edge is what
  // makes the two comparable, exactly as `tui-harness.ts` does for the kernel.
  return harness
    .captureCharFrame()
    .split('\n')
    .map((row) => row.replace(/\s+$/, ''));
};

describe('the ticket table is laid out in fixed columns', () => {
  it('keeps TITLE at the same offset however long the conductor label is', async () => {
    // The case `lib/table.ts`'s suite made on a padded string, made here on the
    // painted frame: fixed-width columns mean the trailing column starts in the
    // same terminal column either way.
    const short = (await paint(await newHarness(120), [ticket({})]))[1] ?? '';
    const long =
      (
        await paint(await newHarness(120), [
          ticket({ conductor: 'a-really-long-conductor-name-way-over-14' }),
        ])
      )[1] ?? '';
    expect(short.indexOf('TITLE-MARK')).toBeGreaterThan(0);
    expect(long.indexOf('TITLE-MARK')).toBe(short.indexOf('TITLE-MARK'));
  });

  it('clips an over-wide value inside its own column, ELLIPSIS AND ALL', async () => {
    const row =
      (
        await paint(await newHarness(120), [
          ticket({ conductor: 'a-really-long-conductor-name-way-over-14' }),
        ])
      )[1] ?? '';
    expect(row).not.toContain('a-really-long-conductor-name-way-over-14');
    // 13 columns of it plus the `…` that says something was removed — 14 in
    // total, which is the column, and the trailing column right behind them.
    // Painted rather than declared: this is the frame the operator reads, and
    // an assertion on the cell's content alone could not tell an ellipsis the
    // renderer honoured from one it clipped away.
    const cut = row.indexOf('a-really-long…');
    expect(cut).toBeGreaterThan(0);
    // The gap is one column, so the trailing column starts 15 on from the cut.
    expect(row.indexOf('TITLE-MARK')).toBe(cut + 15);
  });

  it('paints the header and a row BYTE-IDENTICALLY to the row surface', async () => {
    // The two strings `tests/Entity/list-render-identity.test.ts` froze before
    // BB-294's refactor: the table moved from `pad()` + `join(' ')` to Yoga
    // widths and a one-column gap, and the picture did not move with it.
    //
    // BB-345 MOVED IT, ON PURPOSE AND EXACTLY ONCE. The STATE column's budget
    // went from 8 to 13 — the length of `qualification`, the longest member of
    // the ticket workflow's state_flow — so every column after it shifts five to
    // the right and both strings gain five spaces inside STATE's field. That is
    // the whole of the change: same columns, same order, same values, same
    // one-column gaps, and the trailing TITLE still starts where the fixed
    // columns end. The pin is re-frozen rather than relaxed, because its job is
    // unchanged — a lost column, a reordered header or a dropped label suffix
    // must still fail here loudly.
    //
    // BB-302 moved it once more: RUN went from 8 to 12 to fit `no conductor`,
    // the longest stall reason, so the columns after it shift four to the right
    // and the harness is four columns wider to keep the whole row on screen.
    const painted = await paint(await newHarness(124), [
      ticket({
        id: 'uuid-1',
        identifier: 'BB-294',
        title: 'Centralize the TUI list logic',
        state: 'spec',
        priority: 3,
        derivedStatus: 'running',
        labels: ['work:code'],
        parent: 'BB-292',
        conductor: 'cw-framework',
      }),
    ]);
    expect(painted[0]).toBe(
      'IDENTIFIER STATE         PRIO  WHO  BY   RUN          PARENT     COND           TITLE',
    );
    expect(painted[1]).toBe(
      'BB-294     spec          3     CW   —    running      BB-292     cw-framework   Centralize the TUI list logic  [work:code]',
    );
  });
});
