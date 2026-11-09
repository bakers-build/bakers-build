// Pure core of the PM bot's poller: which posts a set of ticket states calls for,
// given the states the poller saw last time. No I/O.

import { CLOSED } from './channels.mjs';

/**
 * @param {Record<string, string> | null} previous identifier → state from the last run; null on the first run
 * @param {Array<{identifier: string, title: string, state: string, conversation: {channel: string, thread_ts?: string} | null, inherited?: boolean}>} tickets
 * @param {Record<string, string>} summaries identifier → latest summary comment (Markdown), for tickets that reached done
 * @param {{states: Record<string, string>, testHint: string, noTestHint: string}} messages
 * @returns {{posts: Array<{identifier: string, channel: string, thread_ts?: string, text: string}>, next: Record<string, string>}}
 */
export function diff(previous, tickets, summaries, messages) {
  const next = {};
  const posts = [];
  for (const t of tickets) {
    if (!t.conversation) continue;
    next[t.identifier] = t.state;
    const before = previous?.[t.identifier];
    // A ticket first seen open needs no post; first seen closed, its channel still owes the final one.
    if (before === t.state || (before === undefined && !(previous && CLOSED.includes(t.state)))) continue;
    let text = messages.states[t.state];
    if (!text) continue;
    if (t.state === 'done') {
      const hint = manualReview(summaries[t.identifier] ?? '');
      text += hint ? `\n\n${messages.testHint}\n\n${hint}` : `\n\n${messages.noTestHint}`;
    }
    posts.push({ identifier: t.identifier, ...target(t.conversation), text: named(t, text) });
  }
  return { posts, next };
}

/**
 * The identifiers whose `done` post needs the latest summary: the tickets `diff` posts `done` for.
 */
export function reachedDone(previous, tickets) {
  return tickets
    .filter((t) => t.conversation && t.state === 'done' && previous && previous[t.identifier] !== 'done')
    .map((t) => t.identifier);
}

// Where a post goes: the channel, and the thread only when the conversation is one.
export const target = ({ channel, thread_ts }) => (thread_ts ? { channel, thread_ts } : { channel });

// A sub-ticket shares its ancestor's conversation, so its posts start with its identifier.
export const named = (t, text) => (t.inherited && !text.startsWith(`${t.identifier} · `) ? `${t.identifier} · ${text}` : text);

// The customer-facing part of a summary's "Manual review" section: where and
// how to test, as the ticket's last state run recorded it. That section is
// written for the reviewer, so lines meant only for them stay out. Empty when
// nothing is left.
function manualReview(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s.*manual review/i.test(l));
  if (start < 0) return '';
  const level = lines[start].match(/^#+/)[0].length;
  const end = lines.findIndex((l, i) => i > start && /^#{1,6}\s/.test(l) && l.match(/^#+/)[0].length <= level);
  const kept = [];
  let inCode = false;
  for (const line of lines.slice(start + 1, end < 0 ? undefined : end)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode || reviewerOnly(line)) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// One-time login links, merge or pull requests, pipelines, and lines that
// are nothing but inline code (commands, commit ranges).
function reviewerOnly(line) {
  return (
    /\/user\/(reset|login)\b|\/-\/merge_requests\/|\/pull\/\d|\/-\/pipelines\b/.test(line) ||
    /^\s*(?:[-*]\s+)?`[^`]+`\s*$/.test(line)
  );
}
