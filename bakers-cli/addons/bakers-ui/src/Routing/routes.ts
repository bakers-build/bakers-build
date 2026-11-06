import { ConductorLogScreen } from '../Entity/conductor/Screen/conductor-log.js';
import { ConductorOverviewScreen } from '../Entity/conductor/Screen/conductor-overview.js';
import { ConductorRunsScreen } from '../Entity/conductor/Screen/conductor-runs.js';
import { ConductorsScreen } from '../Entity/conductor/Screen/conductors.js';
import { ProjectConductorsScreen } from '../Entity/conductor/Screen/project-conductors.js';
import { ProjectOverviewScreen } from '../Entity/project/Screen/project-overview.js';
import { ProjectPickerScreen } from '../Entity/project/Screen/project-picker.js';
import { ProjectsScreen } from '../Entity/project/Screen/projects-screen.js';
import { EditRunFormScreen } from '../Entity/run/Screen/edit-run-form.js';
import { RunDetailScreen } from '../Entity/run/Screen/run-detail.js';
import { RunsScreen } from '../Entity/run/Screen/runs.js';
import { WorkspaceMemberRunsScreen } from '../Entity/run/Screen/user-runs.js';
import {
  TeamMemberRunsScreen,
  TeamMemberTicketsScreen,
} from '../Entity/team/Screen/team-member-work.js';
import { TeamUsersScreen } from '../Entity/team/Screen/team-users.js';
import { TeamWorkScreen } from '../Entity/team/Screen/team-work.js';
import {
  TeamOverviewScreen,
  TeamsScreen,
} from '../Entity/team/Screen/teams-screen.js';
import { ConductorTicketsScreen } from '../Entity/ticket/Screen/conductor-tickets.js';
import { EditAssignmentFormScreen } from '../Entity/ticket/Screen/edit-assignment-form.js';
import { MyWorkScreen } from '../Entity/ticket/Screen/my-work.js';
import { MyWorkParentFilterScreen } from '../Entity/ticket/Screen/my-work-parent-filter-form.js';
import { ParentFilterScreen } from '../Entity/ticket/Screen/parent-filter-form.js';
import { ProjectFilterScreen } from '../Entity/ticket/Screen/project-filter-form.js';
import {
  AddonActionFormScreen,
  TicketAddonsScreen,
} from '../Entity/ticket/Screen/ticket-addons.js';
import { TicketAgentsScreen } from '../Entity/ticket/Screen/ticket-agents.js';
import { TicketCommentsScreen } from '../Entity/ticket/Screen/ticket-comments.js';
import { TicketDetailScreen } from '../Entity/ticket/Screen/ticket-detail.js';
import { TicketPlanningScreen } from '../Entity/ticket/Screen/ticket-planning.js';
import { TicketRunsScreen } from '../Entity/ticket/Screen/ticket-runs.js';
import { TicketsScreen } from '../Entity/ticket/Screen/tickets.js';
import { WorkspaceMemberTicketsScreen } from '../Entity/ticket/Screen/user-tickets.js';
import { WhoFilterScreen } from '../Entity/ticket/Screen/who-filter-form.js';
import {
  TeamMemberOverviewScreen,
  WorkspaceMemberOverviewScreen,
} from '../Entity/user/Screen/member-overview.js';
import { UsersScreen } from '../Entity/user/Screen/users.js';
import { WorkspacePickerScreen } from '../Entity/workspace/Screen/workspace-picker.js';
import type { ResolvedRoute } from '../types.js';
import { defineRoutes } from './registry.js';
import type { RouteLocation, ScreenClass } from './route.js';

export const bootLocationFor = (route?: ResolvedRoute): RouteLocation => {
  if (!route) return { routeId: 'my.work', params: {} };
  if (route.screen === 'project')
    return {
      routeId: 'project.overview',
      params: {
        projectId: route.projectId,
        projectName: route.projectName,
        projectSlug: route.projectName,
      },
    };
  if (route.screen === 'project-picker')
    return {
      routeId: 'project.picker',
      params: {},
      state: { candidates: route.candidates, repo: route.repo },
    };
  return {
    routeId:
      route.runId || (route.view === 'full' && route.tab === 'runs')
        ? 'ticket.runs'
        : 'ticket.detail',
    params: {
      ticketId: route.ticketId,
      view: route.view,
      ...(route.tab ? { tab: route.tab } : {}),
      ...(route.runId ? { runId: route.runId } : {}),
    },
  };
};

const BUILT_IN: readonly ScreenClass[] = [
  MyWorkScreen,
  ConductorsScreen,
  ConductorOverviewScreen,
  ConductorRunsScreen,
  ConductorTicketsScreen,
  ConductorLogScreen,
  EditAssignmentFormScreen,
  ParentFilterScreen,
  MyWorkParentFilterScreen,
  ProjectFilterScreen,
  ProjectsScreen,
  ProjectOverviewScreen,
  ProjectPickerScreen,
  WorkspacePickerScreen,
  // Team routes and their contextual member subtree are always available.
  TeamsScreen,
  TeamWorkScreen,
  TeamOverviewScreen,
  TeamUsersScreen,
  TeamMemberOverviewScreen,
  TeamMemberTicketsScreen,
  TeamMemberRunsScreen,
  TicketsScreen,
  TicketAgentsScreen,
  WhoFilterScreen,
  RunsScreen,
  ProjectConductorsScreen,
  TicketDetailScreen,
  TicketPlanningScreen,
  TicketCommentsScreen,
  TicketRunsScreen,
  TicketAddonsScreen,
  AddonActionFormScreen,
  RunDetailScreen,
  EditRunFormScreen,
];

export function buildRoutes(
  contributed: readonly ScreenClass[] = [],
  isWorkspaceAdmin = false,
) {
  const builtIn = isWorkspaceAdmin
    ? [
        ...BUILT_IN,
        UsersScreen,
        WorkspaceMemberOverviewScreen,
        WorkspaceMemberTicketsScreen,
        WorkspaceMemberRunsScreen,
      ]
    : BUILT_IN;
  return defineRoutes([...builtIn, ...contributed], 'my.work');
}

/**
 * BB-472 — the workspace-picker's route id, exported so the kernel's global
 * `W` binding can navigate to it without hardcoding an entity-screen route id
 * literal (`tests/Kernel/ownership.test.ts` forbids that).
 */
export const WORKSPACE_PICKER_ROUTE_ID = WorkspacePickerScreen.route.id;
