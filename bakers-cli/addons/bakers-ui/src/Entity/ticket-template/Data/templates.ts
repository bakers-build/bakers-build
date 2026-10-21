// The ticket TEMPLATE data service: the templates usable in one project
// (its own and its workspace's), and running one. It knows nothing about forms; the create popup's adapter
// (`ticket/Form/create-data.ts`) maps rows to options.
import type { DropshClient, Resource } from '../../../types.js';
import { type ListOutcome, messageOf } from '../../transport.js';

export interface TicketTemplate {
  id: string;
  /** Never empty — the uuid is the last fallback. */
  label: string;
}

/** The instantiate endpoint of one template (dropsh's `post` prefixes the JSON:API root). */
export const TEMPLATE_RUN_PATH = (id: string): string =>
  `bb_ticket_template/bb_ticket_template/${id}/instantiate`;

const toTemplate = (r: Resource): TicketTemplate => {
  const name = r.attr('name');
  return { id: r.id, label: typeof name === 'string' && name ? name : r.id };
};

/**
 * The enabled templates usable in one project, in server order: the
 * project's own, then the workspace templates of the given workspace.
 */
export async function listTemplatesForProject(
  client: DropshClient,
  projectId: string,
  workspaceId?: string,
): Promise<ListOutcome<TicketTemplate>> {
  try {
    const scopes: [string, string][] = [['project_id.id', projectId]];
    if (workspaceId) scopes.push(['workspace_id.id', workspaceId]);
    const seen = new Set<string>();
    const rows: TicketTemplate[] = [];
    for (const [path, id] of scopes) {
      for (const r of await client
        .collection('bb_ticket_template')
        .where(path, '=', id)
        .list()) {
        if (r.attr('enabled') === false || seen.has(r.id)) continue;
        seen.add(r.id);
        rows.push(toTemplate(r));
      }
    }
    return { rows };
  } catch (caught) {
    return { rows: [], error: messageOf(caught) };
  }
}

export interface TemplateRun {
  ticketId: string;
  identifier: string | undefined;
}

/**
 * Run a template in a project: ONE POST naming the project, which a workspace
 * template needs and a project template accepts when it is its own. A
 * rejection is not caught — the caller puts the server's words in the popup.
 * The write client sends writes without transport retries, so a failure stays
 * uncertain, never repeated.
 */
export async function runTemplate(
  client: DropshClient,
  templateId: string,
  projectId: string,
): Promise<TemplateRun> {
  const body = {
    data: {
      type: 'bb_ticket--bb_ticket',
      relationships: {
        project_id: {
          data: { type: 'bb_project--bb_project', id: projectId },
        },
      },
    },
  };
  const document = (await client.post(TEMPLATE_RUN_PATH(templateId), body)) as {
    data?: { id?: string; attributes?: { identifier?: string } } | null;
  };
  const ticketId = document?.data?.id;
  if (!ticketId) throw new Error('the server answered without a ticket');
  return {
    ticketId,
    identifier: document.data?.attributes?.identifier,
  };
}
