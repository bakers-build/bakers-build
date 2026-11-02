// An in-memory bakers.build site behind the bakers stub: the JSON:API routes and
// tools the relay and the poller use, over one shared set of tickets, comments
// and label terms. Tests read and change `site.tickets` etc. directly.

import { bakersStub } from './stubs.mjs';

export const PROJECT = '11111111-1111-4111-8111-111111111111';
export const WORKSPACE = '22222222-2222-4222-8222-222222222222';

export async function site({ failTools = {} } = {}) {
  const s = { tickets: [], comments: [], labels: [{ id: 'label-question', name: 'Question' }], log: [] };
  let next = 0;
  const uuid = (prefix) => `${prefix}-${++next}`;

  const ticketResource = (t) => ({
    type: 'bb_ticket--bb_ticket',
    id: t.id,
    attributes: {
      identifier: t.identifier,
      title: t.title,
      state: t.state,
      links: t.links.map((l) => ({ uri: l.uri, title: l.title, options: l.kind ? { bakers: { kind: l.kind } } : [] })),
      frozen: t.frozen,
      frozen_at: t.frozen_at ?? null,
      closed: t.closed ?? false,
    },
    relationships: {
      labels: { data: t.labels.map((id) => ({ type: 'bb_term--label', id })) },
      parent_id: { data: t.parent ? { type: 'bb_ticket--bb_ticket', id: t.parent } : null },
    },
  });
  const included = (tickets) => {
    const ids = new Set(tickets.flatMap((t) => t.labels));
    return s.labels.filter((l) => ids.has(l.id)).map((l) => ({ type: 'bb_term--label', id: l.id, attributes: { name: l.name } }));
  };

  const jsonapi = (r) => {
    s.log.push(`${r.method} ${r.path}`);
    const parts = r.path.split('/').filter(Boolean);
    if (r.path === `/jsonapi/bb_project/bb_project/${PROJECT}`) {
      return { body: { data: { type: 'bb_project--bb_project', id: PROJECT, relationships: { workspace_id: { data: { type: 'bb_workspace--bb_workspace', id: WORKSPACE } } } } } };
    }
    if (r.path === '/jsonapi/bb_term/label' && r.method === 'GET') {
      const name = r.query.get('filter[name]');
      const hits = s.labels.filter((l) => l.name === name && r.query.get('filter[workspace_id.id]') === WORKSPACE);
      return { body: { data: hits.map((l) => ({ type: 'bb_term--label', id: l.id, attributes: { name: l.name } })) } };
    }
    if (r.path === '/jsonapi/bb_term/label' && r.method === 'POST') {
      const doc = JSON.parse(r.raw).data;
      if (doc.relationships.workspace_id.data.id !== WORKSPACE) return { status: 422, body: {} };
      const label = { id: uuid('label'), name: doc.attributes.name };
      s.labels.push(label);
      return { status: 201, body: { data: { type: 'bb_term--label', id: label.id, attributes: { name: label.name } } } };
    }
    if (parts[0] === 'jsonapi' && parts[1] === 'bb_ticket') {
      if (parts.length === 4) {
        const t = s.tickets.find((x) => x.id === parts[3]);
        if (!t) return { status: 404, body: {} };
        if (r.method === 'PATCH') {
          const doc = JSON.parse(r.raw).data;
          if (doc.attributes && 'frozen' in doc.attributes) t.frozen = doc.attributes.frozen;
          if (doc.relationships?.labels) t.labels = doc.relationships.labels.data.map((d) => d.id);
          return { body: { data: ticketResource(t) } };
        }
        return { body: { data: ticketResource(t), included: included([t]) } };
      }
      let rows = s.tickets.filter((t) => r.query.get('filter[project_id.id]') === null || r.query.get('filter[project_id.id]') === PROJECT);
      if (r.query.get('filter[identifier]')) rows = rows.filter((t) => t.identifier === r.query.get('filter[identifier]'));
      if (r.query.get('filter[closed]') === '0') rows = rows.filter((t) => !t.closed);
      return { body: { data: rows.map(ticketResource), included: included(rows), links: {} } };
    }
    if (r.path === '/jsonapi/bb_comment/bb_comment') {
      const ticket = r.query.get('filter[ticket_id.id]');
      let rows = s.comments.filter((c) => c.ticket === ticket);
      const type = r.query.get('filter[bb_comment_type]');
      if (type) rows = rows.filter((c) => c.type === type);
      rows = [...rows].sort((a, b) => b.created.localeCompare(a.created));
      return { body: { data: rows.map((c) => ({ type: 'bb_comment--bb_comment', id: c.id, attributes: { bb_comment_type: c.type, created: c.created, body: { value: c.body, format: 'bb_rich' } } })) } };
    }
    return { status: 404, body: {} };
  };

  const find = (ref) => {
    const t = s.tickets.find((x) => x.id === ref || x.identifier === ref);
    if (!t) throw new Error(`Ticket ${ref} does not exist or is not readable`);
    return t;
  };
  const once = {};
  const guard = (name, fn) => (args) => {
    s.log.push(`tool ${name}`);
    if (failTools[name]) throw new Error(failTools[name]);
    if (once[name] > 0) {
      once[name] -= 1;
      throw new Error(`${name} failed`);
    }
    return fn(args);
  };
  const tools = {
    bakers_ticket_create: guard('bakers_ticket_create', (a) => {
      const t = addTicket({ title: a.title, description: a.description, workflow: a.workflow, project: a.project, state: 'qualification' });
      return { id: t.id, identifier: t.identifier, state: t.state };
    }),
    bakers_ticket_update: guard('bakers_ticket_update', (a) => {
      const t = find(a.ticket);
      if (a.conductor) t.conductor = a.conductor;
      return { id: t.id, conductor: t.conductor };
    }),
    bakers_ticket_transition: guard('bakers_ticket_transition', (a) => {
      const t = find(a.ticket);
      for (const l of a.links ?? []) if (!t.links.some((x) => x.uri === l.uri)) t.links.push({ ...l, kind: /\.slack\.com\/archives\//.test(l.uri) ? 'chat' : 'doc' });
      return { state: t.state, links: t.links };
    }),
    bakers_comment_publish: guard('bakers_comment_publish', (a) => {
      const t = find(a.ticket);
      const c = addComment(t, { type: a.type, body: a.body });
      return { id: c.id, type: c.type };
    }),
    bakers_ticket_read: guard('bakers_ticket_read', (a) => {
      const t = find(a.ticket);
      return { id: t.id, identifier: t.identifier, title: t.title, state: t.state };
    }),
    bakers_ticket_search: guard('bakers_ticket_search', (a) => ({
      tickets: s.tickets.filter((t) => t.title.includes(a.query)).map((t) => ({ identifier: t.identifier, title: t.title, state: t.state })),
    })),
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

  const stub = await bakersStub({ jsonapi, tools });
  // failOnce(tool, n): the next n calls of that tool are refused.
  const failOnce = (name, n = 1) => {
    once[name] = n;
  };
  return { ...s, state: s, stub, addTicket, addComment, failOnce, close: stub.close };
}

export const thread = (channel = 'C0000000001', ts = '1700000000.000100') => ({
  uri: `https://acme.slack.com/archives/${channel}/p${ts.replace('.', '')}`,
  title: 'Slack thread',
  kind: 'chat',
});
