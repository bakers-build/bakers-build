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
import { DEFAULT_RUN_CRITERIA, type RunCriteria } from '../Data/query.js';
import {
  loadUserRuns,
  RUN_TABLE,
  type RunPage,
  type RunRow,
  selectedRunTicketId,
} from '../Data/runs.js';

/** Shared member run list behavior; subclasses own scope and loading. */
export abstract class MemberRunsScreen extends ListScreen<RunRow, number> {
  readonly frameId = 'user-runs';
  protected readonly table = RUN_TABLE;
  private criteria: RunCriteria = { ...DEFAULT_RUN_CRITERIA };

  protected tableContext(context: ScreenContext): number {
    return context.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
  }

  protected abstract loadRows(
    context: ScreenContext,
    page: number,
  ): Promise<RunPage>;

  protected runCriteria(): RunCriteria {
    return this.criteria;
  }

  protected override filterRow(row: RunRow): boolean {
    return this.criteria.closed === null || row.closed === this.criteria.closed;
  }

  protected renderLoading(): string[] {
    return ['Loading runs…'];
  }

  protected badges(): readonly ListFilterBadge[] {
    if (this.criteria.closed === null) {
      return [{ id: 'closed', label: 'x closed' }];
    }
    return [
      {
        id: 'closed',
        label: 'x closed',
        value: this.criteria.closed ? 'closed: only' : 'closed: hidden',
      },
    ];
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
      title: `${name} · runs`,
      meta: pagingLine,
    };
  }

  protected actions() {
    return [
      actionItem('user-runs-enter', 'Enter', 'ticket'),
      actionItem('user-runs-tab', 'Tab', 'tabs'),
      ...this.pagingActionItems(),
    ];
  }

  activate(index: number, context: ScreenContext): boolean {
    const id = this.readyValue
      ? selectedRunTicketId(this.readyValue.rows, index)
      : null;
    if (!id || !context.navigate) return false;
    context.navigate('ticket.runs', { ticketId: id });
    return true;
  }

  override handleInput(input: string, context: ScreenContext): boolean {
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
}

export class WorkspaceMemberRunsScreen extends MemberRunsScreen {
  static readonly route = {
    id: 'workspace.member.runs',
    path: '/members/:userId/runs',
    fallback: { routeId: 'workspace.members', preserveParams: true },
    tab: {
      id: 'runs',
      label: 'Runs',
      scope: 'workspace-member',
      weight: 40,
    },
  } satisfies RouteMetadata;
  readonly id = WorkspaceMemberRunsScreen.route.id;

  protected async loadRows(
    context: ScreenContext,
    page: number,
  ): Promise<RunPage> {
    if (!context.services) throw new Error('Member runs requires services');
    const userId = context.user?.id ?? context.params?.userId;
    if (!userId) throw new Error('Member runs requires userId');
    const workspaceId =
      context.params?.workspaceId ?? context.services.workspaceId;
    if (!workspaceId) throw new Error('Member runs requires workspaceId');
    await assertActiveMember(
      context.services.client,
      'bb_workspace',
      workspaceId,
      userId,
    );
    const result = await loadUserRuns(
      context.services.client,
      userId,
      this.runCriteria(),
      page,
    );
    if (result.withheld)
      throw new Error('the control plane withheld member run rows');
    return result;
  }
}
