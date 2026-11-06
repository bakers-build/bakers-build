// Pure core of the poller's ticket discovery: a ticket's Slack conversation from
// its links, inherited by sub-tickets that have none. No I/O.

const PERMALINK = /^https:\/\/[a-z0-9-]+\.slack\.com\/archives\/([A-Z0-9]+)\/p([0-9]{10})([0-9]{6})(?:[?#].*)?$/;
const CHANNEL = /^https:\/\/[a-z0-9-]+\.slack\.com\/archives\/([A-Z0-9]+)\/?(?:[?#].*)?$/;

// A link counts when bakers.build stored it as kind `chat`, or, stored without a kind, by its shape.
const chat = (link) => [undefined, 'chat'].includes(link.options?.bakers?.kind);

/**
 * The ticket's Slack conversation: its NEWEST channel link (`/archives/C…`), flat; without
 * one, the thread of its first `chat` link, as tickets from before channels have.
 *
 * @param {Array<{uri: string, options?: any}>} links the ticket's `links` field
 * @returns {{channel: string, thread_ts?: string, url: string} | null}
 */
export function conversation(links) {
  const chats = (links ?? []).filter(chat);
  const channel = chats.map((l) => [l, String(l.uri).match(CHANNEL)]).filter(([, m]) => m).pop();
  if (channel) return { channel: channel[1][1], url: channel[0].uri };
  for (const link of chats) {
    const match = String(link.uri).match(PERMALINK);
    if (!match) {
      if (link.options?.bakers?.kind === 'chat') return null; // the first chat link is not a Slack permalink
      continue;
    }
    // A permalink to a reply names its thread in thread_ts.
    const reply = new URL(link.uri).searchParams.get('thread_ts');
    return { channel: match[1], thread_ts: reply ?? `${match[2]}.${match[3]}`, url: link.uri };
  }
  return null;
}

/**
 * Gives each sub-ticket without a conversation that of its nearest ancestor with one, and
 * marks it `inherited`: its posts name it, and the channel is not its own to rename or archive.
 *
 * @param {Array<{id: string, parent: string | null, conversation: object | null}>} tickets changed in place
 */
export function conversations(tickets) {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const own = new Map(tickets.map((t) => [t.id, t.conversation]));
  for (const ticket of tickets) {
    if (own.get(ticket.id)) continue;
    let ancestor = byId.get(ticket.parent);
    const seen = new Set();
    while (ancestor && !own.get(ancestor.id) && !seen.has(ancestor.id)) {
      seen.add(ancestor.id);
      ancestor = byId.get(ancestor.parent);
    }
    if (ancestor && own.get(ancestor.id)) Object.assign(ticket, { conversation: own.get(ancestor.id), inherited: true });
  }
}
