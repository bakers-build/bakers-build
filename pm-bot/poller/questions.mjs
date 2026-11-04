// Pure core of the poller's question relay: a ticket's open question, and which
// questions to post into which Slack thread with what text. No I/O.
//
// An open question is the protocol of bakers.build: the ticket carries the
// "Question" label and is frozen, and the question is its newest comment that is
// not a `summary`, created at or before `frozen_at`.

export const QUESTION_LABEL = 'Question';

/**
 * @param {{frozen: boolean, frozen_at: string | null, labels: string[]}} ticket labels by name
 * @param {Array<{id: string, type: string, created: string, body: string}>} comments
 * @returns {{id: string, type: string, created: string, body: string} | null}
 */
export function openQuestion(ticket, comments) {
  if (!ticket.frozen || !ticket.frozen_at || !ticket.labels.includes(QUESTION_LABEL)) return null;
  const frozenAt = Date.parse(ticket.frozen_at);
  const candidates = comments.filter((c) => c.type !== 'summary' && Date.parse(c.created) <= frozenAt);
  candidates.sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
  return candidates[0] ?? null;
}

/**
 * @param {string[]} relayed comment UUIDs posted before
 * @param {Array<{ticket: {identifier: string, title: string, thread: {channel: string, thread_ts: string}}, question: {id: string, body: string}}>} open
 *   the open questions of threaded tickets
 * @param {boolean} complete every frozen ticket was read; only then are answered questions forgotten
 * @param {string} lead the lead-in; `{identifier}` and `{title}` become the ticket's
 * @returns {{posts: Array<{question: string, identifier: string, channel: string, thread_ts: string, text: string}>, relayed: string[]}}
 *   add each posted question to `relayed` after its post succeeded
 */
export function relay(relayed, open, complete, lead) {
  const before = new Set(relayed);
  const posts = open
    .filter(({ question }) => !before.has(question.id))
    .map(({ ticket, question }) => ({
      question: question.id,
      identifier: ticket.identifier,
      channel: ticket.thread.channel,
      thread_ts: ticket.thread.thread_ts,
      text: `${lead.replace('{identifier}', () => escape(ticket.identifier)).replace('{title}', () => escape(ticket.title))}\n\n${escape(question.body)}`,
    }));
  if (!complete) return { posts, relayed: [...relayed] };
  const still = new Set(open.map(({ question }) => question.id));
  return { posts, relayed: relayed.filter((id) => still.has(id)) };
}

// Slack reads <, > and & as markup: agent text must not mention or link anyone.
export const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
