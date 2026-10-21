import type { DropshClient } from '../../../types.js';
import { DEFAULT_TICKET_CRITERIA } from '../../ticket/Data/query.js';
import {
  loadFilteredTickets,
  type TicketRow,
} from '../../ticket/Data/tickets.js';
import { classifyWorkload } from '../../ticket/Data/workload.js';
import { listTeamMemberIds } from './members.js';
import { listLinkedProjectIds } from './projects.js';
import { resolveTeam } from './team.js';

export interface TeamMemberWorkload {
  userId: string;
  open: number;
  running: number;
  waiting: number;
}

export interface TeamWorkloadResult {
  team: {
    id: string;
    name: string;
    workspace?: string;
    memberCount: number;
    projectCount: number;
  };
  members: TeamMemberWorkload[];
  total: { open: number; running: number; waiting: number };
}

async function listProjectTickets(
  client: DropshClient,
  projectId: string,
  query: string,
): Promise<TicketRow[]> {
  const rows: TicketRow[] = [];
  let pageIndex = 0;
  while (true) {
    const page = await loadFilteredTickets(
      client,
      projectId,
      { ...DEFAULT_TICKET_CRITERIA, query },
      pageIndex,
    );
    if (page.withheld) {
      throw new Error('the control plane withheld project ticket rows');
    }
    rows.push(...page.rows);
    if (!page.hasNext) return rows;
    pageIndex++;
  }
}

export async function loadTeamWorkload(
  client: DropshClient,
  teamId: string,
  /** The `/` line: the workload counts only the tickets it finds. */
  query = '',
): Promise<TeamWorkloadResult> {
  const [team, membership, projectIds] = await Promise.all([
    resolveTeam(client, teamId),
    listTeamMemberIds(client, teamId),
    listLinkedProjectIds(client, teamId),
  ]);
  if (membership.ids === null) {
    throw new Error(membership.error ?? 'The team membership is unavailable.');
  }
  const tickets = (
    await Promise.all(
      projectIds.map((projectId) =>
        listProjectTickets(client, projectId, query),
      ),
    )
  ).flat();
  const memberSet = new Set(membership.ids);
  const assigned = tickets.filter(
    (ticket) => ticket.assigneeId && memberSet.has(ticket.assigneeId),
  );
  const members = membership.ids.map((userId) => {
    const workload = classifyWorkload(
      assigned.filter((ticket) => ticket.assigneeId === userId),
    );
    return {
      userId,
      open: workload.open.length,
      running: workload.running.length,
      waiting: workload.waiting.length,
    };
  });
  const total = members.reduce(
    (sum, member) => ({
      open: sum.open + member.open,
      running: sum.running + member.running,
      waiting: sum.waiting + member.waiting,
    }),
    { open: 0, running: 0, waiting: 0 },
  );

  return {
    team: {
      id: team.id,
      name: team.name,
      memberCount: members.length,
      projectCount: projectIds.length,
      ...(team.workspace ? { workspace: team.workspace } : {}),
    },
    members,
    total,
  };
}
