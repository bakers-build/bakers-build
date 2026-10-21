import { actionItem } from '../../../Component/footer-actions/index.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import type {
  FullScreenChrome,
  ListFilterBadge,
} from '../../../Screen/full-screen.js';
import { ListScreen } from '../../../Screen/list-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import { CLOSED_FILTER_VALUES, cycleValue } from '../../cycle.js';
import { assertActiveMember } from '../../user/Data/member-context.js';
import { DEFAULT_TICKET_CRITERIA, type TicketCriteria } from '../Data/query.js';
import {
  loadUserTickets,
  TICKET_TABLE,
  type TicketPage,
  type TicketRow,
} from '../Data/tickets.js';
import { TicketSearch } from './ticket-search.js';

/** Shared member ticket list behavior; subclasses own scope and loading. */
export abstract class MemberTicketsScreen extends ListScreen<TicketRow, void> {
  readonly frameId = 'user-tickets';
  protected readonly table = TICKET_TABLE;
  private criteria: TicketCriteria = { ...DEFAULT_TICKET_CRITERIA };
  private readonly search = new TicketSearch(this);

  get searchQuery(): string {
    return this.criteria.query;
  }
  set searchQuery(query: string) {
    this.criteria = { ...this.criteria, query };
  }

  reloadSearch(context: ScreenContext): Promise<boolean> {
    this.page = 0;
    this.selectedIndex = 0;
    return this.reloadInPlace(context);
  }

  protected tableContext(): void {}

  protected abstract loadRows(
    context: ScreenContext,
    page: number,
  ): Promise<TicketPage>;

  protected ticketCriteria(): TicketCriteria {
    return this.criteria;
  }

  protected override filterRow(row: TicketRow): boolean {
    return this.criteria.closed === null || row.closed === this.criteria.closed;
  }

  protected renderLoading(): string[] {
    return ['Loading tickets…'];
  }

  protected badges(): readonly ListFilterBadge[] {
    if (this.criteria.closed === null) {
      return [this.search.badge(), { id: 'closed', label: 'x closed' }];
    }
    return [
      this.search.badge(),
      {
        id: 'closed',
        label: 'x closed',
        value: this.criteria.closed ? 'closed: only' : 'closed: hidden',
      },
    ];
  }

  protected notice(): string | undefined {
    return this.search.status || undefined;
  }

  protected chrome(context: ScreenContext): FullScreenChrome {
    const name = context.user?.name ?? context.params?.userName ?? 'user';
    const pagingLine = [this.countLabel(), ...this.pagingSegments()]
      .filter(Boolean)
      .join(' · ');
    return {
      selectable: this.rows.length,
      selectedIndex: this.selectedIndex,
      rowIds: this.rowNodeIds,
      title: `${name} · tickets`,
      meta: [pagingLine, this.search.hint()].filter(Boolean).join('  ·  '),
    };
  }

  protected actions() {
    return [
      actionItem('user-tickets-enter', 'Enter', 'open'),
      actionItem('user-tickets-tab', 'Tab', 'tabs'),
      ...this.pagingActionItems(),
    ];
  }

  activate(index: number, context: ScreenContext): boolean {
    const row = this.rows[index];
    if (!row || !context.navigate) return false;
    context.navigate('ticket.detail', { ticketId: row.id });
    return true;
  }

  override handleInput(input: string, context: ScreenContext): boolean {
    if (this.search.handleKey(input, context)) return true;
    if (input === 'x') {
      this.criteria = {
        ...this.criteria,
        closed: cycleValue(CLOSED_FILTER_VALUES, this.criteria.closed),
      };
      this.page = 0;
      this.retry(context);
      return true;
    }
    if (this.handlePagingInput(input, context)) return true;
    if (this.handleCursorInput(input, context)) return true;
    if (input === 'enter') return this.activate(this.selectedIndex, context);
    return super.handleInput(input, context);
  }

  override leave(): void {
    this.search.close();
    super.leave();
  }

  override reset(): void {
    this.criteria = { ...this.criteria, query: '' };
    this.search.reset();
    super.reset();
  }
}

export class WorkspaceMemberTicketsScreen extends MemberTicketsScreen {
  static readonly route = {
    id: 'workspace.member.tickets',
    path: '/members/:userId/tickets',
    fallback: { routeId: 'workspace.members', preserveParams: true },
    tab: {
      id: 'tickets',
      label: 'Tickets',
      scope: 'workspace-member',
      weight: 30,
    },
  } satisfies RouteMetadata;
  readonly id = WorkspaceMemberTicketsScreen.route.id;

  protected async loadRows(
    context: ScreenContext,
    page: number,
  ): Promise<TicketPage> {
    if (!context.services) throw new Error('Member tickets requires services');
    const userId = context.user?.id ?? context.params?.userId;
    if (!userId) throw new Error('Member tickets requires userId');
    const workspaceId =
      context.params?.workspaceId ?? context.services.workspaceId;
    if (!workspaceId) throw new Error('Member tickets requires workspaceId');
    await assertActiveMember(
      context.services.client,
      'bb_workspace',
      workspaceId,
      userId,
    );
    const result = await loadUserTickets(
      context.services.client,
      userId,
      this.ticketCriteria(),
      page,
    );
    if (result.withheld)
      throw new Error('the control plane withheld member ticket rows');
    return result;
  }
}
