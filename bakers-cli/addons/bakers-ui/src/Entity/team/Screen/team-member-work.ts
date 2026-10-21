import type { RouteMetadata } from '../../../Routing/route.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import { loadTeamMemberRuns, type RunPage } from '../../run/Data/runs.js';
import { MemberRunsScreen } from '../../run/Screen/user-runs.js';
import {
  loadTeamMemberTickets,
  type TicketPage,
} from '../../ticket/Data/tickets.js';
import { MemberTicketsScreen } from '../../ticket/Screen/user-tickets.js';
import { assertActiveMember } from '../../user/Data/member-context.js';
import { listLinkedProjectIds } from '../Data/projects.js';

export class TeamMemberTicketsScreen extends MemberTicketsScreen {
  static readonly route = {
    id: 'team.member.tickets',
    path: '/teams/:teamId/members/:userId/tickets',
    fallback: { routeId: 'team.members', preserveParams: true },
    tab: {
      id: 'tickets',
      label: 'Tickets',
      scope: 'team-member',
      weight: 30,
    },
  } satisfies RouteMetadata;
  readonly id = TeamMemberTicketsScreen.route.id;

  protected async loadRows(
    context: ScreenContext,
    page: number,
  ): Promise<TicketPage> {
    if (!context.services) throw new Error('Member tickets requires services');
    const userId = context.user?.id ?? context.params?.userId;
    const teamId = context.params?.teamId;
    if (!userId || !teamId)
      throw new Error('Team member tickets require teamId and userId');
    await assertActiveMember(
      context.services.client,
      'bb_team',
      teamId,
      userId,
    );
    const projectIds = await listLinkedProjectIds(
      context.services.client,
      teamId,
    );
    return loadTeamMemberTickets(
      context.services.client,
      userId,
      projectIds,
      this.ticketCriteria(),
      page,
    );
  }
}

export class TeamMemberRunsScreen extends MemberRunsScreen {
  static readonly route = {
    id: 'team.member.runs',
    path: '/teams/:teamId/members/:userId/runs',
    fallback: { routeId: 'team.members', preserveParams: true },
    tab: {
      id: 'runs',
      label: 'Runs',
      scope: 'team-member',
      weight: 40,
    },
  } satisfies RouteMetadata;
  readonly id = TeamMemberRunsScreen.route.id;

  protected async loadRows(
    context: ScreenContext,
    page: number,
  ): Promise<RunPage> {
    if (!context.services) throw new Error('Member runs requires services');
    const userId = context.user?.id ?? context.params?.userId;
    const teamId = context.params?.teamId;
    if (!userId || !teamId)
      throw new Error('Team member runs require teamId and userId');
    await assertActiveMember(
      context.services.client,
      'bb_team',
      teamId,
      userId,
    );
    const projectIds = await listLinkedProjectIds(
      context.services.client,
      teamId,
    );
    return loadTeamMemberRuns(
      context.services.client,
      userId,
      projectIds,
      this.runCriteria(),
      page,
    );
  }
}
