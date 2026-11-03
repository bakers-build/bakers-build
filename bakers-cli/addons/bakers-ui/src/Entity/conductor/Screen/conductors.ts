import { existsSync } from 'node:fs';
import { actionItem } from '../../../Component/footer-actions/index.js';
import type { ListFilterBadge } from '../../../Component/list-chrome/index.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import { ListScreen } from '../../../Screen/list-screen.js';
import { runRowAction } from '../../../Screen/row-action.js';
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
 * operator's own conductors by default (BB-460 D1).
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
    tab: { id: 'conductors', label: 'Conductors', scope: 'root', weight: 50 },
  } satisfies RouteMetadata;
  readonly id = ConductorsScreen.route.id;
  readonly frameId = 'conductors';
  protected readonly table = CONDUCTOR_TABLE;
  private readonly busyIds = new Set<string>();
  /**
   * BB-460 review — how `mine` failed to resolve, not an action's outcome.
   * Sharing a field with the action toast let `loadRows()` blank a start/stop
   * result on every refresh and let a standing identity reason permanently
   * block {@link viewOnlyNotice}; kept apart, each notice source has its own
   * lifecycle. Action results go on {@link toast}.
   */
  private identityReason = '';
  private mine = DEFAULT_CONDUCTOR_MINE;
  private readonly identity = new OwnerIdentity(resolveWhoCandidate);
  private ownerId: string | undefined;
  private projectNames: ReadonlyMap<string, string> = new Map();
  private hidden: number | null = null;

  protected tableContext(context: ScreenContext): ConductorListContext {
    return {
      nowSeconds: context.nowSeconds?.() ?? Math.floor(Date.now() / 1000),
      busyIds: this.busyIds,
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
    const query: ConductorQuery = this.ownerId
      ? { ownerUserId: this.ownerId }
      : {};
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
      this.ownerId === undefined || rows.total === null
        ? null
        : ((total) => (total === null ? null : total - (rows.total ?? 0)))(
            await countConductors(client, {}),
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

  /**
   * BB-450 review B9 — `s`/`x` are advertised only when the SELECTED row can
   * actually be acted on: `mine` is the identity gate (B10), not `isLocal`'s
   * filesystem check, so a foreign conductor whose workspace happens to exist
   * on this disk (BB-281 Finding 2) is correctly excluded too.
   *
   * `Enter open` is no longer gated on `mine`: it opens the conductor detail
   * scope for every row, and the log tab inside it is the one place that still
   * withholds a foreign conductor's log (its `mine` derivation lives there).
   */
  protected actions() {
    const canAct = this.rows[this.selectedIndex]?.mine ?? false;
    return [
      ...(canAct
        ? [
            actionItem('conductors-start', 's', 'start'),
            actionItem('conductors-stop', 'x', 'stop'),
          ]
        : []),
      actionItem('conductors-enter', 'Enter', 'open'),
      actionItem('conductors-tab', 'Tab', 'tabs'),
      ...this.pagingActionItems(),
    ];
  }

  /**
   * BB-450 review B6/B10 — a row this screen cannot act on states so,
   * before any key is pressed: `!mine` is the identity gate `act()` uses too.
   * The row's own MARKS cell already carries `elsewhere`; this is the
   * footer's copy of the same fact for the row currently selected.
   */
  private viewOnlyNotice(): string | undefined {
    const row = this.rows[this.selectedIndex];
    return row && !row.mine
      ? `${row.label} runs on another machine — view-only`
      : undefined;
  }

  protected override notice(): string | undefined {
    return this.viewOnlyNotice() || this.identityReason;
  }

  select(index: number, context: ScreenContext): boolean {
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
    if (input === 's' || input === 'x') {
      void this.act(input === 's' ? 'start' : 'stop', context);
      return true;
    }
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
    this.busyIds.clear();
    this.identityReason = '';
    super.reset();
  }

  /**
   * BB-450 review B6 — every outcome is now stated in the footer: the two
   * refusals this screen can decide on its own (foreign row, already-online),
   * the `{ok, message}` `host.start()`/`host.stop()` returns (previously
   * discarded at the call site — the host-mismatch refusal `start` gained in
   * the prior rework was composed only to be dropped here), and a thrown
   * failure.
   */
  private act(action: 'start' | 'stop', context: ScreenContext): void {
    const row = this.rows[this.selectedIndex];
    if (!row) return;
    if (!row.mine) {
      context.requestDraw();
      return;
    }
    if (action === 'start' && row.derivedStatus === 'online') {
      this.toast = `${row.label} is already online`;
      context.requestDraw();
      return;
    }
    const host =
      context.services?.conductorProcess ?? createConductorProcessHost();
    runRowAction({
      rowId: row.id,
      busy: this.busyIds,
      context,
      perform: () =>
        action === 'start'
          ? host.start({
              workspaceRoot: row.workspaceRoot,
              conductorName: row.conductorName,
              hostKey: row.hostKey,
              id: row.id,
              priorLastSeen: row.lastSeen || undefined,
              client: context.services?.client,
            })
          : host.stop({
              pid: row.lastPid,
              hostKey: row.hostKey,
            }),
      refresh: (ctx) => this.reload(ctx),
      setStatus: (status) => {
        this.toast = status;
      },
      captureLifecycle: () => this.captureLifecycle(context),
      lifecycleIsCurrent: (guard, ctx) => this.lifecycleIsCurrent(guard, ctx),
      statusIsCurrent: (guard, ctx) => this.actionStillCurrent(guard, ctx),
      failPrefix: `${action} failed`,
    });
  }
}
