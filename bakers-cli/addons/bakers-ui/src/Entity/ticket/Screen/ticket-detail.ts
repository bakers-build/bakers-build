import { flattenSections } from '../../../Component/section-list/index.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import type { TicketDetailDocument } from '../../../types.js';
import {
  detailSections,
  sectionsForTab,
} from '../Component/ticket-detail/index.js';
import { ticketInputContext } from '../Data/input.js';
import { TicketContentScreen } from './ticket-content-screen.js';

export type { TicketDetailInput } from '../Data/input.js';
export { ticketDetailInputContext } from '../Data/input.js';

const INCLUDES = [
  'labels',
  'ticket_type',
  'recipe',
  'parent_id',
  'blocked_by',
  'conductor_id',
  'assignee_user_id',
  'comments',
  // The Overview sidebar resolves references to names, not raw uuids: the
  // owner (Created by), and the sub-/referenced tickets in the Related tab.
  // parent_id and blocked_by are already above.
  'owner_user_id',
  'sub_tickets',
  'referenced_tickets',
  'reviewers',
  'pending_reviews',
];

/** Public Overview route: the ticket's overview view and its interaction state. */
export class TicketDetailScreen extends TicketContentScreen {
  static readonly route = {
    id: 'ticket.detail',
    path: '/tickets/:ticketId',
    pipe: 'scope',
    parent: 'project.tickets',
    activeTab: (params) =>
      params.view === 'teaser' || params.view === 'board_card'
        ? null
        : { scope: 'ticket', id: 'overview' },
    tab: { id: 'overview', label: 'Overview', scope: 'ticket', weight: 10 },
    fallback: { routeId: 'my.work' },
    context: ticketInputContext,
  } satisfies RouteMetadata;
  readonly id = TicketDetailScreen.route.id;
  readonly tab = 'overview';
  protected readonly includes = INCLUDES;
  protected renderLoading(): string[] {
    return ['Loading ticket…'];
  }
  protected fullNonInteractive(
    document: TicketDetailDocument,
    context: ScreenContext,
  ): string[] {
    const nowSeconds = context.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    return flattenSections([
      ...detailSections(
        document,
        this.labels,
        nowSeconds,
        context.services?.baseUrl,
      ).filter(
        (section) =>
          section.heading === 'State' || section.heading === 'Labels',
      ),
      ...sectionsForTab(
        document,
        0,
        this.labels,
        nowSeconds,
        context.services?.baseUrl,
      ),
    ]).lines;
  }
}
