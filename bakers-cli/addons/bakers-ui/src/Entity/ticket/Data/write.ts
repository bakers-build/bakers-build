// Ticket WRITES — the counterpart of `ticket-data.ts`'s read (BB-233). The
// JSON:API envelope lives here, in the renderer, because the renderer owns the
// ticket domain; the ui package owns connection + auth composition and only
// hands over the finished client. No new HTTP plumbing: dropsh's client already
// exposes `update` — the read-only shape was the TYPE, never the object.
import type { DropshClient, ResourceWriteBody } from '../../../types.js';
import type { CreateFormPayload } from '../Form/create.js';

/** The JSON:API resource type every ticket write addresses. */
export const TICKET_TYPE = 'bb_ticket--bb_ticket';

/**
 * PATCH a ticket's assignment (`assignee_user_id` / `conductor_id`).
 *
 * A rejection is deliberately NOT caught here: only the caller knows where the
 * message belongs, and `lib/jsonapi-error.ts`'s `serverMessage()` is what turns
 * it into the operator's line (AC-5). Swallowing it here would be exactly the
 * silent failure that criterion forbids.
 */
export function updateTicketAssignment(
  client: DropshClient | undefined,
  ticketId: string,
  body: ResourceWriteBody,
): Promise<unknown> {
  if (!client) {
    // Reachable only for a consumer that injected neither a write client nor a
    // read one to fall back to. Named, so it can never read as "saved".
    return Promise.reject(
      new Error(
        'no write client — `bakers ui` resolved no connection able to write',
      ),
    );
  }
  return client.update(TICKET_TYPE, ticketId, body);
}

/**
 * PATCH a ticket's `frozen` flag (BB-302).
 *
 * Same write path as assignment: a refusal is not caught here so the caller
 * can put the server's words on the status line.
 */
export function updateTicketFrozen(
  client: DropshClient | undefined,
  ticketId: string,
  frozen: boolean,
): Promise<unknown> {
  return updateTicketAssignment(client, ticketId, { attributes: { frozen } });
}

/** The text format every ticket description is stored in (`bb_rich`). */
export const TICKET_DESCRIPTION_FORMAT = 'bb_rich';

/** A JSON:API to-one linkage, or nothing at all. */
const one = (
  type: string,
  id: string | null | undefined,
): Record<string, unknown> | undefined =>
  id ? { data: { type, id } } : undefined;

/**
 * The create body for a directly-created ticket (BB-309 D4/D5).
 *
 * Pure: the payload in, the JSON:API document out, no client and no I/O — so
 * every claim about what a direct create writes is a unit test rather than a
 * live observation.
 *
 * Two rules are load-bearing and stated here because this is where they are
 * visible:
 *
 *   1. NOTHING server-owned is written — no `state` (the server lands the
 *      ticket in the workflow's first state), no `identifier`, no `number`, no
 *      `branch_name`, no `base_branch`. Acceptance criterion 5 is satisfied by
 *      OMISSION, which is also what `@bakers-build/bb-create-ticket` does.
 *   2. A relationship with nothing picked is OMITTED, not sent as an explicit
 *      `null`. A create has nothing to unset, so `null` would carry no
 *      information a missing key does not — the exact opposite of the PATCH in
 *      `Form/edit.ts`, which must send both linkages because an omitted field
 *      cannot mean "remove it".
 */
export function buildTicketCreateBody(
  payload: CreateFormPayload,
  projectId: string,
): ResourceWriteBody {
  const relationships: Record<string, unknown> = {
    project_id: {
      data: { type: 'bb_project--bb_project', id: projectId },
    },
  };
  const assignee = one('user--user', payload.assignee?.id);
  if (assignee) relationships.assignee_user_id = assignee;
  const conductor = one('bb_conductor--bb_conductor', payload.conductor?.id);
  if (conductor) relationships.conductor_id = conductor;
  const ticketType = one('bb_term--type', payload.ticketType?.id);
  if (ticketType) relationships.ticket_type = ticketType;
  const recipe = one('bb_term--recipe', payload.recipe?.id);
  if (recipe) relationships.recipe = recipe;
  if (payload.labels.length > 0) {
    relationships.labels = {
      data: payload.labels.map((l) => ({
        type: 'bb_term--label',
        id: l.id,
      })),
    };
  }
  if (payload.reviewers.length > 0) {
    relationships.reviewers = {
      data: payload.reviewers.map((r) => ({
        type: 'user--user',
        id: r.id,
      })),
    };
  }
  const parent = one('bb_ticket--bb_ticket', payload.parent?.id);
  if (parent) relationships.parent_id = parent;
  return {
    attributes: {
      // TRIMMED, because `Agent/launch.ts`'s `shortName()` already trims the
      // same field: without this the agent's tab read `Fix the thing` while the
      // ticket it created read `  Fix the thing  `, and the server stores what
      // it is sent. The description is NOT trimmed — it is prose, and its
      // leading blanks can be Markdown.
      title: payload.title.trim(),
      // VERBATIM: what the operator typed, stored as-is. `bb_rich` renders it
      // as Markdown, so raw HTML is stripped on RENDER — a property of the
      // format, not of this write (spec R2).
      description: {
        value: payload.description,
        format: TICKET_DESCRIPTION_FORMAT,
      },
      ...(payload.workflow ? { workflow: payload.workflow.id } : {}),
    },
    relationships,
  };
}

/**
 * POST one `bb_ticket`.
 *
 * A rejection is deliberately NOT caught here, for the same reason
 * `updateTicketAssignment` does not catch one: only the caller knows where the
 * message belongs (spec D6).
 */
export function createTicket(
  client: DropshClient | undefined,
  body: ResourceWriteBody,
): Promise<unknown> {
  if (!client) {
    return Promise.reject(
      new Error(
        'no write client — `bakers ui` resolved no connection able to write',
      ),
    );
  }
  return client.create(TICKET_TYPE, body);
}
