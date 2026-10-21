import { flattenSections } from '../../../Component/section-list/index.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import type { TicketDetailDocument } from '../../../types.js';
import { ticketContentModel } from '../Component/ticket-content/model.js';
import { ticketInputContext } from '../Data/input.js';
import { TicketContentScreen } from './ticket-content-screen.js';

const INCLUDES = ['comments', 'labels'];

/** Public Planning route: the ticket's planning view and its interaction state. */
export class TicketPlanningScreen extends TicketContentScreen {
  static readonly route = {
    id: 'ticket.planning',
    path: '/tickets/:ticketId/planning',
    parent: 'project.tickets',
    tab: { id: 'planning', label: 'Planning', scope: 'ticket', weight: 15 },
    fallback: { routeId: 'my.work' },
    context: ticketInputContext,
  } satisfies RouteMetadata;
  readonly id = TicketPlanningScreen.route.id;
  readonly tab = 'planning';
  protected readonly includes = INCLUDES;
  protected renderLoading(): string[] {
    return ['Loading planning…'];
  }
  protected fullNonInteractive(
    document: TicketDetailDocument,
    context: ScreenContext,
  ): string[] {
    const nowSeconds = context.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    return flattenSections(
      ticketContentModel(
        document,
        'planning',
        this.labels,
        nowSeconds,
      ).entries.map((entry) => ({
        heading: entry.title,
        lines: [...entry.expanded],
      })),
    ).lines;
  }
}
