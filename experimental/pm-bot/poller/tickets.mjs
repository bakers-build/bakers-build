// Pure core of the poller's ticket discovery: a ticket's Slack thread from its
// links, and which sub-tickets need a thread of their own. No I/O.

const PERMALINK = /^https:\/\/[a-z0-9-]+\.slack\.com\/archives\/([A-Z0-9]+)\/p([0-9]{10})([0-9]{6})(?:[?#].*)?$/;

/**
 * The ticket's Slack thread: its FIRST link of kind `chat` (the kind bakers.build
 * stored; a link stored without one is judged by its permalink shape).
 *
 * @param {Array<{uri: string, options?: any}>} links the ticket's `links` field
 * @returns {{channel: string, thread_ts: string, url: string} | null}
 */
export function chatThread(links) {
  for (const link of links ?? []) {
    const kind = link.options?.bakers?.kind;
    if (kind !== undefined && kind !== 'chat') continue;
    const match = String(link.uri).match(PERMALINK);
    if (!match) {
      if (kind === 'chat') return null; // the first chat link is not a Slack permalink
      continue;
    }
    // A permalink to a reply names its thread in thread_ts.
    const reply = new URL(link.uri).searchParams.get('thread_ts');
    return { channel: match[1], thread_ts: reply ?? `${match[2]}.${match[3]}`, url: link.uri };
  }
  return null;
}

/**
 * Open sub-tickets without a thread whose nearest ancestor has one.
 *
 * @param {Array<{id: string, parent: string | null, thread: object | null, closed: boolean}>} tickets
 * @returns {Array<{ticket: object, parent: object, ancestor: object}>}
 */
export function pendingSubTickets(tickets) {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const pending = [];
  for (const ticket of tickets) {
    if (ticket.closed || ticket.thread || !ticket.parent) continue;
    const parent = byId.get(ticket.parent);
    let ancestor = parent;
    const seen = new Set();
    while (ancestor && !ancestor.thread && !seen.has(ancestor.id)) {
      seen.add(ancestor.id);
      ancestor = byId.get(ancestor.parent);
    }
    if (parent && ancestor?.thread) pending.push({ ticket, parent, ancestor });
  }
  return pending;
}
