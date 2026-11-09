// An in-memory bakers.build site behind the bakers stub: the bakers tools the poller
// uses, over one shared set of tickets and comments. Tickets carry their labels by
// name, as the tools return them. Tests read and change `site.tickets` etc. directly.

import { bakersStub } from './stubs.mjs';

export const PROJECT = '11111111-1111-4111-8111-111111111111';

/**
 * @param {{pageSize?: number}} options pageSize: the most rows bakers_ticket_list returns
 *   per page, whatever limit is asked for (to exercise paging with few tickets).
 */
export async function site({ pageSize = 50 } = {}) {
  const s = { tickets: [], comments: [], log: [] };
  let next = 0;
  const uuid = (prefix) => `${prefix}-${++next}`;

  const find = (ref) => {
    const t = s.tickets.find((x) => x.id === ref || x.identifier === ref);
    if (!t) throw new Error(`Ticket ${ref} does not exist or is not readable`);
    return t;
  };
  // As the list tool returns a link: its URI and title, no options.
  const link = (l) => ({ uri: l.uri, title: l.title });
  const comments = (t) =>
    s.comments
      .filter((c) => c.ticket === t.id)
      .sort((a, b) => a.created.localeCompare(b.created))
      .map((c) => ({ id: c.id, type: c.type, body: c.body, created: c.created, author: 'Agent' }));

  const once = {};
  const lost = {};
  const guard = (name, fn) => (args) => {
    s.log.push(`tool ${name}`);
    if (once[name] > 0) {
      once[name] -= 1;
      throw new Error(`${name} failed`);
    }
    if (lost[name] > 0) {
      lost[name] -= 1;
      fn(args);
      throw new Error(`${name}: reply lost`);
    }
    return fn(args);
  };
  const tools = {
    bakers_ticket_list: guard('bakers_ticket_list', (a) => {
      if (a.project !== PROJECT) throw new Error(`Project ${a.project} does not exist or is not readable.`);
      const limit = Math.min(a.limit ?? 50, pageSize);
      const offset = a.offset ?? 0;
      const rows = s.tickets.slice(offset, offset + limit);
      return {
        tickets: rows.map((t) => ({
          id: t.id,
          identifier: t.identifier,
          title: t.title,
          state: t.state,
          links: t.links.map(link),
          labels: [...t.labels],
          frozen: t.frozen,
          frozen_at: t.frozen_at,
          parent: t.parent,
          closed: t.closed,
        })),
        next_offset: offset + limit < s.tickets.length ? offset + limit : null,
      };
    }),
    bakers_ticket_read: guard('bakers_ticket_read', (a) => {
      const t = find(a.ticket);
      return { id: t.id, identifier: t.identifier, title: t.title, state: t.state, labels: [...t.labels], links: t.links.map(link), frozen: t.frozen, comments: comments(t) };
    }),
    bakers_ticket_transition: guard('bakers_ticket_transition', (a) => {
      const t = find(a.ticket);
      for (const l of a.links ?? []) if (!t.links.some((x) => x.uri === l.uri)) t.links.push({ uri: l.uri, title: l.title });
      return { state: t.state, links: t.links.map(link) };
    }),
  };

  function addTicket({ title = 'Price updater', state = 'qualification', links = [], labels = [], frozen = false, frozen_at = null, parent = null, closed = false, ...rest } = {}) {
    const n = s.tickets.length + 1;
    const t = { id: uuid('ticket'), identifier: `ACME-${n}`, title, state, links, labels, frozen, frozen_at, parent, closed, ...rest };
    s.tickets.push(t);
    return t;
  }
  function addComment(t, { type = 'comment', body = 'A comment', created = new Date().toISOString() } = {}) {
    const c = { id: uuid('comment'), ticket: t.id, type, body, created };
    s.comments.push(c);
    return c;
  }

  const stub = await bakersStub({ tools });
  // failOnce(tool, n): the next n calls of that tool are refused.
  const failOnce = (name, n = 1) => {
    once[name] = n;
  };
  // loseReplyOnce(tool): the next call takes effect, but its caller gets an error.
  const loseReplyOnce = (name) => {
    lost[name] = 1;
  };
  return { ...s, state: s, stub, addTicket, addComment, failOnce, loseReplyOnce, close: stub.close };
}

export const thread = (channel = 'C0000000001', ts = '1700000000.000100') => ({
  uri: `https://acme.slack.com/archives/${channel}/p${ts.replace('.', '')}`,
  title: 'Slack thread',
});

export const channel = (id = 'C0000000001') => ({ uri: `https://acme.slack.com/archives/${id}`, title: 'Slack channel' });
