// Pure core of the poller's ticket channels: their names, and the step the poller owes
// each channel the bot created. No I/O.
//
// shortcut: two copies of the slug rule (here and plugins/bot-channels/channels.py), held
// together by slug-examples.json; merge them if a third writer appears.

export const MAX_NAME = 40;
export const CLOSED = ['done', 'cancelled'];
export const WEEK = 7 * 24 * 3600 * 1000;

/** Lower-case words of `text`, joined by `-`, within Slack's channel-name rules. */
export function slug(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// At most `max` characters, cut at the last word boundary that fits.
function cut(name, max) {
  if (name.length <= max) return name;
  const boundary = name.slice(0, max + 1).lastIndexOf('-');
  return name.slice(0, boundary > 0 ? boundary : max);
}

/** `<identifier>-<slug of the title>`, at most 40 characters, `-<n>` from the second on. */
export function ticketChannelName(identifier, title, n = 1) {
  const suffix = n > 1 ? `-${n}` : '';
  return cut([slug(identifier), slug(title)].filter(Boolean).join('-'), MAX_NAME - suffix.length) + suffix;
}

/**
 * The steps owed to the bot's channels:
 * - `rename`: a request channel a ticket now links;
 * - `archive`: a ticket channel whose `done` or `cancelled` was posted (`final`);
 * - `reopen`: an archived ticket channel whose ticket left `done` or `cancelled`;
 * - `abandon`: a request channel no ticket links, silent for 7 days.
 *
 * @param {{tickets: Record<string, string> | null, channels: Record<string, {ticket?: string, renamed?: boolean, final?: boolean, archived?: boolean, seen?: number}>}} state
 *   the poller's state: the posted state per identifier, and its record per channel
 * @param {Array<{identifier: string, state: string, conversation: {channel: string, thread_ts?: string} | null, inherited?: boolean}>} tickets
 * @param {Record<string, {created: string}>} botChannels the request channels the bot opened (bot-channels.json)
 * @param {number} now epoch milliseconds
 * @returns {Array<{kind: 'rename' | 'archive' | 'reopen', channel: string, ticket: object} | {kind: 'abandon', channel: string}>}
 */
export function channelSteps(state, tickets, botChannels, now) {
  const steps = [];
  const linked = new Set();
  for (const ticket of tickets) {
    const c = ticket.conversation;
    if (!c || c.thread_ts || ticket.inherited) continue;
    linked.add(c.channel);
    const record = state.channels[c.channel];
    if (!record && !botChannels[c.channel]) continue; // not a channel the bot created
    if (record?.archived) {
      if (!CLOSED.includes(ticket.state)) steps.push({ kind: 'reopen', channel: c.channel, ticket });
      continue;
    }
    if (!record?.renamed) steps.push({ kind: 'rename', channel: c.channel, ticket });
    if (record?.final && CLOSED.includes(state.tickets?.[ticket.identifier])) steps.push({ kind: 'archive', channel: c.channel, ticket });
  }
  for (const [channel, info] of Object.entries(botChannels)) {
    const record = state.channels[channel];
    if (linked.has(channel) || record?.ticket || record?.archived) continue;
    if (now - Math.max(Date.parse(info.created) || 0, record?.seen ?? 0) >= WEEK) steps.push({ kind: 'abandon', channel });
  }
  return steps;
}
