import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { asString } from '../../../lib/format.js';
import type {
  DropshClient,
  JsonApiRelationship,
  JsonApiResource,
} from '../../../types.js';
import { DEFAULT_TICKET_CRITERIA } from '../../ticket/Data/query.js';
import {
  loadFilteredTickets,
  type TicketRow,
} from '../../ticket/Data/tickets.js';
import { classifyWorkload, type Workload } from '../../ticket/Data/workload.js';

export interface ProjectWorkContext {
  id: string;
  name: string;
  key?: string;
  group?: string;
  teams: string[];
  repository?: string;
}

export interface ProjectWorkloadResult {
  project: ProjectWorkContext;
  workload: Workload<TicketRow>;
}

const relationshipIds = (
  relationship: JsonApiRelationship | undefined,
): string[] => {
  const data = relationship?.data;
  if (!data) return [];
  return (Array.isArray(data) ? data : [data]).map(({ id }) => id);
};

const repositoryUrl = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  return asString((value as Record<string, unknown>).url);
};

async function loadProjectContext(
  client: DropshClient,
  projectId: string,
): Promise<ProjectWorkContext> {
  const params = new DrupalJsonApiParams()
    .addFilter('id', projectId)
    .addInclude(['group_id', 'teams']);
  const document = (await client.get('bb_project/bb_project', params)) as {
    data?: JsonApiResource[];
    included?: JsonApiResource[];
  };
  const project = document.data?.[0];
  if (!project) throw new Error(`Project ${projectId} was not found.`);
  const included = new Map(
    (document.included ?? []).flatMap((resource) =>
      resource.id ? [[resource.id, resource] as const] : [],
    ),
  );
  const label = (id: string | undefined): string | undefined =>
    id ? asString(included.get(id)?.attributes?.name) : undefined;
  const group = label(relationshipIds(project.relationships?.group_id)[0]);
  const teams = relationshipIds(project.relationships?.teams).flatMap((id) => {
    const name = label(id);
    return name ? [name] : [];
  });
  const key = asString(project.attributes?.key);
  const repository = repositoryUrl(project.attributes?.repository);

  return {
    id: project.id ?? projectId,
    name: asString(project.attributes?.name) ?? projectId,
    teams,
    ...(key ? { key } : {}),
    ...(group ? { group } : {}),
    ...(repository ? { repository } : {}),
  };
}

async function loadEveryOpenTicket(
  client: DropshClient,
  projectId: string,
): Promise<TicketRow[]> {
  const rows: TicketRow[] = [];
  let pageIndex = 0;
  while (true) {
    const page = await loadFilteredTickets(
      client,
      projectId,
      DEFAULT_TICKET_CRITERIA,
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

export async function loadProjectWorkload(
  client: DropshClient,
  projectId: string,
): Promise<ProjectWorkloadResult> {
  const [project, tickets] = await Promise.all([
    loadProjectContext(client, projectId),
    loadEveryOpenTicket(client, projectId),
  ]);
  return { project, workload: classifyWorkload(tickets) };
}
