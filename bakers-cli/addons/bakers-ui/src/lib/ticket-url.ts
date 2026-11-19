/**
 * BB-326 — a ticket's own page on the connected control plane.
 *
 * `/admin/bakers/ticket/{bb_ticket}` is the entity's canonical link template
 * (`web/modules/custom/bb_core/src/Entity/BbTicket.php`). The slot normally
 * takes the integer entity id, and the TUI has never seen one: every id it
 * holds is JSON:API's resource id, i.e. the UUID. That path still resolves
 * because `BbEntityUuidConverter` is attached to the route — the converter
 * exists for exactly this, "JSON:API and the bakers skill address entities by
 * UUID, so every UUID-based canonical link is dead" without it.
 *
 * Built here rather than read off the document: JSON:API's `links.self` names
 * the API resource (`/jsonapi/bb_ticket/bb_ticket/<uuid>`), which is not
 * something an operator wants to open on a phone.
 */
export function ticketUrl(
  baseUrl: string | undefined,
  ticketId: string | undefined,
): string | undefined {
  if (!baseUrl || !ticketId) return undefined;
  return `${baseUrl.replace(/\/+$/, '')}/admin/bakers/ticket/${ticketId}`;
}
