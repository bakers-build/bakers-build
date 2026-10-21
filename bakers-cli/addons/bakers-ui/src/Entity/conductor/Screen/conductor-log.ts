import type { VNode } from '@opentui/core';
import { columnNode, textNode } from '../../../lib/vnode.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncScreen } from '../../../Screen/async-screen.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import { readConductorDetail } from '../Data/detail.js';
import { isMine, logBlockFor } from '../Data/log-block.js';
import { createConductorProcessHost } from '../Data/process.js';
import { conductorTitle } from './conductor-overview.js';

interface LogView {
  readonly label: string;
  readonly heading: string;
  readonly lines: readonly string[];
}

/** The tail of the selected conductor's log, or why there is none here. */
export class ConductorLogScreen extends AsyncScreen<LogView> {
  static readonly route = {
    id: 'conductor.log',
    path: '/conductors/:conductorId/log',
    parent: 'conductors',
    tab: { id: 'log', label: 'Log', scope: 'conductor', weight: 40 },
    fallback: { routeId: 'conductors' },
  } satisfies RouteMetadata;
  readonly id = ConductorLogScreen.route.id;
  readonly frameId = 'conductor';

  protected async load(context: ScreenContext): Promise<LogView> {
    const conductorId = context.params?.conductorId ?? '';
    const detail = await readConductorDetail(context, conductorId);
    const host =
      context.services?.conductorProcess ?? createConductorProcessHost();
    const thisHostKey = await host.thisHostKey();
    const block = logBlockFor(detail, isMine(detail, thisHostKey));
    return { label: detail.label, ...block };
  }

  protected renderLoading(): string[] {
    return ['Loading log…'];
  }

  protected renderReady(view: LogView): VNode {
    return columnNode(
      'conductor-log',
      textNode({ id: 'conductor-log-heading', content: view.heading }),
      ...view.lines.map((line, index) =>
        textNode({ id: `conductor-log-${index}`, content: line }),
      ),
    );
  }

  protected chrome(): FullScreenChrome {
    return {
      title: conductorTitle(
        this.readyValue ? { label: this.readyValue.label } : undefined,
      ),
    };
  }

  /** Nothing on this tab to act on. */
  protected actions() {
    return [];
  }

  renderNonInteractive(): string[] {
    return this.readyValue
      ? [this.readyValue.heading, ...this.readyValue.lines]
      : [];
  }
}
