import { existsSync } from 'node:fs';
import { actionItem } from '../../../Component/footer-actions/index.js';
import type { ListFilterBadge } from '../../../Component/list-chrome/index.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import { ListScreen } from '../../../Screen/list-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import type { Page } from '../../collection.js';
import { resolveWhoCandidate } from '../../user/Data/users.js';
import {
  CONDUCTOR_TABLE,
  type ConductorListContext,
  type ConductorQuery,
  type ConductorRow,
  countConductors,
  listConductorRowPage,
  listProjectNames,
} from '../Data/conductors.js';
import {
  DEFAULT_CONDUCTOR_MINE,
  hiddenNotice,
  mineBadges,
  OwnerIdentity,
} from '../Data/own-rows.js';
import { createConductorProcessHost } from '../Data/process.js';

/**
 * Conductors list — an ordinary {@link ListScreen}, paged and filtered to the
 * operator's own conductors by default (BB-460 D1). A row only opens its
 * conductor's detail; start, stop and Restart runs live there (BAKERS-338).
 *
 * Refresh is the shared mechanism (BB-376 `ui-refresh` file + `R`), not a
 * screen-private timer. Enter loads; navigation away cancels in-flight reads
 * via the async lifecycle.
 */
export class ConductorsScreen extends ListScreen<
  ConductorRow,
  ConductorListContext
> {
  static readonly route = {
    id: 'conductors',
    path: '/conductors',
    parent: 'machines',
  } satisfies RouteMetadata;
  readonly id: string = ConductorsScreen.route.id;
  readonly frameId = 'conductors';
  protected readonly table = CONDUCTOR_TABLE;
  /** BB-460 review — how `mine` failed to resolve. */
  private identityReason = '';
  private mine = DEFAULT_CONDUCTOR_MINE;
  private readonly identity = new OwnerIdentity(resolveWhoCandidate);
  private ownerId: string | undefined;
  private projectNames: ReadonlyMap<string, string> = new Map();
  private hidden: number | null = null;

  protected tableContext(context: ScreenContext): ConductorListContext {
    return {
      nowSeconds: context.nowSeconds?.() ?? Math.floor(Date.now() / 1000),
      busyIds: new Set(),
      projectNames: this.projectNames,
    };
  }

  /**
   * BB-460 D5 — the identity is resolved BEFORE the first read, because the
   * filter is on by default. Every way of failing to establish it loads the
   * FULL list and states the reason: a cockpit that cannot prove who you are
   * shows you everything, never an empty list it cannot explain.
   */
  protected async loadRows(
    context: ScreenContext,
    page: number,
  ): Promise<Page<ConductorRow>> {
    if (!context.services) throw new Error('Conductors requires services');
    const client = context.services.client;
    const host =
      context.services.conductorProcess ?? createConductorProcessHost();
    const [projectNames, thisHostKey] = await Promise.all([
      listProjectNames(client),
      host.thisHostKey(),
    ]);
    this.projectNames = projectNames;
    this.ownerId = undefined;
    this.identityReason = '';
    if (this.mine) {
      const outcome = await this.identity.resolve(
        client,
        context.services.currentUser,
      );
      if (outcome.kind === 'resolved') {
        this.ownerId = outcome.id;
      } else {
        this.identityReason = outcome.reason;
      }
    }
    const machineId = context.params?.machineId;
    const query: ConductorQuery = {
      ...(this.ownerId ? { ownerUserId: this.ownerId } : {}),
      ...(machineId ? { machineId } : {}),
    };
    const rowCtx = {
      now: context.nowSeconds?.() ?? Math.floor(Date.now() / 1000),
      exists: existsSync,
      thisHostKey,
    };
    const rows = await listConductorRowPage(client, rowCtx, query, page);
    // AC-2 — the difference of two SERVER totals, never of two row counts: a
    // row count is bounded by the page, so it would under-report exactly when
    // the collection is large enough for the question to matter.
    this.hidden =
      !query.ownerUserId || rows.total === null
        ? null
        : ((total) => (total === null ? null : total - (rows.total ?? 0)))(
            await countConductors(client, machineId ? { machineId } : {}),
          );
    return rows;
  }

  protected badges(): readonly ListFilterBadge[] {
    return mineBadges(this.mine);
  }

  protected renderLoading(): string[] {
    return ['Loading conductors…'];
  }

  protected chrome(_context: ScreenContext): FullScreenChrome {
    return {
      selectable: this.rows.length,
      selectedIndex: this.selectedIndex,
      rowIds: this.rowNodeIds,
      title: 'bakers.build conductors',
      meta: [
        this.countLabel(),
        ...this.pagingSegments(),
        hiddenNotice(this.hidden),
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }

  protected actions() {
    return [
      actionItem('conductors-enter', 'Enter', 'open'),
      actionItem('conductors-tab', 'Tab', 'tabs'),
      ...this.pagingActionItems(),
    ];
  }

  protected override notice(): string | undefined {
    return this.identityReason || undefined;
  }

  override select(index: number, context: ScreenContext): boolean {
    if (index < 0 || index >= this.rows.length) return false;
    this.selectedIndex = index;
    this.toast = '';
    context.requestDraw();
    return true;
  }

  /**
   * The `mine` gate that used to sit here moved onto the log tab: a row on
   * another machine still opens, and its Log tab is where "no log here" is
   * now said (see `Entity/conductor/Data/log-block.ts`).
   */
  activate(index: number, context: ScreenContext): boolean {
    const row = this.rows[index];
    if (!row?.id || !context.navigate) return false;
    context.navigate('conductor.overview', { conductorId: row.id });
    return true;
  }

  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    if (input === 'enter') return this.activate(this.selectedIndex, context);
    if (input === 'm') {
      this.mine = !this.mine;
      this.page = 0;
      this.selectedIndex = 0;
      this.toast = '';
      this.retry(context);
      return true;
    }
    if (input === 'c') {
      this.mine = DEFAULT_CONDUCTOR_MINE;
      this.page = 0;
      this.selectedIndex = 0;
      this.toast = '';
      this.retry(context);
      return true;
    }
    if (this.handlePagingInput(input, context)) return true;
    if (this.handleCursorInput(input, context)) return true;
    return false;
  }

  override reset(): void {
    this.resetList();
    this.mine = DEFAULT_CONDUCTOR_MINE;
    this.identity.reset();
    this.ownerId = undefined;
    this.hidden = null;
    this.identityReason = '';
    super.reset();
  }
}

/** The machine detail scope's Conductors tab: the list above, one machine's. */
export class MachineConductorsScreen extends ConductorsScreen {
  static override readonly route = {
    id: 'machine.conductors',
    path: '/machines/:machineId/conductors',
    parent: 'machines',
    tab: {
      id: 'conductors',
      label: 'Conductors',
      scope: 'machine',
      weight: 20,
    },
    fallback: { routeId: 'machines' },
  } satisfies RouteMetadata;
  override readonly id: string = MachineConductorsScreen.route.id;
}
