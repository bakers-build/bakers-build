// BB-294 AC 1 — the paging block, the collection count and the restore clamp,
// once. Exercised through a minimal subclass so the base is under test rather than
// either real list.
import { expect, it, vi } from 'vitest';
import type {
  ListColumn,
  ListTable,
  Page,
  PageWindow,
} from '../../src/Entity/collection.js';
import { ListScreen } from '../../src/Screen/list-screen.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import { cellValues, idsOf } from '../render-tree.js';

interface Row {
  id: string;
}

const COLUMNS: readonly ListColumn<Row, void>[] = [
  { key: 'id', label: 'ID', width: 0, fields: ['id'], get: (r) => r.id },
];

/** The probe list as one configuration (BB-345 D2) — the three members the
 *  base used to declare abstractly, declared where a real list declares them. */
const TABLE: ListTable<Row, void> = {
  noun: 'probe',
  columns: COLUMNS,
  emptyMessage: 'No rows.',
};

class Probe extends ListScreen<Row, void> {
  readonly id = 'probe';
  protected readonly table = TABLE;
  /** Each entry is one page AS THE SERVER ANSWERED IT — rows, `hasNext` and the
   *  collection total together (BB-292 D4/D6e). */
  pages: Page<Row>[] = [];
  /** Every page index `load()` asked for, in order: the assertion that a page
   *  costs exactly one read and a total costs none of its own. */
  readonly loads: number[] = [];
  protected tableContext(): void {}
  protected chrome() {
    return { title: 'probe' };
  }
  protected renderLoading(): string[] {
    return ['Loading…'];
  }
  protected loadRows(
    _context: ScreenContext,
    page: number,
  ): Promise<Page<Row>> {
    this.loads.push(page);
    return Promise.resolve(
      this.pages[page] ?? {
        rows: [],
        hasNext: false,
        page,
        total: null,
        window: null,
      },
    );
  }
  /** Thin public wrappers over the protected members, for the test only. */
  handlePagingInputForTest(input: string, context: ScreenContext): boolean {
    return this.handlePagingInput(input, context);
  }
  handleCursorInputForTest(input: string, context: ScreenContext): boolean {
    return this.handleCursorInput(input, context);
  }
  loadedPageForTest(): number {
    return this.loadedPage;
  }
  pagingSegmentsForTest(): string[] {
    return this.pagingSegments();
  }
  pagingActionItemsForTest(): ReturnType<Probe['pagingActionItems']> {
    return this.pagingActionItems();
  }
  countLabelForTest(): string {
    return this.countLabel();
  }
  restorePageForTest(token: { page?: unknown }): void {
    this.restorePage(token);
  }
  requested(): number {
    return this.page;
  }
}

// A context stub with only the members ListScreen touches.
const ctx = (): ScreenContext =>
  ({
    requestDraw: vi.fn(),
    isActive: () => true,
    sessionGeneration: 1,
    services: { client: {} },
    project: { id: 'p1' },
  }) as unknown as ScreenContext;

it('the right arrow advances a page and the left arrow goes back', async () => {
  const screen = new Probe();
  screen.pages = [
    { rows: [{ id: 'a' }], hasNext: true, page: 0, total: null, window: null },
    { rows: [{ id: 'b' }], hasNext: false, page: 1, total: null, window: null },
  ];
  const context = ctx();
  screen.enter(context);
  await vi.waitFor(() => expect(screen.rows.length).toBe(1));
  expect(screen.handlePagingInputForTest('right', context)).toBe(true);
  await vi.waitFor(() => expect(screen.rows[0]?.id).toBe('b'));
  expect(screen.handlePagingInputForTest('left', context)).toBe(true);
  await vi.waitFor(() => expect(screen.rows[0]?.id).toBe('a'));
});

it('the right arrow does nothing on the last page', async () => {
  const screen = new Probe();
  screen.pages = [
    { rows: [{ id: 'a' }], hasNext: false, page: 0, total: null, window: null },
  ];
  const context = ctx();
  screen.enter(context);
  await vi.waitFor(() => expect(screen.rows.length).toBe(1));
  expect(screen.handlePagingInputForTest('right', context)).toBe(true);
  expect(screen.requested()).toBe(0);
});

it('the left arrow does nothing on the first page', async () => {
  const screen = new Probe();
  screen.pages = [
    { rows: [{ id: 'a' }], hasNext: true, page: 0, total: null, window: null },
  ];
  const context = ctx();
  screen.enter(context);
  await vi.waitFor(() => expect(screen.rows.length).toBe(1));
  expect(screen.handlePagingInputForTest('left', context)).toBe(true);
  expect(screen.requested()).toBe(0);
});

it('paging moves from the page ON SCREEN, not the requested index', async () => {
  // BB-292 R1: the affordance the operator read came from the loaded page.
  const screen = new Probe();
  screen.pages = [
    { rows: [{ id: 'a' }], hasNext: true, page: 0, total: null, window: null },
    { rows: [{ id: 'b' }], hasNext: true, page: 1, total: null, window: null },
  ];
  const context = ctx();
  screen.enter(context);
  await vi.waitFor(() => expect(screen.rows.length).toBe(1));
  expect(screen.loadedPageForTest()).toBe(0);
});

it('the paging segment names the LOADED page; arrows are footer action-items', async () => {
  const screen = new Probe();
  screen.pages = [
    { rows: [{ id: 'a' }], hasNext: true, page: 0, total: null, window: null },
    { rows: [{ id: 'b' }], hasNext: false, page: 1, total: null, window: null },
  ];
  const context = ctx();
  screen.enter(context);
  await vi.waitFor(() => expect(screen.rows.length).toBe(1));
  expect(screen.pagingSegmentsForTest()).toEqual(['page 1']);
  expect(screen.pagingActionItemsForTest()).toEqual([
    { id: 'page-next', key: '→', label: 'next' },
  ]);
  screen.handlePagingInputForTest('right', context);
  await vi.waitFor(() => expect(screen.rows[0]?.id).toBe('b'));
  expect(screen.pagingSegmentsForTest()).toEqual(['page 2']);
  expect(screen.pagingActionItemsForTest()).toEqual([
    { id: 'page-prev', key: '←', label: 'prev' },
  ]);
});

it('an emptied showRows drops the next-page arrow', async () => {
  const screen = new Probe();
  screen.pages = [
    { rows: [{ id: 'a' }], hasNext: true, page: 0, total: 40, window: null },
  ];
  const context = ctx();
  screen.enter(context);
  await vi.waitFor(() => expect(screen.rows.length).toBe(1));
  expect(screen.pagingActionItemsForTest()).toEqual([
    { id: 'page-next', key: '→', label: 'next' },
  ]);
  screen.showRows([]);
  expect(screen.pagingActionItemsForTest()).toEqual([]);
});

it('the count label spells an unestablished total as `?`', async () => {
  // BB-292 D6d: `N of ?` and `N of M` differ in the place the total is stated, so
  // "this server reports no total" cannot be misread as "counted" (AC 8.6). The
  // defect closed: at 19abe8f1 a not-yet-known and a real total both rendered
  // `2 probe(s)` / `2 of 7 probe(s)` — the unknown was simply omitted.
  const screen = new Probe();
  screen.pages = [
    {
      rows: [{ id: 'a' }, { id: 'b' }],
      hasNext: true,
      page: 0,
      total: null,
      window: null,
    },
  ];
  const context = ctx();
  screen.enter(context);
  await vi.waitFor(() => expect(screen.rows.length).toBe(2));
  expect(screen.countLabelForTest()).toBe('2 of ? probe(s)');
});

it('the unknown marker is a `?` on the LAST page too, never a `+`', async () => {
  // The sub-defect measured live on the real collection: page index 68 of 69,
  // 4 rows, `hasNext === false`, and the line still read `4+ probe(s)` — the screen
  // knew it was at the end and claimed more followed. `?` says "the total is not
  // known" without claiming anything about what follows.
  const screen = new Probe();
  screen.pages = [
    {
      rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      hasNext: false,
      page: 0,
      total: null,
      window: null,
    },
  ];
  const context = ctx();
  screen.enter(context);
  await vi.waitFor(() => expect(screen.rows.length).toBe(4));
  expect(screen.countLabelForTest()).toBe('4 of ? probe(s)');
});

it('the total is the one the page carried, and costs no read of its own', async () => {
  // BB-292 D6e: the total rides `meta.count` on the page response, so it is
  // present in the first frame that has rows at all — it cannot land late and
  // cannot appear beside rows it does not describe.
  const screen = new Probe();
  screen.pages = [
    {
      rows: [{ id: 'a' }, { id: 'b' }],
      hasNext: true,
      page: 0,
      total: 7,
      window: null,
    },
  ];
  const context = ctx();
  screen.enter(context);
  await vi.waitFor(() => expect(screen.rows.length).toBe(2));
  expect(screen.countLabelForTest()).toBe('2 of 7 probe(s)');
  expect(screen.loads).toEqual([0]);
});

it('paging costs one read per page and each page states its own total', async () => {
  const screen = new Probe();
  screen.pages = [
    { rows: [{ id: 'a' }], hasNext: true, page: 0, total: 7, window: null },
    { rows: [{ id: 'b' }], hasNext: false, page: 1, total: 7, window: null },
  ];
  const context = ctx();
  screen.enter(context);
  await vi.waitFor(() => expect(screen.rows.length).toBe(1));
  expect(screen.countLabelForTest()).toBe('1 of 7 probe(s)');
  screen.handlePagingInputForTest('right', context);
  await vi.waitFor(() => expect(screen.rows[0]?.id).toBe('b'));
  expect(screen.countLabelForTest()).toBe('1 of 7 probe(s)');
  expect(screen.loads).toEqual([0, 1]);
});

it('reload re-reads the page, and nothing else', async () => {
  // It used to also discard a remembered count. With the total riding the page,
  // re-reading the page IS re-reading the total.
  const screen = new Probe();
  screen.pages = [
    { rows: [{ id: 'a' }], hasNext: false, page: 0, total: 3, window: null },
  ];
  const context = ctx();
  screen.enter(context);
  await vi.waitFor(() => expect(screen.rows.length).toBe(1));
  expect(screen.loads).toEqual([0]);
  screen.reload(context);
  await vi.waitFor(() =>
    expect(screen.countLabelForTest()).toBe('1 of 3 probe(s)'),
  );
  expect(screen.loads).toEqual([0, 0]);
});

it('retry on a ready list keeps the rows and states busy until the re-read lands', async () => {
  let release!: (value: Page<Row>) => void;
  class Held extends Probe {
    protected override loadRows(
      _context: ScreenContext,
      page: number,
    ): Promise<Page<Row>> {
      this.loads.push(page);
      if (this.loads.length === 1) {
        return Promise.resolve(
          this.pages[0] ?? {
            rows: [],
            hasNext: false,
            page,
            total: null,
            window: null,
          },
        );
      }
      return new Promise((resolve) => {
        release = resolve;
      });
    }
  }
  const screen = new Held();
  screen.pages = [
    { rows: [{ id: 'a' }], hasNext: false, page: 0, total: 1, window: null },
  ];
  const context = ctx();
  screen.enter(context);
  await vi.waitFor(() => expect(screen.rows[0]?.id).toBe('a'));
  expect(screen.busy).toBe(false);

  screen.retry(context);
  expect(screen.busy).toBe(true);
  expect(screen.rows[0]?.id).toBe('a');
  expect(screen.loads).toEqual([0, 0]);

  release({
    rows: [{ id: 'b' }],
    hasNext: false,
    page: 0,
    total: 1,
    window: null,
  });
  await vi.waitFor(() => expect(screen.rows[0]?.id).toBe('b'));
  expect(screen.busy).toBe(false);
});

it('the count segment is OMITTED while no page is loaded (BB-292 D6c)', async () => {
  // The loading window. Nothing is on screen but `Loading runs…`, so there is no
  // row count to state and no total to imply — and `0`/`0+` would state both
  // wrongly. Held open so the window is observed rather than raced.
  class Held extends Probe {
    protected override loadRows(): Promise<Page<Row>> {
      return new Promise(() => {});
    }
  }
  const screen = new Held();
  const context = ctx();
  screen.enter(context);
  expect(screen.state).toBe('loading');
  expect(screen.countLabelForTest()).toBe('');
  await Promise.resolve();
  expect(screen.countLabelForTest()).toBe('');
});

// ---------------------------------------------------------------------------
// BB-312 V1 — the label matrix. The defect: with 60 tickets at a page size of
// 20, pages 1, 2 and 3 all read `20 of 60 probe(s)` — how many rows are on
// screen and how large the collection is, never WHERE those rows sit.
// ---------------------------------------------------------------------------

const page = (over: Partial<Page<Row>> & { rows: Row[] }): Page<Row> => ({
  hasNext: false,
  page: 0,
  total: null,
  window: { offset: 0, limit: 20 },
  ...over,
});
const rows = (n: number, from = 0): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${from + i}` }));

const label = async (value: Page<Row>): Promise<string> => {
  const screen = new Probe();
  screen.pages = [value];
  const context = ctx();
  screen.enter(context);
  await vi.waitFor(() => expect(screen.state).toBe('ready'));
  return screen.countLabelForTest();
};

it('a full FIRST page states the window it fills', async () => {
  expect(await label(page({ rows: rows(20), hasNext: true, total: 60 }))).toBe(
    '1–20 of 60 probe(s)',
  );
});

it('a full MIDDLE page states where it sits — the whole point of BB-312', async () => {
  // The defect: pages 1, 2 and 3 all read `20 of 60 probe(s)` while `page N`
  // beside them moved.
  expect(
    await label(
      page({
        rows: rows(20),
        hasNext: true,
        page: 1,
        total: 60,
        window: { offset: 20, limit: 20 },
      }),
    ),
  ).toBe('21–40 of 60 probe(s)');
});

it('the LAST page is positioned by the total it ends at', async () => {
  expect(
    await label(
      page({
        rows: rows(7),
        page: 2,
        total: 47,
        window: { offset: 40, limit: 20 },
      }),
    ),
  ).toBe('41–47 of 47 probe(s)');
});

it('a collection smaller than one page reads from 1', async () => {
  expect(await label(page({ rows: rows(3), total: 3 }))).toBe(
    '1–3 of 3 probe(s)',
  );
});

it('a one-row page prints BOTH bounds, never a bare position', async () => {
  // `21 of 60` would put a POSITION where the fallback shape puts a COUNT, one
  // character wide and unmarked — the silent meaning switch BB-292 D6c forbids.
  expect(
    await label(
      page({
        rows: rows(1),
        page: 1,
        total: 21,
        window: { offset: 20, limit: 20 },
      }),
    ),
  ).toBe('21–21 of 21 probe(s)');
});

it('a SHORT page with no witness for its end states a count, not a position', async () => {
  // 12 rows out of a 20-row window on a middle page: something dropped rows after
  // the query bounded it, so the survivors are not provably contiguous. Never
  // `21–32`, which would assume every preceding page was full.
  expect(
    await label(
      page({
        rows: rows(12),
        hasNext: true,
        page: 1,
        total: 60,
        window: { offset: 20, limit: 20 },
      }),
    ),
  ).toBe('12 of 60 probe(s)');
});

it('hasNext === false alone does not position a short page', async () => {
  // It establishes that the page is LAST, not that nothing was dropped inside it,
  // and with no total there is nothing to check it against.
  expect(
    await label(
      page({ rows: rows(4), page: 3, window: { offset: 60, limit: 20 } }),
    ),
  ).toBe('4 of ? probe(s)');
});

it('an unestablished total keeps its own place beside a known position', async () => {
  expect(
    await label(
      page({
        rows: rows(20),
        hasNext: true,
        page: 1,
        window: { offset: 20, limit: 20 },
      }),
    ),
  ).toBe('21–40 of ? probe(s)');
});

it('a range that would overrun a known total falls back to the count', async () => {
  // A contradiction between the two numbers is not a position (R1).
  expect(
    await label(
      page({
        rows: rows(20),
        page: 2,
        total: 50,
        window: { offset: 40, limit: 20 },
      }),
    ),
  ).toBe('20 of 50 probe(s)');
});

it('a windowless page states a count', async () => {
  expect(await label(page({ rows: rows(2), total: 7, window: null }))).toBe(
    '2 of 7 probe(s)',
  );
});

it('an empty collection has no first row', async () => {
  expect(await label(page({ rows: [], total: 0 }))).toBe('0 of 0 probe(s)');
});

it('a client-side filter clears the window (BB-312 D4)', async () => {
  // `load()` re-applies the subclass's predicate to the server's bounded page, so
  // the survivors are a scattered subset of the window that was asked for. A range
  // over that window would name positions the rows do not occupy.
  class Filtered extends Probe {
    protected filterRow(row: Row): boolean {
      return row.id !== 'b';
    }
    windowForTest(): PageWindow | null {
      return this.readyValue?.window ?? null;
    }
  }
  const screen = new Filtered();
  screen.pages = [
    {
      rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      hasNext: false,
      page: 0,
      total: 3,
      window: { offset: 0, limit: 20 },
    },
  ];
  const context = ctx();
  screen.enter(context);
  await vi.waitFor(() => expect(screen.rows.length).toBe(2));
  expect(screen.windowForTest()).toBe(null);
});

it('a filter that drops nothing leaves the window alone (BB-312 D4)', async () => {
  class Filtered extends Probe {
    protected filterRow(): boolean {
      return true;
    }
    windowForTest(): PageWindow | null {
      return this.readyValue?.window ?? null;
    }
  }
  const screen = new Filtered();
  screen.pages = [
    {
      rows: [{ id: 'a' }],
      hasNext: false,
      page: 0,
      total: 1,
      window: { offset: 0, limit: 20 },
    },
  ];
  const context = ctx();
  screen.enter(context);
  await vi.waitFor(() => expect(screen.rows.length).toBe(1));
  expect(screen.windowForTest()).toEqual({ offset: 0, limit: 20 });
});

it('restoreState clamps a hostile page token', () => {
  const screen = new Probe();
  for (const token of [
    { page: -3 },
    { page: 'abc' },
    { page: undefined },
    {},
  ]) {
    screen.restorePageForTest(token);
    expect(screen.requested()).toBe(0);
  }
  screen.restorePageForTest({ page: 2.9 });
  expect(screen.requested()).toBe(2);
});

// ---------------------------------------------------------------------------
// BB-340 Task 7 — the ready body is a renderable TREE, keyed by the entity.
// ---------------------------------------------------------------------------

/** The ids of the tree's ROW nodes, in the order the tree declares them. */
const rowIdsOf = (screen: Probe, context: ScreenContext): string[] =>
  idsOf(screen.present(context).body).filter((id) =>
    id.startsWith('probe-row-'),
  );

const loaded = async (value: Page<Row>): Promise<[Probe, ScreenContext]> => {
  const screen = new Probe();
  screen.pages = [value];
  const context = ctx();
  screen.enter(context);
  await vi.waitFor(() => expect(screen.state).toBe('ready'));
  return [screen, context];
};

it('keys each row on the entity, not on its position (D4/R4)', async () => {
  const [screen, context] = await loaded(page({ rows: rows(3) }));
  expect(rowIdsOf(screen, context)).toEqual([
    'probe-row-r0',
    'probe-row-r1',
    'probe-row-r2',
  ]);
});

it('a re-sorted page declares its rows in the NEW order', async () => {
  // The screen-level half of `tests-bun/Kernel/mount.test.ts`'s reorder case:
  // the tree the screen hands over states the order, and the kernel's patch
  // re-inserts the live rows into it.
  const [screen, context] = await loaded(page({ rows: rows(3) }));
  const first = rowIdsOf(screen, context);
  screen.pages = [page({ rows: [...rows(3)].reverse() })];
  screen.reload(context);
  await vi.waitFor(() =>
    expect(rowIdsOf(screen, context)).toEqual([...first].reverse()),
  );
});

it('an empty page states its empty message, and declares no row', async () => {
  const [screen, context] = await loaded(page({ rows: [] }));
  expect(cellValues(screen.present(context).body)).toEqual(['ID', 'No rows.']);
  expect(rowIdsOf(screen, context)).toEqual([]);
});

it('the header row keeps an id of its own, above the rows', async () => {
  const [screen, context] = await loaded(page({ rows: rows(1) }));
  const ids = idsOf(screen.present(context).body);
  expect(ids).toContain('probe-header');
  expect(ids.indexOf('probe-header')).toBeLessThan(ids.indexOf('probe-row-r0'));
});

it('the cursor keys move the selection and nothing else', async () => {
  const screen = new Probe();
  screen.pages = [
    {
      rows: [{ id: 'a' }, { id: 'b' }],
      hasNext: false,
      page: 0,
      total: null,
      window: null,
    },
  ];
  const context = ctx();
  screen.enter(context);
  await vi.waitFor(() => expect(screen.rows.length).toBe(2));
  expect(screen.handleCursorInputForTest('j', context)).toBe(true);
  expect(screen.selectedIndex).toBe(1);
  expect(screen.handleCursorInputForTest('enter', context)).toBe(false);
  expect(screen.handleCursorInputForTest('right', context)).toBe(false);
});
