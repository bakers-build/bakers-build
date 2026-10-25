// Ticket detail reads — through the dropsh JSON:API client (`services.client`).
// Every rendered object is a Drupal entity (AC-5).
import type { DropshClient, TicketDetailDocument } from '../../../types.js';

/**
 * Load one ticket with the requested includes. The default preserves existing
 * full-document callers; each ticket screen requests its own subset.
 *
 * The full detail document contains the entity + its sideloaded
 * comments, sub-tickets, runs, referenced tickets and — BB-233 — its
 * assignment.
 *
 * `conductor_id,assignee_user_id` sideload the conductor with its `label` and
 * the user with its `display_name`, so the Assignment section (AC-12) needs no
 * lookup table and no second request. Measured to work under the connection's
 * one machine identity, which since BB-391 is the only one there is — the
 * cockpit pins nothing.
 *
 * BB-255 added `parent_id,labels` for the same reason: the Parent row (AC-3)
 * and the header box's labels row (AC-8) would otherwise be raw uuids. Both were
 * re-measured live on BB-255 — `labels` sideloads
 * `bb_term--label` carrying `name`, and `parent_id` is `{data: null}` on
 * a parentless ticket. BAKERS-17 added `ticket_type,recipe` for the header's
 * type and recipe names, sideloading `bb_term--type` / `bb_term--recipe`.
 * The `runs` include already ships each run's FULL attribute
 * set, which is why the Runs tab and the run detail screen add no request at all.
 *
 * `parent_id` serves BB-252 as well: after a save from the ticket list, this
 * document is mapped to the edited list row through `mapTicketDocument`, and the
 * Parent column resolves its identifier from `included`. The list read already
 * sideloads it; two include sets that disagree about `parent_id` is exactly what
 * silently blanked that column when measured. So both consumers need it here, and
 * this include list must stay a superset of the list read's — dropping either
 * `parent_id` or `labels` degrades a rendered row to a raw uuid without failing a
 * fixture-driven test.
 *
 * BB-369 D5 added `blocked_by` for the Related tab's Blocked by rows, and the
 * measurement is the reason it can be identities at all: live against the develop
 * control plane, the `blocked_by` LINKAGE data is in the document
 * with no include at all (`{"data": []}` on BB-369), and `include=blocked_by`
 * sideloads `bb_ticket--bb_ticket` resources carrying `identifier` (measured
 * on BB-23, BB-90 and BB-92 → BB-19, BB-97, BB-90). So the section
 * renders rows without a second request — and there is no second identity it
 * could have needed one under.
 *
 * That split is also the failure mode to keep in mind: because the linkage
 * arrives regardless, dropping this include does NOT empty the section — it
 * degrades every row to a raw uuid, silently. Hence the include set is pinned as
 * a string in `tests/Entity/ticket/Data/detail.test.ts` rather than inferred from
 * a rendered section, and this list must stay a superset of the list read's.
 */
export function loadTicketDetail(
  client: DropshClient,
  ticketId: string,
  includes: readonly string[] = [
    'comments',
    'sub_tickets',
    'runs',
    'referenced_tickets',
    'conductor_id',
    'assignee_user_id',
    'parent_id',
    'labels',
    'ticket_type',
    'recipe',
    'blocked_by',
    'owner_user_id',
    'reviewers',
    'pending_reviews',
  ],
): Promise<TicketDetailDocument> {
  return client.get(
    `bb_ticket/bb_ticket/${ticketId}?include=${includes.join(',')}`,
  ) as Promise<TicketDetailDocument>;
}
