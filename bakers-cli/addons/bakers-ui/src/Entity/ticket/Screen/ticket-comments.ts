import { flattenSections } from '../../../Component/section-list/index.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import type { TicketDetailDocument } from '../../../types.js';
import { detailSections } from '../Component/ticket-detail/index.js';
import { ticketInputContext } from '../Data/input.js';
import { TicketContentScreen } from './ticket-content-screen.js';

const INCLUDES = ['comments'];

/** Public History route: the ticket's comments view and its interaction state. */
export class TicketCommentsScreen extends TicketContentScreen {
  static readonly route = {
    id: 'ticket.comments',
    path: '/tickets/:ticketId/comments',
    parent: 'project.tickets',
    tab: { id: 'comments', label: 'History', scope: 'ticket', weight: 20 },
    fallback: { routeId: 'my.work' },
    context: ticketInputContext,
  } satisfies RouteMetadata;
  readonly id = TicketCommentsScreen.route.id;
  readonly tab = 'comments';
  protected readonly includes = INCLUDES;
  protected renderLoading(): string[] {
    return ['Loading comments…'];
  }
  protected fullNonInteractive(
    document: TicketDetailDocument,
    context: ScreenContext,
  ): string[] {
    const nowSeconds = context.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    return flattenSections(
      detailSections(document, this.labels, nowSeconds).filter(
        (section) => section.heading === 'Comments',
      ),
    ).lines;
  }
}
