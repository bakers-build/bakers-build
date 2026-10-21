import type { VNode } from '@opentui/core';
import { humanizeAge } from '../../../lib/format.js';
import { columnNode, textNode } from '../../../lib/vnode.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncScreen } from '../../../Screen/async-screen.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import { type ConductorDetail, readConductorDetail } from '../Data/detail.js';

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

/** Overview — the conductor detail scope's landing tab. */
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

  protected load(context: ScreenContext): Promise<ConductorDetail> {
    return readConductorDetail(
      context,
      context.params?.conductorId ?? '',
      context.nowSeconds?.() ?? Math.floor(Date.now() / 1000),
    );
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

  /** Read-only — nothing on this tab to act on. */
  protected actions() {
    return [];
  }

  renderNonInteractive(context: ScreenContext): string[] {
    if (!this.readyValue) return [];
    const nowSeconds = context.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    return conductorOverviewRows(this.readyValue, nowSeconds);
  }
}
