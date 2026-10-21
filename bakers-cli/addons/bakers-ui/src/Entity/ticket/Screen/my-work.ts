import type { VNode } from '@opentui/core';
import { actionItem } from '../../../Component/footer-actions/index.js';
import { ListCursor } from '../../../lib/cursor.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncScreen } from '../../../Screen/async-screen.js';
import type {
  FullScreenChrome,
  ListFilterBadge,
} from '../../../Screen/full-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import { listRowIds, listTableTree } from '../../collection.js';
import { resolveWhoCandidate } from '../../user/Data/users.js';
import {
  DEFAULT_TICKET_CRITERIA,
  describeCriteria,
  type TicketCriteria,
} from '../Data/query.js';
import {
  loadFilteredUserTickets,
  TICKET_TABLE,
  type TicketPage,
  type TicketRow,
} from '../Data/tickets.js';
import { TicketFilterBar } from './ticket-filter-bar.js';
import { TicketSearch } from './ticket-search.js';

interface MyWorkResult {
  userName: string;
  page: TicketPage;
}

const MY_WORK_TABLE = {
  ...TICKET_TABLE,
  emptyMessage: 'No open tickets.',
};

export class MyWorkScreen extends AsyncScreen<MyWorkResult> {
  readonly frameId = 'my-work';
  static readonly route = {
    id: 'my.work',
    path: '/work',
    tab: { id: 'my-work', label: 'My work', scope: 'root', weight: 5 },
  } satisfies RouteMetadata;
  readonly id = MyWorkScreen.route.id;
  private readonly cursor = new ListCursor();
  private currentCriteria: TicketCriteria = { ...DEFAULT_TICKET_CRITERIA };
  // BB-540: a single bar shared with the project ticket list, disabled for
  // `who` (My work = my tickets, the criterion is implicit) and `mine` (the
  // shortcut makes no sense when the assignee is fixed). The bar still
  // dispatches `s`/`x`/`p`/`r`/`c`. The bar's `applyTo` still guards
  // state/closed/parent/project on a cached re-entry; the search line is
  // the server's.
  private readonly filter = new TicketFilterBar(this, new Set(['who', 'mine']));
  private readonly search = new TicketSearch(this);

  get rows(): readonly TicketRow[] {
    return this.readyValue?.page.rows ?? [];
  }

  get searchQuery(): string {
    return this.currentCriteria.query;
  }
  set searchQuery(query: string) {
    this.currentCriteria = { ...this.currentCriteria, query };
  }

  showRows(rows: readonly TicketRow[]): void {
    const current = this.readyValue;
    if (!current) return;
    this.replaceReady({
      ...current,
      page: { ...current.page, rows: [...rows], total: null, window: null },
    });
  }

  reloadSearch(context: ScreenContext): Promise<boolean> {
    this.cursor.reset();
    return this.reloadInPlace(context);
  }

  reload(context: ScreenContext): void {
    this.retry(context);
  }

  protected async load(context: ScreenContext): Promise<MyWorkResult> {
    if (!context.services) throw new Error('My work requires services');
    const currentUser = context.services.currentUser;
    if (!currentUser) throw new Error('My work requires a current user');
    const identity = await resolveWhoCandidate(
      context.services.client,
      currentUser,
    );
    if (identity.error) throw new Error(identity.error);
    const user = identity.rows[0];
    if (!user) throw new Error(`current user '${currentUser}' was not found`);
    return {
      userName: user.label,
      // BB-540: server-side filtered (was `loadAllUserTickets`, which paged
      // every open ticket). The My work overload passes
      // `projectFromCriteria: true` to the builder, so `criteria.project`
      // becomes a filter when set. Every other criterion rides along as
      // before.
      page: await loadFilteredUserTickets(
        context.services.client,
        user.id,
        this.currentCriteria,
        0,
      ),
    };
  }

  protected renderLoading(): string[] {
    return ['Loading my work…'];
  }

  protected renderReady(result: MyWorkResult): VNode {
    return listTableTree(MY_WORK_TABLE, result.page.rows, undefined, {
      selectedIndex: this.cursor.index,
    });
  }

  renderNonInteractive(context: ScreenContext): string[] {
    const notice = this.noticeRows(context);
    if (notice) return notice;
    return this.rows.length === 0
      ? [MY_WORK_TABLE.emptyMessage]
      : this.rows.map((row) => `${row.identifier}  ${row.state}  ${row.title}`);
  }

  protected chrome(context: ScreenContext): FullScreenChrome {
    const describe = describeCriteria(this.currentCriteria);
    const meta = [
      `${this.rows.length} open ticket(s)`,
      describe,
      context.services?.workspace ?? '',
      this.search.hint(),
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      title: 'My work',
      meta,
      selectable: this.rows.length,
      selectedIndex: this.cursor.index,
      rowIds: listRowIds(MY_WORK_TABLE, this.rows),
    };
  }

  /**
   * BB-540 — the filter chips as a single helper the bar already owns.
   * `disable: new Set(['who', 'mine'])` drops those two; the remaining six
   * render in the order spec F1 / the test amendment pinned (search · state ·
   * parent · project · closed · clear).
   */
  protected badges(): readonly ListFilterBadge[] {
    return this.filter.badges();
  }

  protected notice(): string | undefined {
    return this.search.status || undefined;
  }

  protected actions() {
    return [
      actionItem('my-work-open', 'Enter', 'open'),
      actionItem('my-work-tab', 'Tab', 'tabs'),
    ];
  }

  activate(index: number, context: ScreenContext): boolean {
    const row = this.rows[index];
    if (!row || !context.navigate) return false;
    context.navigate('ticket.detail', { ticketId: row.id });
    return true;
  }

  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    // The open search field takes every key, so it goes before the bar.
    if (this.search.handleKey(input, context)) return true;
    // The bar next: its key dispatch covers `s`/`x`/`p`/`r`/`c`. The
    // cursor/enter branches stay below so the bar claims only the keys it
    // names.
    if (this.filter.handleKey(input, context)) return true;
    if (this.cursor.handle(input, this.rows.length)) {
      context.requestDraw();
      return true;
    }
    if (input === 'enter') return this.activate(this.cursor.index, context);
    return false;
  }

  override leave(): void {
    this.search.close();
    super.leave();
  }

  override reset(): void {
    this.search.reset();
    this.cursor.reset();
    this.currentCriteria = { ...DEFAULT_TICKET_CRITERIA };
    super.reset();
  }

  // ---- TicketFilterBarHost -------------------------------------------------

  get criteria(): TicketCriteria {
    return this.currentCriteria;
  }

  /** Reload through `retry`, mirroring `TicketsScreen.setCriteria`. */
  setCriteria(next: TicketCriteria, context: ScreenContext): void {
    this.currentCriteria = { ...next };
    this.cursor.reset();
    this.retry(context);
  }

  /** My work has no `mine` shortcut — the assignee is the current user. */
  resolveMine(): undefined {
    return undefined;
  }

  /** The bar dispatches `r` only when the host marks itself as My work. */
  navigateToProjectFilter(context: ScreenContext): boolean {
    return context.navigate?.('my.work.project-filter', {}) ?? false;
  }

  /** Mirror of `TicketsScreen.filterRow` — delegates to the bar. */
  protected filterRow(row: TicketRow): boolean {
    return this.filter.applyTo(row);
  }
}
