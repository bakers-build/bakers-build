import { actionItem } from '../../../Component/footer-actions/index.js';
import { flattenSections } from '../../../Component/section-list/index.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import { ListScreen } from '../../../Screen/list-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import { listTableRows, loadPage, type Page } from '../../collection.js';
import { LIST_PAGE_SIZE } from '../../cycle.js';
import { buildConductorRunQueryParams } from '../../run/Data/query.js';
import {
  CONDUCTOR_RUN_TABLE,
  mapRunData,
  type RunRow,
} from '../../run/Data/runs.js';
import { deriveRunStatus } from '../../run/Data/status.js';
import { type ConductorDetail, readConductorDetail } from '../Data/detail.js';
import { conductorTitle } from './conductor-overview.js';

/** Held work — the runs one conductor currently holds (claimed/running). */
export class ConductorRunsScreen extends ListScreen<RunRow, number> {
  static readonly route = {
    id: 'conductor.runs',
    path: '/conductors/:conductorId/runs',
    parent: 'conductors',
    tab: { id: 'runs', label: 'Held work', scope: 'conductor', weight: 20 },
    fallback: { routeId: 'conductors' },
  } satisfies RouteMetadata;
  readonly id = ConductorRunsScreen.route.id;
  readonly frameId = 'conductor';
  protected readonly table = CONDUCTOR_RUN_TABLE;

  protected tableContext(context: ScreenContext): number {
    return context.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
  }

  protected loadRows(
    context: ScreenContext,
    page: number,
  ): Promise<Page<RunRow>> {
    if (!context.services) throw new Error('Held work requires services');
    const conductorId = context.params?.conductorId ?? '';
    const window = { offset: page * LIST_PAGE_SIZE, limit: LIST_PAGE_SIZE };
    const params = buildConductorRunQueryParams(conductorId, {
      size: window.limit,
      index: page,
    });
    return loadPage(
      context.services.client,
      'bb_run/bb_run',
      params,
      (data, included) => {
        const ticketsById = new Map(
          included.filter((r) => r.id).map((r) => [r.id as string, r]),
        );
        return data.map((item) => mapRunData(item, ticketsById));
      },
      page,
      window,
    );
  }

  protected renderLoading(): string[] {
    return ['Loading held work…'];
  }

  protected chrome(context: ScreenContext): FullScreenChrome {
    const nowSeconds = this.tableContext(context);
    const stale = this.rows.filter(
      (row) => deriveRunStatus(row, nowSeconds) === 'stale',
    ).length;
    return {
      selectable: this.rows.length,
      selectedIndex: this.selectedIndex,
      rowIds: this.rowNodeIds,
      title: conductorTitle(this.headerDetail),
      meta: [
        this.countLabel(),
        ...(stale > 0 ? [`${stale} stale`] : []),
        ...this.pagingSegments(),
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }

  protected actions() {
    return [
      ...(this.rows.length > 0
        ? [actionItem('conductor-runs-enter', 'Enter', 'ticket')]
        : []),
      actionItem('conductor-runs-tab', 'Tab', 'tabs'),
      ...this.pagingActionItems(),
    ];
  }

  activate(index: number, context: ScreenContext): boolean {
    const ticketId = this.rows[index]?.ticketId;
    if (!ticketId || !context.navigate) return false;
    context.navigate('ticket.runs', { ticketId });
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
    if (this.handlePagingInput(input, context)) return true;
    if (this.handleCursorInput(input, context)) return true;
    if (input === 'enter') return this.activate(this.selectedIndex, context);
    return false;
  }

  /**
   * The header title needs the shared conductor label. Loaded once here (the
   * store-cached read is cheap on a repeat) rather than threading it through
   * `loadRows`'s row type.
   */
  private headerDetail: ConductorDetail | undefined;

  protected override didLoad(
    _data: Page<RunRow>,
    context: ScreenContext,
  ): void {
    const conductorId = context.params?.conductorId ?? '';
    if (!conductorId || !context.services || this.headerDetail) return;
    void readConductorDetail(context, conductorId).then((detail) => {
      this.headerDetail = detail;
      context.requestDraw();
    });
  }

  override reset(): void {
    this.resetList();
    this.headerDetail = undefined;
    super.reset();
  }

  /**
   * The pipe's own text — the SAME table + rows the drawn tree uses, through
   * `listTableRows` rather than a second description (Task 8's anti-drift
   * pattern).
   */
  renderNonInteractive(context: ScreenContext): string[] {
    const nowSeconds = this.tableContext(context);
    return flattenSections([
      {
        heading: 'Held work',
        lines: listTableRows(CONDUCTOR_RUN_TABLE, this.rows, nowSeconds),
      },
    ]).lines;
  }
}
