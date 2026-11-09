// Pure core of the poller's status updates between two states: a run starting or ending, a
// new summary, a preview link, and a heartbeat while a run works in a quiet conversation.
// No I/O.

import { named, target } from './diff.mjs';
import { escape, QUESTION_LABEL, TECHNICAL_PROBLEM_LABEL } from './questions.mjs';

const ENDED = ['done', 'failed', 'expired', 'cancelled'];

// Run starts closer together than this collapse into the first one's line.
const COLLAPSE = 5 * 60 * 1000;

// Words of the tool, not of the requester: states, recipes and ticket types.
const INTERNAL = /\b(qualification|plan|working|review|done|cancelled|matt|superpowers|verify|deploy-and-release|feature|bug|chore)\b|\b[A-Z][A-Z0-9]*-\d+\b|`/i;

/**
 * The plain sentences among the first two of a summary's Outcome section, escaped for Slack;
 * empty when it has none.
 */
export function outcome(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s.*outcome/i.test(l));
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && /^#{1,6}\s/.test(l));
  const text = lines.slice(start + 1, end < 0 ? undefined : end).map((l) => l.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')).join(' ').trim();
  return text
    .split(/(?<=[.!?])\s+/)
    .slice(0, 2)
    .filter((s) => s && !INTERNAL.test(s))
    .map((s) => escape(s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|(?<!\w)[*_]|[*_](?!\w)/g, '').trim()));
}

// A link of kind `design` or `ddev`. The tools return links without their stored kind, so it is
// derived from the URI in the order bb_core's LinkKind::fromUri uses.
function preview(uri) {
  if (/\/-\/merge_requests\/|\/artifacts\/|playwright-report/.test(uri)) return false;
  if (uri.includes('designbook')) return true;
  return !/\/-\/(pipelines|jobs|tree|commits|branches)|\.slack\.com\/archives\//.test(uri) && uri.includes('.ddev.site');
}

const key = ({ channel, thread_ts }) => (thread_ts ? `${channel}:${thread_ts}` : channel);

const recordOf = (t) => ({
  runs: Object.fromEntries(t.runs.map((r) => [r.uuid, r.state])),
  summaries: t.comments.filter((c) => c.type === 'summary').map((c) => c.id),
  links: t.links.map((l) => l.uri),
  lastStart: null,
});

/**
 * @param {{previous: Record<string, {runs: Record<string, string>, summaries: string[], links: string[], lastStart: number | null}>,
 *   posted: Record<string, number>, tickets: Array<{identifier: string, state: string, labels: string[],
 *   conversation: {channel: string, thread_ts?: string}, inherited?: boolean, links: Array<{uri: string, title: string}>,
 *   runs: Array<{uuid: string, state: string, state_at_start: string, started_at: number | null}>,
 *   comments: Array<{id: string, type: string, created: string, body: string}>}>,
 *   now: number, interval: number, messages: any}} input
 *   previous: identifier → what was seen of the ticket; posted: conversation → the poller's last post there, in ms;
 *   tickets: the followed open tickets that were read in this pass
 * @returns {{posts: Array<{identifier: string, channel: string, thread_ts?: string, text: string}>,
 *   next: {records: Record<string, any>, posted: Record<string, number>}}}
 */
export function updates({ previous, posted, tickets, now, interval, messages }) {
  const records = {};
  const nextPosted = { ...posted };
  const posts = [];
  for (const t of tickets) {
    nextPosted[key(t.conversation)] ??= now;
    const before = previous[t.identifier];
    if (!before) {
      records[t.identifier] = recordOf(t);
      continue;
    }
    const record = (records[t.identifier] = { ...before, runs: { ...before.runs }, summaries: [...before.summaries], links: [...before.links] });
    // Each post names what it marked as seen, so a failed post can be forgotten and retried.
    const post = (text, undo) => posts.push({ identifier: t.identifier, ...target(t.conversation), text: named(t, text), ...undo });
    const runs = [...t.runs].reverse();
    for (const r of runs.filter((r) => ENDED.includes(r.state) && !ENDED.includes(before.runs[r.uuid]))) {
      record.runs[r.uuid] = r.state;
      // A run that moved the ticket on is told by its state line.
      if (r.state_at_start !== t.state) continue;
      const open = t.labels.includes(QUESTION_LABEL) || t.labels.includes(TECHNICAL_PROBLEM_LABEL);
      const text = r.state === 'done' ? (open ? null : messages.runWaiting) : messages.runPaused;
      if (text) post(text, { run: [r.uuid, before.runs[r.uuid]] });
    }
    for (const c of t.comments.filter((c) => c.type === 'summary' && !before.summaries.includes(c.id))) {
      record.summaries.push(c.id);
      const sentences = outcome(c.body);
      if (sentences.length) post(sentences.join(' '), { summary: c.id });
    }
    for (const l of t.links.filter((l) => !before.links.includes(l.uri))) {
      record.links.push(l.uri);
      if (preview(l.uri)) post(`${messages.previewLead} ${escape(l.title ?? '')}`.trim() + `\n${escape(l.uri)}`, { link: l.uri });
    }
    for (const r of runs) {
      if (r.uuid in record.runs) continue;
      record.runs[r.uuid] = r.state;
      const text = messages.runStart[r.state_at_start];
      if (!text || (record.lastStart !== null && now - record.lastStart < COLLAPSE)) continue;
      post(text, { run: [r.uuid, undefined], lastStart: record.lastStart });
      record.lastStart = now;
    }
  }
  // One heartbeat per quiet conversation, after every other post of the pass.
  const busy = new Set(posts.map(key));
  for (const t of tickets) {
    const at = key(t.conversation);
    const running = t.runs.find((r) => r.state === 'running');
    if (!running || !['working', 'review'].includes(t.state) || busy.has(at) || now - nextPosted[at] < interval) continue;
    busy.add(at);
    const since = (running.started_at ?? 0) * 1000;
    const newest = t.comments.filter((c) => c.type === 'summary' && Date.parse(c.created) >= since).sort((a, b) => Date.parse(b.created) - Date.parse(a.created))[0];
    const [sentence] = newest ? outcome(newest.body) : [];
    posts.push({ identifier: t.identifier, ...target(t.conversation), text: named(t, sentence ? `${messages.stillWorking} ${sentence}` : messages.stillWorking), heartbeat: true });
  }
  return { posts, next: { records, posted: nextPosted } };
}

/** Undoes what a post marked as seen in `records`, after Slack refused it, so the next pass retries it. */
export function forget(records, post) {
  const record = records[post.identifier];
  if (post.run) {
    if (post.run[1] === undefined) delete record.runs[post.run[0]];
    else record.runs[post.run[0]] = post.run[1];
  }
  if ('lastStart' in post) record.lastStart = post.lastStart;
  if (post.summary) record.summaries = record.summaries.filter((id) => id !== post.summary);
  if (post.link) record.links = record.links.filter((uri) => uri !== post.link);
}
