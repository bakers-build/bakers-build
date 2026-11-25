import type { VNode } from '@opentui/core';
import { actionItem } from '../../../Component/footer-actions/index.js';
import { humanizeAge } from '../../../lib/format.js';
import { columnNode, textNode } from '../../../lib/vnode.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncScreen } from '../../../Screen/async-screen.js';
import { confirmNavigation } from '../../../Screen/confirm-dialog.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import { runRowAction } from '../../../Screen/row-action.js';
import type { ScreenAction, ScreenContext } from '../../../Screen/screen.js';
import { resolveWhoCandidate } from '../../user/Data/users.js';
import {
  type ConductorDetail,
  forgetConductorDetail,
  readConductorDetail,
} from '../Data/detail.js';
import { isMine } from '../Data/log-block.js';
import { OwnerIdentity } from '../Data/own-rows.js';
import { createConductorProcessHost } from '../Data/process.js';
import { restartRunsRequest } from './restart-runs.js';

/** `bakers.build conductor — <label>` — the tab bar title every tab of the scope shares. */
export function conductorTitle(
  detail: Pick<ConductorDetail, 'label'> | undefined,
): string {
  return `bakers.build conductor — ${detail?.label ?? ''}`;
}

/**
 * The label/value rows of the Overview tab — the single source both
 * `renderReady` and `renderNonInteractive` draw from, so the piped output
 * cannot drift from the drawn tree.
 */
export function conductorOverviewRows(
  detail: ConductorDetail,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string[] {
  return [
    `Status: ${detail.status} (${humanizeAge(detail.lastSeen || null, nowSeconds)})`,
    `Machine: ${detail.machineLabel || '—'}`,
    `Project: ${detail.projectLabel || '—'}`,
    `Workspace: ${detail.workspaceRoot || '—'}`,
    `PID: ${detail.lastPid ?? '-'}`,
    // Stated explicitly as the machine's own budget, not the conductor's:
    // several conductors can share one host's capacity.
    `Load: ${detail.currentLoad}/${detail.maxParallel} (machine budget)`,
  ];
}

/**
 * Overview — the conductor detail scope's landing tab, and where the
 * conductor's actions live (BAKERS-338): `s` start and `x` stop on a
 * conductor of THIS machine (`mine`, the host_key gate), `r` Restart runs on
 * a conductor whose machine the operator owns. Each reloads the overview.
 */
export class ConductorOverviewScreen extends AsyncScreen<ConductorDetail> {
  static readonly route = {
    id: 'conductor.overview',
    path: '/conductors/:conductorId',
    pipe: 'scope',
    parent: 'conductors',
    tab: { id: 'overview', label: 'Overview', scope: 'conductor', weight: 10 },
    fallback: { routeId: 'conductors' },
  } satisfies RouteMetadata;
  readonly id = ConductorOverviewScreen.route.id;
  readonly frameId = 'conductor';
  private readonly identity = new OwnerIdentity(resolveWhoCandidate);
  private readonly busyIds = new Set<string>();
  private ownerId: string | undefined;
  private mine = false;

  protected async load(context: ScreenContext): Promise<ConductorDetail> {
    const host =
      context.services?.conductorProcess ?? createConductorProcessHost();
    const [detail, thisHostKey, owner] = await Promise.all([
      readConductorDetail(
        context,
        context.params?.conductorId ?? '',
        context.nowSeconds?.() ?? Math.floor(Date.now() / 1000),
      ),
      host.thisHostKey(),
      context.services
        ? this.identity.resolve(
            context.services.client,
            context.services.currentUser,
          )
        : undefined,
    ]);
    this.mine = isMine(detail, thisHostKey);
    this.ownerId = owner?.kind === 'resolved' ? owner.id : undefined;
    return detail;
  }

  reload(context: ScreenContext): Promise<void> {
    forgetConductorDetail(context, context.params?.conductorId ?? '');
    return this.retry(context);
  }

  protected renderLoading(): string[] {
    return ['Loading conductor…'];
  }

  protected renderReady(
    detail: ConductorDetail,
    context: ScreenContext,
  ): VNode {
    const nowSeconds = context.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    return columnNode(
      'conductor-overview',
      ...conductorOverviewRows(detail, nowSeconds).map((line, index) =>
        textNode({ id: `conductor-overview-${index}`, content: line }),
      ),
    );
  }

  protected chrome(): FullScreenChrome {
    return { title: conductorTitle(this.readyValue) };
  }

  /** Restart runs only on a conductor of a machine the operator owns. */
  private owned(): ConductorDetail | undefined {
    const detail = this.readyValue;
    // Like the site: a conductor without a machine falls back to its owner.
    const owner =
      detail?.machineOwnerUserId === undefined
        ? detail?.ownerUserId
        : detail.machineOwnerUserId;
    return detail && this.ownerId && owner === this.ownerId
      ? detail
      : undefined;
  }

  /** `s`/`x` only for a conductor of THIS machine (BB-450 B9/B10). */
  protected actions() {
    return [
      ...(this.owned()
        ? [actionItem('conductor-restart', 'r', 'restart runs')]
        : []),
      ...(this.readyValue && this.mine
        ? [
            actionItem('conductor-start', 's', 'start'),
            actionItem('conductor-stop', 'x', 'stop'),
          ]
        : []),
    ];
  }

  /** A conductor this machine cannot start or stop says so before any key. */
  protected override notice(): string | undefined {
    const detail = this.readyValue;
    return detail && !this.mine
      ? `${detail.label} runs on another machine — view-only`
      : undefined;
  }

  actionForInput(input: string): ScreenAction | undefined {
    const detail = input === 'r' ? this.owned() : undefined;
    if (!detail) return undefined;
    return confirmNavigation(
      restartRunsRequest({
        level: 'conductor',
        label: detail.label,
        args: { conductor: detail.id },
        online: detail.status === 'online',
      }),
    );
  }

  receiveResult(result: unknown, context: ScreenContext): void {
    if ((result as { type?: unknown } | undefined)?.type === 'runs-restarted')
      void this.reload(context);
  }

  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    if (input !== 's' && input !== 'x') return false;
    this.act(input === 's' ? 'start' : 'stop', context);
    return true;
  }

  /**
   * BB-450 review B6 — every outcome is stated in the footer: the two
   * refusals decided here (foreign conductor, already online), the host's own
   * `{ok, message}`, and a thrown failure.
   */
  private act(action: 'start' | 'stop', context: ScreenContext): void {
    const detail = this.readyValue;
    if (!detail || !this.mine) return;
    if (action === 'start' && detail.status === 'online') {
      this.toast = `${detail.label} is already online`;
      context.requestDraw();
      return;
    }
    const host =
      context.services?.conductorProcess ?? createConductorProcessHost();
    runRowAction({
      rowId: detail.id,
      busy: this.busyIds,
      context,
      perform: () =>
        action === 'start'
          ? host.start({
              workspaceRoot: detail.workspaceRoot,
              conductorName: detail.conductorName,
              hostKey: detail.hostKey,
              id: detail.id,
              priorLastSeen: detail.lastSeen || undefined,
              client: context.services?.client,
            })
          : host.stop({ pid: detail.lastPid, hostKey: detail.hostKey }),
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

  renderNonInteractive(context: ScreenContext): string[] {
    if (!this.readyValue) return [];
    const nowSeconds = context.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    return conductorOverviewRows(this.readyValue, nowSeconds);
  }

  override reset(): void {
    this.identity.reset();
    this.busyIds.clear();
    this.ownerId = undefined;
    this.mine = false;
    super.reset();
  }
}
