import { actionItem } from '../../../Component/footer-actions/index.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import type {
  FullScreenChrome,
  ListFilterBadge,
} from '../../../Screen/full-screen.js';
import { ListScreen } from '../../../Screen/list-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import { CLOSED_FILTER_VALUES, cycleValue } from '../../cycle.js';
import { DEFAULT_RUN_CRITERIA, type RunCriteria } from '../Data/query.js';
import {
  loadProjectRuns,
  RUN_TABLE,
  type RunPage,
  type RunRow,
  selectedRunTicketId,
} from '../Data/runs.js';

export class RunsScreen extends ListScreen<RunRow, number> {
  readonly frameId = 'runs';
  protected readonly table = RUN_TABLE;
  static readonly route = {
    id: 'project.runs',
    path: '/projects/:projectId/runs',
    parent: 'project.overview',
    tab: { id: 'runs', label: 'Runs', scope: 'project', weight: 40 },
  } satisfies RouteMetadata;
  readonly id = RunsScreen.route.id;
  private criteria: RunCriteria = { ...DEFAULT_RUN_CRITERIA };
  saveState(): {
    criteria: RunCriteria;
    page: number;
    selectedRunId: string | null;
  } {
    return {
      criteria: { ...this.criteria },
      page: this.page,
      selectedRunId: this.rows[this.selectedIndex]?.id ?? null,
    };
  }
  restoreState(token: unknown): void {
    if (!token || typeof token !== 'object') return;
    const saved = token as {
      criteria?: RunCriteria;
      page?: unknown;
      selectedRunId?: unknown;
    };
    if (saved.criteria) {
      this.criteria = { ...saved.criteria };
      // Tokens saved before BB-282 carry no closed; normalize so a stale
      // token cannot smuggle undefined into a predicate testing !== null.
      this.criteria.closed =
        this.criteria.closed ?? DEFAULT_RUN_CRITERIA.closed;
    }
    // Clamped for the same reason `closed` is normalised above: a stale token
    // must not smuggle a negative offset into the query.
    this.restorePage(saved);
    if (typeof saved.selectedRunId !== 'string') return;
    const index = this.rows.findIndex((row) => row.id === saved.selectedRunId);
    if (index >= 0) this.selectedIndex = index;
  }
  /** STATE is the derived liveness status and STARTED the relative start age, so
   *  the columns need a clock the row does not carry. */
  protected tableContext(context: ScreenContext): number {
    return context.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
  }
  protected loadRows(context: ScreenContext, page: number): Promise<RunPage> {
    if (!context.services || !context.project)
      throw new Error('Runs requires project context');
    return loadProjectRuns(
      context.services.client,
      context.project.id,
      this.criteria,
      page,
    );
  }
  /** Server is authoritative; the double-check protects against param-ignoring
   *  clients/test doubles, as on the ticket list. */
  protected override filterRow(row: RunRow): boolean {
    return this.criteria.closed === null || row.closed === this.criteria.closed;
  }
  protected renderLoading(): string[] {
    return ['Loading runs…'];
  }
  /** Runs expose only the closed cycle — one badge, always shown (BB-375 A′). */
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
    // Count + page in header meta; ←/→ in footer actions (BB-375 / BB-292).
    const pagingLine = [this.countLabel(), ...this.pagingSegments()]
      .filter(Boolean)
      .join(' · ');
    return {
      selectable: this.rows.length,
      selectedIndex: this.selectedIndex,
      rowIds: this.rowNodeIds,
      title: `${context.project?.name ?? context.project?.slug ?? ''} · runs`,
      meta: pagingLine,
    };
  }

  protected actions() {
    return [
      actionItem('runs-enter', 'Enter', 'ticket'),
      actionItem('runs-tab', 'Tab', 'tabs'),
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
  select(index: number, context: ScreenContext): boolean {
    if (index < 0 || index >= this.rows.length) return false;
    this.selectedIndex = index;
    context.requestDraw();
    return true;
  }
  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    if (input === 'x') {
      this.criteria = {
        ...this.criteria,
        closed: cycleValue(CLOSED_FILTER_VALUES, this.criteria.closed),
      };
      // A criteria change starts over at page one, or narrowing on page 4 lands
      // on an empty page with no rows and no explanation (D5).
      this.page = 0;
      this.selectedIndex = 0;
      this.retry(context);
      return true;
    }
    // The ARROW keys since the operator's live review (D6 chose `]` / `[`); the
    // kernel handles neither sequence itself, so the screen claims them. This
    // screen has no search field, so there is nothing they could shadow.
    // Both move from the page ON SCREEN, never from the requested index (R1).
    if (this.handlePagingInput(input, context)) return true;
    const rows = this.readyValue?.rows;
    if (!rows) return false;
    if (this.handleCursorInput(input, context)) return true;
    if (input === 'enter') return this.activate(this.selectedIndex, context);
    return false;
  }
  override reset(): void {
    // The page, the cursor and the counter — a reset means a new project or
    // session, hence a different collection (BB-294).
    this.resetList();
    this.criteria = { ...DEFAULT_RUN_CRITERIA };
    super.reset();
  }
}
