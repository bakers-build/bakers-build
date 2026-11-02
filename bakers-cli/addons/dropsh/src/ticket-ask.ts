import { createToolClient } from '@dropsh/plugin-tool';
import type { CommandContext } from 'dropsh';

/** The workspace label that marks a ticket waiting for a human answer. */
export const QUESTION_LABEL = 'Question';

interface Linkage {
  type: string;
  id: string;
}

export interface AskRow {
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data: unknown }>;
}

/** What `askQuestion` needs from a bakers.build site. */
export interface AskApi {
  /** Call a site tool (`bakers_ticket_read`, `bakers_comment_publish`). */
  tool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  read(type: string, id: string): Promise<AskRow>;
  /** UUID of the `label` term with this name in the workspace, or null. */
  findLabel(name: string, workspace: string): Promise<string | null>;
  createLabel(name: string, workspace: string): Promise<string>;
  patchTicket(
    id: string,
    body: {
      attributes?: Record<string, unknown>;
      relationships?: Record<string, unknown>;
    },
  ): Promise<void>;
}

export interface AskResult {
  ticket: string;
  comment: string;
  label: { id: string; name: string; created: boolean };
  frozen: true;
}

/** A failed ask; `done` lists the steps that already happened. */
export class AskError extends Error {
  constructor(
    message: string,
    readonly done: string[],
  ) {
    super(message);
    this.name = 'AskError';
  }
}

const one = (row: AskRow, key: string): string | null =>
  (row.relationships?.[key]?.data as Linkage | null | undefined)?.id ?? null;
const many = (row: AskRow, key: string): Linkage[] =>
  (row.relationships?.[key]?.data as Linkage[] | null | undefined) ?? [];

/**
 * Ask the humans on a ticket: publish the question as a `comment`, put the
 * workspace label "Question" on the ticket (creating the term when missing),
 * freeze the ticket and read both back. The comment is published once; a later
 * failure reports the steps already done instead of retrying them.
 */
export async function askQuestion(
  api: AskApi,
  ticket: string,
  body: string,
): Promise<AskResult> {
  if (body.trim() === '')
    throw new AskError('The question is empty; nothing was published.', []);
  const read = await api.tool('bakers_ticket_read', { ticket });
  const uuid = typeof read.id === 'string' ? read.id : '';
  if (!uuid) throw new AskError(`Ticket ${ticket} did not resolve.`, []);

  const published = await api.tool('bakers_comment_publish', {
    ticket: uuid,
    type: 'comment',
    body,
  });
  const comment = typeof published.id === 'string' ? published.id : '';
  if (!comment)
    throw new AskError(
      'The server answered without a comment id; check the ticket before asking again.',
      [],
    );

  const done = ['comment'];
  try {
    const row = await api.read('bb_ticket--bb_ticket', uuid);
    const project = one(row, 'project_id');
    if (!project) throw new Error('the ticket has no project');
    // A project belongs to a group, and the group to the workspace.
    const group = one(
      await api.read('bb_project--bb_project', project),
      'group_id',
    );
    const workspace = group
      ? one(await api.read('bb_group--bb_group', group), 'workspace_id')
      : null;
    if (!workspace) throw new Error('the ticket project has no workspace');

    let label = await api.findLabel(QUESTION_LABEL, workspace);
    const created = label === null;
    if (label === null) label = await api.createLabel(QUESTION_LABEL, workspace);
    done.push('label');

    const labels = many(row, 'labels');
    if (!labels.some((l) => l.id === label))
      labels.push({ type: 'bb_term--label', id: label });
    await api.patchTicket(uuid, {
      attributes: { frozen: true },
      relationships: { labels: { data: labels } },
    });
    done.push('ticket');

    const after = await api.read('bb_ticket--bb_ticket', uuid);
    if (
      after.attributes?.frozen !== true ||
      !many(after, 'labels').some((l) => l.id === label)
    )
      throw new Error('the ticket readback is not labelled and frozen');
    return {
      ticket: uuid,
      comment,
      label: { id: label, name: QUESTION_LABEL, created },
      frozen: true,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AskError(
      `Asking stopped after ${done.join(', ')} (comment ${comment}): ${reason}. Do not ask again; finish the remaining steps on the ticket.`,
      done,
    );
  }
}

/** The `AskApi` over a bakers.build connection: MCP tools and JSON:API. */
export function siteAskApi(ctx: CommandContext): AskApi & { close(): Promise<void> } {
  const tools = createToolClient({ auth: ctx.auth, baseUrl: ctx.baseUrl });
  const { client } = ctx;
  return {
    async tool(name, args) {
      const result = await tools.call(`tool_api__${name}`, args);
      if (result.isError) {
        const text = (result.content as { type: string; text?: string }[])
          .map((c) => c.text ?? '')
          .join(' ');
        throw new Error(`${name} refused: ${text}`);
      }
      return (result.structuredContent ?? {}) as Record<string, unknown>;
    },
    async read(type, id) {
      return (await client.resource(type, id)).raw;
    },
    async findLabel(name, workspace) {
      const hit = await client
        .collection('bb_term--label')
        .where('name', '=', name)
        .where('workspace_id.id', '=', workspace)
        .first();
      return hit?.id ?? null;
    },
    async createLabel(name, workspace) {
      const term = await client.create('bb_term--label', {
        attributes: { name },
        relationships: {
          workspace_id: {
            data: { type: 'bb_workspace--bb_workspace', id: workspace },
          },
        },
      });
      return term.id;
    },
    async patchTicket(id, body) {
      await client.update('bb_ticket--bb_ticket', id, body);
    },
    close: () => tools.close(),
  };
}
