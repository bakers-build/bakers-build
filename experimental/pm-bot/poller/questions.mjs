// Pure core of the poller's note relay: a ticket's open note, and which notes
// to post into which Slack thread with what text. No I/O.
//
// Two protocols of bakers.build share one rule. A ticket is frozen and carries
// the "Question" label (an open question) or the "technical problem" label (a
// technical problem keytec has to solve); its note is the newest comment that
// is not a `summary`, created at or before `frozen_at`. A ticket with both
// labels has a technical problem: the customer is never asked a technical question.

export const QUESTION_LABEL = 'Question';
export const TECHNICAL_PROBLEM_LABEL = 'technical problem';

/**
 * @param {{frozen: boolean, frozen_at: string | null, labels: string[]}} ticket labels by name
 * @param {Array<{id: string, type: string, created: string, body: string}>} comments
 * @returns {{kind: 'question' | 'technical_problem', comment: {id: string, type: string, created: string, body: string}} | null}
 */
export function openNote(ticket, comments) {
  const kind = ticket.labels.includes(TECHNICAL_PROBLEM_LABEL) ? 'technical_problem' : ticket.labels.includes(QUESTION_LABEL) ? 'question' : null;
  if (!kind || !ticket.frozen || !ticket.frozen_at) return null;
  const frozenAt = Date.parse(ticket.frozen_at);
  const candidates = comments.filter((c) => c.type !== 'summary' && Date.parse(c.created) <= frozenAt);
  candidates.sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
  return candidates[0] ? { kind, comment: candidates[0] } : null;
}

/**
 * Both kinds go through one call: the record is pruned to the notes still open,
 * so a call over one kind would forget the other's entries.
 *
 * @param {string[]} relayed comment UUIDs posted before
 * @param {Array<{ticket: {identifier: string, title: string, thread: {channel: string, thread_ts: string}}, note: {kind: 'question' | 'technical_problem', comment: {id: string, body: string}}}>} open
 *   the open notes of threaded tickets
 * @param {boolean} complete every frozen ticket was read; only then are closed notes forgotten
 * @param {{question: string, technical_problem: string}} leads the lead-in per kind; `{identifier}` and `{title}` become the ticket's identifier and title, escaped
 * @returns {{posts: Array<{comment: string, kind: string, identifier: string, channel: string, thread_ts: string, text: string}>, relayed: string[]}}
 *   add each posted note to `relayed` after its post succeeded
 */
export function relay(relayed, open, complete, leads) {
  const before = new Set(relayed);
  const posts = open
    .filter(({ note }) => !before.has(note.comment.id))
    .map(({ ticket, note }) => ({
      comment: note.comment.id,
      kind: note.kind,
      identifier: ticket.identifier,
      channel: ticket.thread.channel,
      thread_ts: ticket.thread.thread_ts,
      text: `${leads[note.kind].replace('{identifier}', () => escape(ticket.identifier)).replace('{title}', () => escape(ticket.title))}\n\n${escape(note.comment.body)}`,
    }));
  if (!complete) return { posts, relayed: [...relayed] };
  const still = new Set(open.map(({ note }) => note.comment.id));
  return { posts, relayed: relayed.filter((id) => still.has(id)) };
}

// Slack reads <, > and & as markup: agent text must not mention or link anyone.
export const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
