// Ticket WRITES — the counterpart of `ticket-data.ts`'s read (BB-233). The
// JSON:API envelope lives here, in the renderer, because the renderer owns the
// ticket domain; the ui package owns connection + auth composition and only
// hands over the finished client. No new HTTP plumbing: dropsh's client already
// exposes `update` — the read-only shape was the TYPE, never the object.
import type { DropshClient, ResourceWriteBody } from '../../../types.js';

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
