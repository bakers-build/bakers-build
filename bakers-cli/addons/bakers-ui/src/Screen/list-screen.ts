// BB-292 (re-entry) — `ListScreen` lives HERE, in its own module.
//
// BB-294 built it inside `async-screen.ts` because
// `tests/Routing/production.test.ts` pinned `src/Screen/` to an exact
// `['async-screen.ts', 'screen.ts']` and that ticket's AC 8 forbade touching the
// test. The cost landed on the next reader: the list builder was unfindable in a
// file named after a different base class, which is exactly the wrong diagnosis
// this ticket's own session paid for. So the whitelist gained one argued entry and
// the class got its file. `AsyncScreen` stays where it is with its seven direct
// subclasses; boundary G5 (`Entity/*/Screen/` may import shared `Screen/`) is the
// same edge either way, and no re-export is left behind — one home, one name.

import type { VNode } from '@opentui/core';
import {
  type ActionItem,
  actionItem,
} from '../Component/footer-actions/index.js';
import {
  type ListTable,
  listRowIds,
  listTableTree,
  type Page,
} from '../Entity/collection.js';
import { ListCursor } from '../lib/cursor.js';
import { AsyncScreen } from './async-screen.js';
import type { ScreenContext } from './screen.js';

/**
 * A paged, column-rendered list screen (BB-294).
 *
 * It owns the blocks that were duplicated word for word between the ticket and
 * run lists: the page index and its movement, the count line, the `restoreState`
 * clamp, and the column-driven render. It does NOT own the
 * criteria — five criteria with a debounced search and a modal parent picker on
 * one side, one criterion on the other; a base class serving both would need
 * enough hooks to be a framework.
 *
 * It does not claim keys from `handleInput` either. The current dispatch ORDER is
 * load-bearing: `←`/`→` sit after the ticket list's `/` search branch, where the
 * arrows are inert while the `/` field is open. A base that claimed them first
 * would make them page there — a behaviour change, and BB-294 is
 * behaviour-neutral. So the dispatch TABLE lives here once and each subclass calls
 * `handlePagingInput`/`handleCursorInput` at the position its own code has them.
 */
export abstract class ListScreen<
  Row extends { id: string },
  Ctx = void,
> extends AsyncScreen<Page<Row>> {
  /** Composed, not inherited: two of the four cursor adopters are
   *  `AsyncScreen<Row[]>` and cannot extend this class (BB-294 D1). */
  private readonly cursor = new ListCursor();
  /** Public and settable: the kernel reads it and existing tests write it. */
  get selectedIndex(): number {
    return this.cursor.index;
  }
  set selectedIndex(value: number) {
    this.cursor.index = value;
  }

  /** The page REQUESTED; 0 is the first (BB-292 D1). Read only by `load()` and
   *  by a subclass's `saveState()` — everything else reads `loadedPage`. */
  protected page = 0;

  /**
   * THIS LIST, whole (BB-345 D2) — its columns, its noun, its empty message.
   *
   * One member where there were three, and declared beside the row mapper in
   * `Entity/*​/Data/` rather than here. `noun` in particular has three readers
   * that must agree: it prefixes every node id the tree declares
   * (`ticket-row-<uuid>`), it is what {@link rowNodeIds} publishes as the node a
   * click lands on, and it is the noun {@link countLabel} states the count in. A
   * screen whose rows are keyed `run-…` while its footer counts tickets is a
   * screen nobody can debug; reading all three off one value is what makes that
   * unrepresentable rather than merely unlikely.
   */
  protected abstract readonly table: ListTable<Row, Ctx>;
  /** The per-render value the columns need (`nowSeconds` for runs, nothing for
   *  tickets). */
  protected abstract tableContext(context: ScreenContext): Ctx;
  /** One page of rows for the subclass's current criteria — including the size of
   *  the collection those criteria select, which the server reports on the page
   *  itself (BB-292 D6e). */
  protected abstract loadRows(
    context: ScreenContext,
    page: number,
  ): Promise<Page<Row>>;
  /**
   * Re-apply the subclass's own predicates to the server's bounded page.
   *
   * The server is authoritative for filtering; this only protects a cached
   * re-entry from clients or test doubles that ignore query parameters. It cannot
   * add a row the server did not return.
   */
  protected filterRow?(row: Row): boolean;

  get rows(): readonly Row[] {
    return this.readyValue?.rows ?? [];
  }

  /**
   * The node a click on each row lands on, in selection order — what the screen
   * publishes as `ScreenPresentation.rowIds` (BB-340 Task 11).
   *
   * Here rather than in each list screen's `present()` because it is the same
   * two facts `renderReady` builds the rows from: this screen's `noun` and the
   * page's own rows. A list screen that spelled it itself could spell it
   * differently, and a click that resolves to no entry is silent.
   */
  protected get rowNodeIds(): string[] {
    return listRowIds(this.table, this.rows);
  }

  /**
   * The page the screen is SHOWING: the one the loaded rows came from, falling
   * back to the requested index only while nothing is loaded, where it correctly
   * names the page being fetched (BB-292 D4).
   */
  protected get loadedPage(): number {
    return this.readyValue?.page ?? this.page;
  }

  /** Move to `next`, or do nothing when it leads nowhere (BB-292 D6). */
  protected goToPage(next: number, context: ScreenContext): boolean {
    if (next < 0) return true;
    if (next > this.loadedPage && !this.readyValue?.hasNext) return true;
    this.page = next;
    this.selectedIndex = 0;
    this.retry(context);
    return true;
  }

  /**
   * The LEFT/RIGHT arrows — the dispatch table both lists used to carry a copy of.
   *
   * The kernel passes the raw sequence through and handles neither `\x1b[C` nor
   * `\x1b[D` itself (unlike `\x1b[A`/`\x1b[B`, which it scrolls with as a
   * fallback), so claiming them is unambiguous; and `\x1b` is compared exactly
   * there, so a full sequence can never fire `Esc back`.
   *
   * Both move from the page ON SCREEN, never from the requested index: the
   * affordance the operator read was derived from that page, so stepping from
   * anything else would skip a page forwards and, from a page-one frame, send
   * `←` forwards too (BB-292 R1).
   *
   * WHERE it is called stays the subclass's decision (BB-294 D3) — on the ticket
   * list it must sit after the `/` search branch, where the arrows are inert
   * while the `/` field is open.
   */
  protected handlePagingInput(input: string, context: ScreenContext): boolean {
    if (input === 'right') return this.goToPage(this.loadedPage + 1, context);
    if (input === 'left') return this.goToPage(this.loadedPage - 1, context);
    return false;
  }

  /**
   * The cursor keys, and only those — `Enter` resolves to a per-screen `activate()`
   * and stays with the subclass, so this returns false for it and the caller's
   * chain continues.
   */
  protected handleCursorInput(input: string, context: ScreenContext): boolean {
    const rows = this.readyValue?.rows;
    if (!rows) return false;
    if (!this.cursor.handle(input, rows.length)) return false;
    context.requestDraw();
    return true;
  }

  /**
   * Show `rows` in place of the loaded page until the next read answers — the
   * optimistic narrowing of a search. It keeps the LOADED page number so a
   * keystroke does not flip `page N`; the total becomes the explicit unknown
   * (`N of ?`); a narrowing that dropped rows stops the window positioning
   * the survivors (BB-312 D4). An emptied list (a refusal) also drops
   * `hasNext`, so `→` cannot re-send the refused query.
   */
  showRows(rows: readonly Row[]): void {
    const current = this.readyValue;
    this.replaceReady({
      hasNext: rows.length === 0 ? false : (current?.hasNext ?? false),
      page: this.loadedPage,
      total: null,
      window:
        current && rows.length === current.rows.length ? current.window : null,
      rows: [...rows],
    });
  }

  /** `page N` for the strip above the table (count sits beside it). */
  protected pagingSegments(): string[] {
    return [`page ${this.loadedPage + 1}`];
  }

  /**
   * `→ next` / `← prev` action-items for the footer — never the body strip
   * (BB-375). Same loaded-page basis as {@link pagingSegments}.
   */
  protected pagingActionItems(): ActionItem[] {
    const shown = this.loadedPage;
    const items: ActionItem[] = [];
    if (this.readyValue?.hasNext) {
      items.push(actionItem('page-next', '→', 'next'));
    }
    if (shown > 0) {
      items.push(actionItem('page-prev', '←', 'prev'));
    }
    return items;
  }

  /**
   * `7 of 1340 run(s)` when the server reported a total, `7 of ? run(s)` when it
   * reported none — the two quantities SIDE BY SIDE, always in the same shape
   * (BB-292 D6c, D6d).
   *
   * The defect D6c replaced: one field, at one place on the line, meant "rows on
   * this page" and then silently switched to meaning "rows in the collection".
   * Nothing on screen marked the switch, so `7+ run(s)` becoming `1340 run(s)`
   * over the same seven rows read as the `closed: hidden` filter having been lost.
   * It had not been. So the row count is the rows actually rendered and never
   * moves, and the total is APPENDED rather than substituted.
   *
   * **D6d — the unknown is spelled.** Omitting an unestablished total made it
   * indistinguishable from a stated one: `20 ticket(s)` was what a server that
   * reports no total, a failed read and a not-yet-loaded page all produced, and an
   * operator could not tell any of them from a counted twenty. `?` occupies the
   * total's own place on the line, so the two cases differ exactly where they
   * differ in fact (AC 8.5, AC 8.6). It is not the older `20+`: that marker claims
   * a LOWER BOUND on the collection, which is a claim about the rows rather than
   * about the total, and on the last page it was simply false.
   *
   * **D6c — the loading window.** With no page loaded there is nothing on screen
   * but `Loading runs…`, so the segment is OMITTED. `0 of ?` would state a row
   * count that is not the rows on screen and imply an empty collection. Callers
   * drop the empty segment, so the line never opens with a dangling separator.
   *
   * **BB-312 — the left-hand side states WHERE the rows sit.** `20 of 60` on
   * pages 1, 2 and 3 alike said how many rows are on screen and how large the
   * collection is, and never where those rows are inside it; `page 2` beside it is
   * a statement about navigation in different units. So where the position is
   * established (see {@link ListScreen.shownRange}) the left-hand side is the
   * RANGE `21–40`, which states the rows on screen more precisely than a count did
   * — it carries both where they are and that there are twenty of them. D6c is
   * untouched by that: the left-hand side still describes only the rows on screen
   * and the total is still APPENDED after `of`, never substituted, and a range can
   * never be misread as a collection size because a collection size is a single
   * number standing to the right of `of`. D6d is untouched too — `21–40 of ?` is
   * coherent, the position established and the total not. Where the position is
   * NOT established the label is today's row count: less informative, always true.
   */
  protected countLabel(): string {
    const value = this.readyValue;
    if (!value) return '';
    const range = this.shownRange(value);
    // Both bounds always, even when they are equal: a bare `21` would stand
    // exactly where the fallback's row COUNT stands (BB-312 D2).
    const shown = range
      ? `${range.first}–${range.last}`
      : `${value.rows.length}`;
    return `${shown} of ${value.total ?? '?'} ${this.table.noun}(s)`;
  }

  /**
   * The 1-based positions the shown rows occupy in the collection, or `null` when
   * that is not established (BB-312 D5).
   *
   * A page that came back FULL is exactly the window the request asked for, so
   * its rows sit at `offset+1 … offset+limit`: since BB-305 the server skips
   * and counts the same access-filtered collection, so the offset is a position
   * in the collection the total describes. A SHORT page is positionable only
   * where something independent witnesses its end, and the only witness available
   * is a known total the page runs up to. `hasNext === false` is deliberately not
   * one: it says the page is last, not that nothing was dropped inside it.
   */
  private shownRange(value: Page<Row>): { first: number; last: number } | null {
    const window = value.window;
    const shown = value.rows.length;
    if (!window || shown === 0) return null;
    const first = window.offset + 1;
    const last = window.offset + shown;
    // Two numbers that contradict each other are not a position (R1).
    if (value.total !== null && last > value.total) return null;
    if (shown === window.limit) return { first, last };
    if (value.total !== null && last === value.total) return { first, last };
    return null;
  }

  /** Clamped for the same reason a stale `closed` is normalised: a saved token must
   *  not smuggle a negative or fractional offset into the query. */
  protected restorePage(saved: { page?: unknown }): void {
    this.page = Math.max(0, Math.trunc(Number(saved.page ?? 0)) || 0);
  }

  /** Everything this base owns, back to its initial state. A reset means a new
   *  project or session, hence a different collection. */
  protected resetList(): void {
    this.page = 0;
    this.cursor.reset();
  }

  /**
   * The kernel's shared `R` (BB-285 D2): re-read the page on screen.
   *
   * That is the whole of it since BB-292 D6e. It used to also discard a
   * remembered count, because a background walk that failed or hit its read budget
   * was remembered as answered and `R` was the operator's only way back to a real
   * total. With the total riding the page response, re-reading the page IS
   * re-reading the total, and there is nothing separate left to forget.
   */
  reload(context: ScreenContext): Promise<void> {
    return this.retry(context);
  }

  protected async load(context: ScreenContext): Promise<Page<Row>> {
    const loaded = await this.loadRows(context, this.page);
    const filter = this.filterRow;
    if (!filter) return loaded;
    const rows = loaded.rows.filter((row) => filter.call(this, row));
    // A narrowing that DROPPED rows leaves the survivors scattered through the
    // window the server was asked for, so the window no longer positions them
    // (BB-312 D4) and the label falls back to a plain count. A narrowing that
    // dropped nothing changes no position and keeps it.
    return rows.length === loaded.rows.length
      ? { ...loaded, rows }
      : { ...loaded, rows, window: null };
  }

  /**
   * BB-340 D1 — the ready page as the renderable tree the screen hands over.
   *
   * MOUNTED WHOLE: a converted body gets no virtual window (`Kernel/chrome.ts`),
   * so every row is a real renderable and `@opentui/core@0.5.1`'s ceiling of
   * 16 382 of them is the bound to check. A page is `LIST_PAGE_SIZE` rows — 20 —
   * and both queries send it as `page[limit]`, so a full ticket page is one
   * header plus 20 rows, each a box of 8 cells: 190 renderables, and the run
   * list's 6 columns make 148. The list cannot grow past its page: paging
   * REPLACES the rows, it never appends. Three orders of magnitude of headroom,
   * which is why this screen windows nothing of its own.
   */
  protected renderReady(value: Page<Row>, context: ScreenContext): VNode {
    return listTableTree(this.table, value.rows, this.tableContext(context), {
      selectedIndex: this.selectedIndex,
    });
  }
}
