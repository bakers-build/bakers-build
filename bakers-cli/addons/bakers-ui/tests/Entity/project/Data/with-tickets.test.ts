import { expect, it } from 'vitest';
import { loadProjectWithTickets } from '../../../../src/Entity/project/Data/with-tickets.js';
import { toResource } from '../../../test-support.js';

// The PROJECT half of the former `tests/Service/project-data.test.ts`, split along
// the same line as the source (BB-236 phase 3, AC-19). Assertion bodies unchanged.

// Fake dropsh client: `.collection(...).first()` resolves the project header
// (a `toResource` wrapper, like the real client); `.get(...)` serves the
// include-aware ticket list that loadProjectWithTickets now delegates to.
function fakeClient({ project, ticketDoc }) {
  const calls = [];
  const chain = (type) => {
    const st = { type, filters: {} };
    const api = {
      where(path, _op, value) {
        st.filters[path] = value;
        return api;
      },
      sort: () => api,
      page: () => api,
      async first() {
        calls.push({ kind: 'first', ...st });
        return project ? toResource(project) : null;
      },
      async list() {
        calls.push({ kind: 'first', ...st });
        return project ? [toResource(project)] : [];
      },
    };
    return api;
  };
  return {
    calls,
    collection: (t) => chain(t),
    async get(path, params) {
      calls.push({ kind: 'get', path, params });
      return ticketDoc;
    },
  };
}

it('loadProjectWithTickets resolves project then delegates to the include-aware get path', async () => {
  const client = fakeClient({
    project: { id: 'p1', attributes: { name: 'bakers', key: 'bakers.build' } },
    ticketDoc: {
      data: [
        {
          id: 't1',
          attributes: {
            identifier: 'BB-1',
            title: 'A',
            state: 'spec',
            priority: 2,
            assignee_initials: 'CW',
            derived_status: 'running',
          },
          relationships: {
            labels: { data: [{ id: 'l1' }] },
            parent_id: { data: { id: 'p179' } },
            conductor_id: { data: { id: 'c3' } },
          },
        },
      ],
      included: [
        { id: 'p179', attributes: { identifier: 'BB-175' } },
        { id: 'c3', attributes: { label: 'cw-framework' } },
      ],
    },
  });
  const out = await loadProjectWithTickets(client, 'bakers');
  expect(out.project.id).toBe('p1');
  expect(out.project.name).toBe('bakers');
  expect(out.project.slug).toBe('bakers');
  expect(out.tickets[0].identifier).toBe('BB-1');
  expect(out.tickets[0].derivedStatus).toBe('running');
  expect(out.tickets[0].assigneeInitials).toBe('CW');
  expect(out.tickets[0].labels).toEqual(['l1']);
  expect(out.tickets[0].parent).toBe('BB-175');
  expect(out.tickets[0].conductor).toBe('cw-framework');

  const projectCall = client.calls.find(
    (c) => c.kind === 'first' && c.type === 'bb_project',
  );
  expect(projectCall.filters.name).toBe('bakers');
  const getCall = client.calls.find((c) => c.kind === 'get');
  expect(getCall.path).toBe('bb_ticket/bb_ticket');
  const gs = decodeURIComponent(getCall.params.getQueryString());
  expect(gs).toMatch(/project_id\.id/);
  expect(gs).toMatch(/p1/);
  expect(gs).toMatch(/include=parent_id,conductor_id/);
});

it('unknown project slug still filters tickets by the slug fallback id', async () => {
  const client = fakeClient({ project: null, ticketDoc: { data: [] } });
  const out = await loadProjectWithTickets(client, 'ghost');
  expect(out.project.id).toBe('ghost');
  expect(out.tickets).toEqual([]);
  const getCall = client.calls.find((c) => c.kind === 'get');
  expect(decodeURIComponent(getCall.params.getQueryString())).toMatch(/ghost/);
});
