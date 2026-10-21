import type { Command } from 'commander';
import type { CommandContext } from 'dropsh';
import { HttpError } from 'dropsh/plugin';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TemplateRunResult {
  ticket_uuid: string;
  identifier: string | null;
  created: true;
}

/** Per-field overrides of the template defaults; relationships by uuid. */
export interface TemplateOverrides {
  title?: string;
  description?: string;
  workflow?: string;
  project_id?: string;
  conductor_id?: string;
  labels?: string[];
  target_state?: string;
}

const RELATIONSHIP_TYPES = {
  project_id: 'bb_project--bb_project',
  conductor_id: 'bb_conductor--bb_conductor',
  labels: 'bb_term--bb_labels',
} as const;

/** The instantiate body: `{}` without overrides, else a ticket document. */
export function overrideDocument(
  overrides: TemplateOverrides,
): Record<string, unknown> {
  const attributes: Record<string, string> = {};
  for (const key of ['title', 'description', 'workflow'] as const) {
    if (overrides[key] !== undefined) attributes[key] = overrides[key];
  }
  const relationships: Record<string, unknown> = {};
  for (const key of ['project_id', 'conductor_id'] as const) {
    const id = overrides[key];
    if (id !== undefined)
      relationships[key] = { data: { type: RELATIONSHIP_TYPES[key], id } };
  }
  if (overrides.labels !== undefined) {
    relationships.labels = {
      data: overrides.labels.map((id) => ({
        type: RELATIONSHIP_TYPES.labels,
        id,
      })),
    };
  }
  const data: Record<string, unknown> = { type: 'bb_ticket--bb_ticket' };
  if (Object.keys(attributes).length > 0) data.attributes = attributes;
  if (Object.keys(relationships).length > 0) data.relationships = relationships;
  const document: Record<string, unknown> = { data };
  if (overrides.target_state !== undefined)
    document.meta = { target_state: overrides.target_state };
  return Object.keys(data).length > 1 || document.meta ? document : {};
}

const REASONS: Record<number, string> = {
  400: 'The server rejected the request',
  403: 'You are not allowed to run this template',
  404: 'Template not found',
  422: 'The template or its overrides are invalid and cannot produce a ticket',
};

function detail(body: unknown): string {
  const errors = (body as { errors?: { detail?: unknown }[] } | null)?.errors;
  const first = errors?.[0]?.detail;
  return typeof first === 'string' ? ` (${first})` : '';
}

/**
 * Run a ticket template: exactly one POST. The authenticated client sends
 * writes without transport retries; a failed send stays uncertain here.
 */
export async function runTemplate(
  client: Pick<CommandContext['client'], 'post'>,
  uuid: string,
  overrides: TemplateOverrides = {},
): Promise<TemplateRunResult> {
  if (!UUID.test(uuid)) {
    throw new Error(`template must be a uuid, got "${uuid}"`);
  }
  let document: {
    data?: { id?: string; attributes?: { identifier?: string } };
  };
  try {
    document = (await client.post(
      `bb_ticket_template/bb_ticket_template/${uuid}/instantiate`,
      overrideDocument(overrides),
    )) as typeof document;
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 0) {
        throw new Error(
          'Network failure: the ticket may have been created. Check the project before running the template again.',
        );
      }
      throw new Error(
        `${REASONS[error.status] ?? `HTTP ${error.status}`}${detail(error.body)}`,
      );
    }
    throw error;
  }
  const id = document.data?.id;
  if (!id) throw new Error('The server answered without a ticket.');
  return {
    ticket_uuid: id,
    identifier: document.data?.attributes?.identifier ?? null,
    created: true,
  };
}

export interface TemplateCommandDeps {
  contextFactory: () => Promise<CommandContext>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  setExitCode: (code: number) => void;
}

/** `bakers dropsh template run <uuid> [--<field> <value>]…`. */
export function registerTemplateCommand(
  program: Command,
  deps: TemplateCommandDeps,
): void {
  program
    .command('template')
    .description('Ticket templates')
    .command('run <uuid>')
    .description(
      'Create a ticket from a template; each flag overrides one template default',
    )
    .option(
      '--project_id <uuid>',
      'project to create the ticket in (required for a workspace template)',
    )
    .option(
      '--title <title>',
      'ticket title; {{date}} and {{month}} are rendered',
    )
    .option(
      '--description <text>',
      'ticket description; {{date}} and {{month}} are rendered',
    )
    .option('--workflow <id>', 'ticket workflow, e.g. bb_feature')
    .option('--labels <uuid...>', 'label uuids, replacing the template labels')
    .option('--conductor_id <uuid>', 'conductor of the ticket project')
    .option('--target_state <id>', 'state the new ticket is moved to')
    .action(async (uuid: string, overrides: TemplateOverrides) => {
      try {
        const { client } = await deps.contextFactory();
        deps.stdout(
          `${JSON.stringify(await runTemplate(client, uuid, overrides))}\n`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.stderr(`${JSON.stringify({ error: { message } })}\n`);
        deps.setExitCode(1);
      }
    });
}
