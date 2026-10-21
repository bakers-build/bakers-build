import { BoxRenderable, h, type VNode } from '@opentui/core';
import { FOREGROUND, paragraphNode, plainRun } from '../../../lib/vnode.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import {
  AsyncScreen,
  type FullScreenChrome,
} from '../../../Screen/async-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import {
  DemoStatistics,
  STATISTIC_EXAMPLES,
} from '../Component/react-statistics.js';
import {
  ticketHeaderTree,
  ticketTitleOf,
} from '../Component/ticket-detail/index.js';
import { ticketInputContext } from '../Data/input.js';
import { readTicket } from '../Data/store.js';

const ID = 'ticket-statistics-demo';

/**
 * Bounded statistics demonstration with purely local state: a counter, a
 * dialog and three example scenarios. Nothing is read from or written to the
 * control plane, and every visit starts from zero.
 */
export class TicketReactScreen extends AsyncScreen<true> {
  static readonly route = {
    id: 'ticket.react',
    path: '/tickets/:ticketId/react',
    parent: 'project.tickets',
    tab: { id: 'react', label: 'Statistics', scope: 'ticket', weight: 100 },
    fallback: { routeId: 'my.work' },
    context: ticketInputContext,
  } satisfies RouteMetadata;
  readonly id = TicketReactScreen.route.id;
  readonly frameId = 'ticket';
  private count = 0;
  private dialog = false;
  private scenario = 0;
  private gridWidth: number | undefined;

  protected load(): Promise<true> {
    return Promise.resolve(true);
  }
  override enter(context: ScreenContext): void {
    this.count = 0;
    this.dialog = false;
    this.scenario = 0;
    super.enter(context);
    // The data is local: ready at once, without a loading frame's round trip.
    if (this.state !== 'ready') {
      this.replaceReady(true);
      context.requestDraw();
    }
  }
  protected renderLoading(): string[] {
    return ['Loading statistics demo…'];
  }
  protected override flushBody(): boolean {
    return false;
  }

  private act(context: ScreenContext, change: () => void): boolean {
    change();
    context.requestDraw();
    return true;
  }

  override handleInput(key: string, context: ScreenContext): boolean {
    if (super.handleInput(key, context)) return true;
    if (key === 'n')
      return this.act(context, () => {
        this.scenario = (this.scenario + 1) % STATISTIC_EXAMPLES.length;
      });
    if (key === 'enter')
      return this.act(context, () => {
        this.count += 1;
      });
    if (key === 'd')
      return this.act(context, () => {
        this.dialog = !this.dialog;
      });
    if (key === 'escape' && this.dialog)
      return this.act(context, () => {
        this.dialog = false;
      });
    return false;
  }

  protected renderReady(_data: true, context: ScreenContext): VNode {
    const line = (id: string, text: string, press?: () => void) =>
      paragraphNode({
        id: `${ID}-${id}`,
        runs: [plainRun(text)],
        fg: FOREGROUND,
        onMouseDown:
          press === undefined
            ? undefined
            : () => {
                if (!context.isActive()) return;
                press();
                context.requestDraw();
              },
      });
    return h(
      BoxRenderable,
      { id: ID, flexDirection: 'column', gap: 1 },
      line('title', 'Native screen experiment · statistics'),
      line('local', 'Local interaction — no ticket changes are saved.'),
      line('counter', `Click to count: ${this.count} (Enter)`, () => {
        this.count += 1;
      }),
      line('dialog-toggle', 'Toggle dialog (d)', () => {
        this.dialog = !this.dialog;
      }),
      ...(this.dialog
        ? [
            h(
              BoxRenderable,
              {
                id: `${ID}-dialog`,
                border: true,
                borderStyle: 'rounded',
                flexDirection: 'column',
                padding: 1,
              },
              line('dialog-title', 'Native dialog'),
              line('dialog-close', 'Close dialog', () => {
                this.dialog = false;
              }),
            ),
          ]
        : []),
      line('tabs', 'Tab / Shift+Tab: switch ticket section'),
      DemoStatistics({
        id: `${ID}-figures`,
        scenario: this.scenario,
        width: this.gridWidth ?? context.terminalColumns ?? 80,
        onResize: (width) => {
          if (width <= 0 || width === this.gridWidth) return;
          this.gridWidth = width;
          queueMicrotask(() => this.requestActiveDraw(context));
        },
      }),
    );
  }

  protected chrome(context: ScreenContext): FullScreenChrome {
    const document = readTicket(context);
    const { identifier, title } = ticketTitleOf(document);
    return {
      title: `${identifier} · ${title}`,
      header: ticketHeaderTree(document, identifier, title, []),
    };
  }

  renderNonInteractive(): string[] {
    return [
      'Statistics demo: interactive controls are available in the terminal.',
    ];
  }

  override reset(): void {
    this.count = 0;
    this.dialog = false;
    this.scenario = 0;
    super.reset();
  }
}
