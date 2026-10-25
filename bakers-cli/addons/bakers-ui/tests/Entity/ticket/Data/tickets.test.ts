import type { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { expect, it } from 'vitest';
import { DEFAULT_TICKET_CRITERIA } from '../../../../src/Entity/ticket/Data/query.js';
import {
  loadFilteredTickets,
  mapTicketData,
  mapTicketDocument,
  TICKET_COLUMNS,
  TICKET_LIST_ATTRIBUTES,
  TICKET_LIST_FIELDS,
  TICKET_LIST_RELATIONSHIPS,
} from '../../../../src/Entity/ticket/Data/tickets.js';
import type { DropshClient } from '../../../../src/types.js';

// The same six-line double the runs loader test uses, so the two loader cases
// state their window against the same shape.
function fakeClient(doc: unknown): {
  client: DropshClient;
  captured: { path?: string; params?: unknown };
} {
  const captured: { path?: string; params?: unknown } = {};
  const client: DropshClient = {
    get: async (path, params) => {
      captured.path = path;
      captured.params = params;
      return doc;
    },
    collection: () => ({}) as never,
  };
  return { client, captured };
}

it('states the window its own query asked for, page one included (BB-312 D3)', async () => {
  const { client, captured } = fakeClient({ data: [] });
  const first = await loadFilteredTickets(
    client,
    'proj-1',
    DEFAULT_TICKET_CRITERIA,
    0,
  );
  expect(first.window).toEqual({ offset: 0, limit: 20 });
  const qs = decodeURIComponent(
    (captured.params as DrupalJsonApiParams).getQueryString(),
  );
  // Page one carries no offset so its query stays the shortest it can be; the
  // window states the 0 the query leaves implicit.
  expect(qs).not.toContain('page[offset]');
  const third = await loadFilteredTickets(
    client,
    'proj-1',
    DEFAULT_TICKET_CRITERIA,
    2,
  );
  expect(third.window).toEqual({ offset: 40, limit: 20 });
});

// The TICKET half of the former `tests/Service/project-data.test.ts`. Its cases
// split along exactly the line the source split on (BB-236 phase 3, AC-19);
// every assertion body below is unchanged. The `loadProjectWithTickets` cases
// moved to `tests/Entity/project/Data/with-tickets.test.ts`.

it('mapTicketData maps a raw JSON:API entry incl. type', () => {
  const row = mapTicketData({
    id: 'u1',
    attributes: {
      identifier: 'BB-1',
      title: 'T',
      state: 'spec',
      priority: 2,
      assignee_initials: 'CW',
      derived_status: 'running',
      workflow: 'bb_work',
    },
    relationships: { labels: { data: [] } },
  });
  expect(row.id).toBe('u1');
  expect(row.identifier).toBe('BB-1');
  expect(row.type).toBe('bb_work');
  expect(row.state).toBe('spec');
  expect(row.labels).toEqual([]);
  expect(row.parent).toBe(null);
  expect(row.conductor).toBe(null);
});

it('mapTicketData resolves parent identifier + conductor label from included (AC-1/3/5)', () => {
  const index = new Map([
    ['p179', { id: 'p179', attributes: { identifier: 'BB-175' } }],
    ['c3', { id: 'c3', attributes: { label: 'cw-framework' } }],
  ]);
  const row = mapTicketData(
    {
      id: 'u1',
      attributes: { identifier: 'BB-193', title: 'T' },
      relationships: {
        parent_id: { data: { id: 'p179' } },
        conductor_id: { data: { id: 'c3' } },
      },
    },
    index,
  );
  expect(row.parent).toBe('BB-175');
  expect(row.conductor).toBe('cw-framework');
});

it('mapTicketData: absent parent/conductor linkage → null (AC-2/4)', () => {
  const row = mapTicketData(
    {
      id: 'u1',
      attributes: { identifier: 'BB-1', title: 'T' },
      relationships: {
        parent_id: { data: null },
        // conductor_id relationship entirely absent
      },
    },
    new Map(),
  );
  expect(row.parent).toBe(null);
  expect(row.conductor).toBe(null);
});

it('mapTicketData: linkage present but target not in included → null, no throw (AC-2/4 robustness)', () => {
  const row = mapTicketData(
    {
      id: 'u1',
      attributes: { identifier: 'BB-1', title: 'T' },
      relationships: {
        parent_id: { data: { id: 'missing-p' } },
        conductor_id: { data: { id: 'missing-c' } },
      },
    },
    new Map(),
  );
  expect(row.parent).toBe(null);
  expect(row.conductor).toBe(null);
});

// BB-252 — the single mapper accepts a whole document, so the list row of an
// edited ticket is rebuilt from the re-read `submitEditForm` already performs
// instead of by a second, row-shaped mapper (spec Decision 2).
it('mapTicketDocument maps a detail-shaped document to a row, parent included (BB-252)', () => {
  const row = mapTicketDocument({
    data: {
      id: 'u1',
      attributes: {
        identifier: 'BB-252',
        title: 'T',
        state: 'coding',
        assignee_initials: 'CW',
        derived_status: 'running',
        workflow: 'bb_work',
      },
      relationships: {
        labels: { data: [] },
        parent_id: { data: { id: 'p179' } },
        conductor_id: { data: { id: 'c3' } },
      },
    },
    included: [
      { id: 'p179', attributes: { identifier: 'BB-236' } },
      { id: 'c3', attributes: { label: 'cw-framework' } },
    ],
  });
  expect(row.id).toBe('u1');
  expect(row.identifier).toBe('BB-252');
  expect(row.assigneeInitials).toBe('CW');
  expect(row.conductor).toBe('cw-framework');
  // The measured regression the include-list change exists for: mapping a
  // detail document that does not sideload `parent_id` blanks this column.
  expect(row.parent).toBe('BB-236');
});

it('mapTicketDocument tolerates an empty document (BB-252)', () => {
  const row = mapTicketDocument({});
  expect(row.id).toBe('');
  expect(row.parent).toBe(null);
  expect(row.conductor).toBe(null);
});

// BB-299 D4 — the row carries the assignee's uuid so the Who filter's
// client-side guard can compare it against the picked criterion.
it('mapTicketData maps the assignee_user_id linkage to assigneeId (BB-299 D4)', () => {
  const row = mapTicketData({
    id: 'u1',
    attributes: { identifier: 'BB-1', title: 'T' },
    relationships: { assignee_user_id: { data: { id: 'user-uuid-1' } } },
  });
  expect(row.assigneeId).toBe('user-uuid-1');
});

it('mapTicketData: absent or null assignee linkage maps to assigneeId null (BB-299 D4)', () => {
  const absent = mapTicketData({
    id: 'u1',
    attributes: { identifier: 'BB-1', title: 'T' },
  });
  expect(absent.assigneeId).toBe(null);
  const nulled = mapTicketData({
    id: 'u2',
    attributes: { identifier: 'BB-2', title: 'T' },
    relationships: { assignee_user_id: { data: null } },
  });
  expect(nulled.assigneeId).toBe(null);
});

it('maps owner initials, and falls back to an em dash', () => {
  const rowWithOwner = mapTicketData({
    id: 't1',
    attributes: { identifier: 'BB-1', owner_initials: 'AL' },
  });
  const rowWithoutOwner = mapTicketData({
    id: 't2',
    attributes: { identifier: 'BB-2' },
  });
  const owner = TICKET_COLUMNS.find((c) => c.key === 'owner');
  expect(owner?.label).toBe('BY');
  expect(owner?.get(rowWithOwner)).toBe('AL');
  expect(owner?.get(rowWithoutOwner)).toBe('—');
});

it('requests owner_initials in the list fieldset', () => {
  expect(TICKET_LIST_ATTRIBUTES).toContain('owner_initials');
});

it('mapTicketData carries frozen + stall_reason', () => {
  const row = mapTicketData({
    id: 'u1',
    attributes: {
      identifier: 'BB-302',
      title: 'T',
      state: 'coding',
      frozen: true,
      stall_reason: 'frozen',
    },
  });
  expect(row.frozen).toBe(true);
  expect(row.stallReason).toBe('frozen');
});

it('mapTicketData reads an absent frozen as not frozen', () => {
  const row = mapTicketData({
    id: 'u1',
    attributes: { identifier: 'BB-1', title: 'T' },
  });
  expect(row.frozen).toBe(false);
  expect(row.stallReason).toBe('');
});

it('the list request asks for both freeze attributes', () => {
  expect(TICKET_LIST_ATTRIBUTES).toContain('frozen');
  expect(TICKET_LIST_ATTRIBUTES).toContain('stall_reason');
});

it('RUN column shows stall_reason when present, else derived_status, at width 12', () => {
  const run = TICKET_COLUMNS.find((column) => column.key === 'run');
  expect(run?.width).toBe(12);
  expect(run?.fields).toEqual(['derived_status', 'stall_reason']);
  const base = mapTicketData({
    id: 'u1',
    attributes: { identifier: 'BB-302', title: 'T' },
  });
  expect(
    run?.get({ ...base, stallReason: 'no conductor', derivedStatus: 'idle' }),
  ).toBe('no conductor');
  expect(run?.get({ ...base, stallReason: '', derivedStatus: 'running' })).toBe(
    'running',
  );
  expect(
    run?.get({ ...base, stallReason: 'frozen', derivedStatus: 'running' }),
  ).toBe('frozen');
});

it('keeps the owner column beside the assignee column', () => {
  const keys = TICKET_COLUMNS.map((c) => c.key);
  expect(keys.indexOf('owner')).toBe(keys.indexOf('assignee') + 1);
});

it('loadFilteredTickets queries via client.get, sideloads rels, resolves from included', async () => {
  let calledPath = null;
  let calledParams = null;
  const client = {
    get: async (path, params) => {
      calledPath = path;
      calledParams = params;
      return {
        data: [
          {
            id: 'u1',
            attributes: { identifier: 'BB-193', title: 'T' },
            relationships: {
              labels: { data: [] },
              parent_id: { data: { id: 'p179' } },
              conductor_id: { data: { id: 'c3' } },
            },
          },
        ],
        included: [
          { id: 'p179', attributes: { identifier: 'BB-175' } },
          { id: 'c3', attributes: { label: 'cw-framework' } },
        ],
      };
    },
  };
  // A PAGE since BB-292: rows plus `hasNext` off the document's `links.next`.
  const page = await loadFilteredTickets(client, 'P1', {
    query: 'g',
    state: null,
    closed: null,
    parent: null,
    who: null,
  });
  expect(calledPath).toBe('bb_ticket/bb_ticket');
  const s = decodeURIComponent(calledParams.getQueryString());
  expect(s).toMatch(/filter\[search\]=g/);
  expect(s).toMatch(/include=parent_id,conductor_id/);
  expect(page.rows.length).toBe(1);
  expect(page.rows[0].identifier).toBe('BB-193');
  expect(page.rows[0].parent).toBe('BB-175');
  expect(page.rows[0].conductor).toBe('cw-framework');
  // This document carries no `links`, so it is the last page.
  expect(page.hasNext).toBe(false);
});

// BB-292 AC-5: the fieldset is the mapper's own lower bound. A resource built
// from EXACTLY the fieldset must map to a row with no placeholder in it — if a
// column were added without its attribute, this row would carry the fallback.
it('a resource carrying exactly the fieldset maps to a row with no fallback value', () => {
  const attributes: Record<string, unknown> = {
    identifier: 'BB-1',
    title: 'A title',
    state: 'coding',
    priority: 2,
    assignee_initials: 'CW',
    owner_initials: 'AL',
    derived_status: 'running',
    stall_reason: 'failing',
    workflow: 'bb_work',
    closed: false,
    frozen: false,
  };
  // Every requested attribute is consumed by the mapper, and nothing else is.
  expect(Object.keys(attributes).sort()).toEqual(
    [...TICKET_LIST_ATTRIBUTES].sort(),
  );

  const row = mapTicketData(
    {
      id: 'uuid-1',
      attributes,
      relationships: {
        labels: { data: [{ id: 'uuid-label' }] },
        parent_id: { data: { id: 'uuid-parent' } },
        conductor_id: { data: { id: 'uuid-cond' } },
        assignee_user_id: { data: { id: 'uuid-user' } },
        project_id: { data: { id: 'uuid-project' } },
      },
    },
    new Map([
      ['uuid-parent', { attributes: { identifier: 'BB-0' } }],
      ['uuid-cond', { attributes: { label: 'cw-framework' } }],
    ]),
  );

  expect(row).toEqual({
    id: 'uuid-1',
    identifier: 'BB-1',
    title: 'A title',
    state: 'coding',
    priority: 2,
    assigneeInitials: 'CW',
    ownerInitials: 'AL',
    derivedStatus: 'running',
    stallReason: 'failing',
    labels: ['uuid-label'],
    type: 'bb_work',
    parent: 'BB-0',
    conductor: 'cw-framework',
    assigneeId: 'uuid-user',
    projectId: 'uuid-project',
    closed: false,
    frozen: false,
  });
});

// Spec fact 5, measured: a fieldset without the relationship names returns
// `relationships: (none)` while `included` still arrives, so PARENT/COND/labels
// blank with no error. The relationships are therefore part of the fieldset.
it('the fieldset carries the relationships the row resolves through', () => {
  expect(TICKET_LIST_RELATIONSHIPS).toEqual([
    'labels',
    'parent_id',
    'conductor_id',
    // The who filter's guard operand (BB-299 D4) — no column renders it.
    'assignee_user_id',
    // The project filter's guard operand (BB-540) — no column renders it.
    'project_id',
  ]);
  expect(TICKET_LIST_FIELDS).toEqual([
    ...TICKET_LIST_ATTRIBUTES,
    ...TICKET_LIST_RELATIONSHIPS,
  ]);
});

it('keeps both accounted-time fields OUT of the list request (BB-308 AC-6)', () => {
  // Not a style preference: BB-294 derives this list from the declared
  // columns, so adding a TIME column to the ticket table would silently add
  // both attributes to every list read. This test is what makes that loud.
  expect(TICKET_LIST_ATTRIBUTES).not.toContain('time_estimate');
  expect(TICKET_LIST_ATTRIBUTES).not.toContain('time_spent');
});
