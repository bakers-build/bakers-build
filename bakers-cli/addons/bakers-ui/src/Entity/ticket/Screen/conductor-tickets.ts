import { actionItem } from '../../../Component/footer-actions/index.js';
import { flattenSections } from '../../../Component/section-list/index.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import type {
  FullScreenChrome,
  ListFilterBadge,
} from '../../../Screen/full-screen.js';
import { ListScreen } from '../../../Screen/list-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import { listTableRows, loadPage, type Page } from '../../collection.js';
import {
  type ConductorDetail,
  readConductorDetail,
} from '../../conductor/Data/detail.js';
import { conductorTitle } from '../../conductor/Screen/conductor-overview.js';
import { LIST_PAGE_SIZE } from '../../cycle.js';
import { buildConductorTicketQueryParams } from '../Data/query.js';
import {
  CONDUCTOR_TICKET_TABLE,
  mapTicketData,
  type TicketRow,
} from '../Data/tickets.js';
import { TicketSearch } from './ticket-search.js';

/** Assigned — the open tickets held by one conductor. */
export class ConductorTicketsScreen extends ListScreen<TicketRow, void> {
  static readonly route = {
    id: 'conductor.tickets',
    path: '/conductors/:conductorId/tickets',
    parent: 'conductors',
    tab: { id: 'tickets', label: 'Assigned', scope: 'conductor', weight: 30 },
    fallback: { routeId: 'conductors' },
  } satisfies RouteMetadata;
  readonly id = ConductorTicketsScreen.route.id;
  readonly frameId = 'conductor';
  protected readonly table = CONDUCTOR_TICKET_TABLE;
  searchQuery = '';
  private readonly search = new TicketSearch(this);

  reloadSearch(context: ScreenContext): Promise<boolean> {
    this.page = 0;
    this.selectedIndex = 0;
    return this.reloadInPlace(context);
  }

  protected tableContext(): void {
    // No clock/context needed for this table.
  }

  protected loadRows(
    context: ScreenContext,
    page: number,
  ): Promise<Page<TicketRow>> {
    if (!context.services) throw new Error('Assigned requires services');
    const conductorId = context.params?.conductorId ?? '';
    const window = { offset: page * LIST_PAGE_SIZE, limit: LIST_PAGE_SIZE };
    const params = buildConductorTicketQueryParams(
      conductorId,
      { size: window.limit, index: page },
      this.searchQuery,
    );
    return loadPage(
      context.services.client,
      'bb_ticket/bb_ticket',
      params,
      (data, included) => {
        const index = new Map(
          included.filter((r) => r.id).map((r) => [r.id as string, r]),
        );
        return data.map((item) => mapTicketData(item, index));
      },
      page,
      window,
    );
  }

  protected renderLoading(): string[] {
    return ['Loading assigned tickets…'];
  }

  protected chrome(): FullScreenChrome {
    return {
      selectable: this.rows.length,
      selectedIndex: this.selectedIndex,
      rowIds: this.rowNodeIds,
      title: conductorTitle(this.headerDetail),
      meta: [
        [this.countLabel(), ...this.pagingSegments()]
          .filter(Boolean)
          .join(' · '),
        this.search.hint(),
      ]
        .filter(Boolean)
        .join('  ·  '),
    };
  }

  protected badges(): readonly ListFilterBadge[] {
    return [this.search.badge()];
  }

  protected notice(): string | undefined {
    return this.search.status || undefined;
  }

  protected actions() {
    return [
      ...(this.rows.length > 0
        ? [actionItem('conductor-tickets-enter', 'Enter', 'open')]
        : []),
      actionItem('conductor-tickets-tab', 'Tab', 'tabs'),
      ...this.pagingActionItems(),
    ];
  }

  activate(index: number, context: ScreenContext): boolean {
    const id = this.rows[index]?.id;
    if (!id || !context.navigate) return false;
    context.navigate('ticket.detail', { ticketId: id });
    return true;
  }

  select(index: number, context: ScreenContext): boolean {
    if (index < 0 || index >= this.rows.length) return false;
    this.selectedIndex = index;
    context.requestDraw();
    return true;
  }

  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    if (this.search.handleKey(input, context)) return true;
    if (this.handlePagingInput(input, context)) return true;
    if (this.handleCursorInput(input, context)) return true;
    if (input === 'enter') return this.activate(this.selectedIndex, context);
    return false;
  }

  private headerDetail: ConductorDetail | undefined;

  protected override didLoad(
    _data: Page<TicketRow>,
    context: ScreenContext,
  ): void {
    const conductorId = context.params?.conductorId ?? '';
    if (!conductorId || !context.services || this.headerDetail) return;
    void readConductorDetail(context, conductorId).then((detail) => {
      this.headerDetail = detail;
      context.requestDraw();
    });
  }

  override leave(): void {
    this.search.close();
    super.leave();
  }

  override reset(): void {
    this.resetList();
    this.searchQuery = '';
    this.search.reset();
    this.headerDetail = undefined;
    super.reset();
  }

  /** The pipe's own text — the same table + rows the drawn tree uses. */
  renderNonInteractive(): string[] {
    return flattenSections([
      {
        heading: 'Assigned',
        lines: listTableRows(CONDUCTOR_TICKET_TABLE, this.rows, undefined),
      },
    ]).lines;
  }
}
