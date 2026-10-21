import { expect, it } from 'vitest';
import {
  buildTicketCreateBody,
  createTicket,
  updateTicketAssignment,
  updateTicketFrozen,
} from '../../../../src/Entity/ticket/Data/write.js';
import type { CreateFormPayload } from '../../../../src/Entity/ticket/Form/create.js';
import { serializeEdit } from '../../../../src/Entity/ticket/Form/edit.js';
import { fakeClient } from '../../../test-support.js';

const TICKET = 'cccccccc-0000-0000-0000-000000000001';
const USER = 'aaaaaaaa-0000-0000-0000-000000000001';
const COND = 'bbbbbbbb-0000-0000-0000-000000000001';

const emptyForm = {
  ticketId: TICKET,
  assignee: USER as string | null,
  conductor: COND as string | null,
  estimate: '',
  spent: '',
  parent: null as string | null,
  parentQuery: '',
  labels: new Set<string>(),
  reviewers: new Set<string>(),
  reviewersLoaded: false,
  active: 0,
  cursor: 0,
};

it('AC-2/AC-3: calls update with the exact (type, id, body) triple', async () => {
  const client = fakeClient();
  const body = serializeEdit({
    ...emptyForm,
    // BB-308: the state carries both durations; an empty one serialises as an
    // explicit null, which is what an unestimated ticket writes.
  });
  await updateTicketAssignment(client, TICKET, body);

  expect(client.writes).toEqual([
    {
      type: 'bb_ticket--bb_ticket',
      id: TICKET,
      body: {
        attributes: { time_estimate: null, time_spent: null },
        relationships: {
          assignee_user_id: { data: { type: 'user--user', id: USER } },
          conductor_id: {
            data: { type: 'bb_conductor--bb_conductor', id: COND },
          },
          labels: { data: [] },
          parent_id: { data: null },
        },
      },
    },
  ]);
});

it('AC-4: a cleared field goes over the wire as data: null', async () => {
  const client = fakeClient();
  await updateTicketAssignment(
    client,
    TICKET,
    serializeEdit({
      ...emptyForm,
      assignee: null,
      conductor: null,
    }),
  );
  expect(client.writes[0]?.body).toEqual({
    attributes: { time_estimate: null, time_spent: null },
    relationships: {
      assignee_user_id: { data: null },
      conductor_id: { data: null },
      labels: { data: [] },
      parent_id: { data: null },
    },
  });
});

it('BB-360: an ordinary edit sends no state attribute', () => {
  const body = serializeEdit(emptyForm);
  expect(body.attributes).not.toHaveProperty('state');
});

it('AC-5: a rejection PROPAGATES, so the caller can run it through serverMessage', async () => {
  const boom = Object.assign(new Error('HTTP 403'), {
    status: 403,
    body: { errors: [{ title: 'Forbidden', detail: 'nope.' }] },
  });
  const client = fakeClient({ writeError: boom });
  await expect(
    updateTicketAssignment(client, TICKET, { relationships: {} }),
  ).rejects.toBe(boom);
});

it('no write client is a NAMED error, never a silent no-op', async () => {
  await expect(
    updateTicketAssignment(undefined, TICKET, { relationships: {} }),
  ).rejects.toThrow(/no write client/i);
});

// ---- BB-309: the DIRECT create body ---------------------------------------
//
// APPENDED. `buildTicketCreateBody` is pure, so every claim about what a direct
// create writes is a unit test here rather than a live observation.

const PROJECT = 'dddddddd-0000-0000-0000-000000000001';
const LABEL = 'eeeeeeee-0000-0000-0000-000000000001';
const PARENT = 'ffffffff-0000-0000-0000-000000000001';

const payload = (over: Partial<CreateFormPayload> = {}): CreateFormPayload => ({
  title: 'Add a direct create',
  description: 'line one\n\nline two',
  workflow: { id: 'bb_feature', label: 'feature' },
  assignee: { id: USER, label: 'cw' },
  conductor: { id: COND, label: 'cw-framework' },
  labels: [{ id: LABEL, label: 'work:code' }],
  reviewers: [],
  parent: { id: PARENT, identifier: 'BB-1', title: 'Parent' },
  ...over,
});

it('AC-3/AC-4: the body carries the typed text verbatim and every picked value', () => {
  expect(buildTicketCreateBody(payload(), PROJECT)).toEqual({
    attributes: {
      title: 'Add a direct create',
      description: { value: 'line one\n\nline two', format: 'bb_rich' },
      workflow: 'bb_feature',
    },
    relationships: {
      project_id: {
        data: { type: 'bb_project--bb_project', id: PROJECT },
      },
      assignee_user_id: { data: { type: 'user--user', id: USER } },
      conductor_id: {
        data: { type: 'bb_conductor--bb_conductor', id: COND },
      },
      labels: { data: [{ type: 'bb_term--bb_labels', id: LABEL }] },
      parent_id: { data: { type: 'bb_ticket--bb_ticket', id: PARENT } },
    },
  });
});

it('D1: the title is TRIMMED, exactly as the agent path already trims it', () => {
  // `shortName()` trims before it names the agent's tab, so the same payload
  // produced a tab called `Add a direct create` and a ticket called
  // `  Add a direct create  `. The server stores what it is sent, so the
  // trailing blanks would have been in the ticket, in every list, for good.
  const body = buildTicketCreateBody(
    payload({ title: '  Add a direct create  ' }),
    PROJECT,
  );
  expect(body.attributes?.title).toBe('Add a direct create');
});

it('AC-5/D5: no server-owned field is ever written', () => {
  const body = buildTicketCreateBody(payload(), PROJECT);
  for (const key of [
    'state',
    'identifier',
    'number',
    'branch_name',
    'base_branch',
    'closed',
  ]) {
    expect(body.attributes).not.toHaveProperty(key);
  }
});

it('D8: an unpicked relationship is OMITTED, never sent as null', () => {
  const body = buildTicketCreateBody(
    payload({
      assignee: null,
      conductor: null,
      labels: [],
      reviewers: [],
      parent: null,
    }),
    PROJECT,
  );
  expect(body.relationships).toEqual({
    project_id: { data: { type: 'bb_project--bb_project', id: PROJECT } },
  });
});

it('writes two reviewers as user--user to-many linkage and omits an empty set', () => {
  const reviewerA = 'aaaaaaaa-0000-0000-0000-000000000011';
  const reviewerB = 'aaaaaaaa-0000-0000-0000-000000000012';
  const withReviewers = buildTicketCreateBody(
    payload({
      reviewers: [
        { id: reviewerA, label: 'ada' },
        { id: reviewerB, label: 'alan' },
      ],
    }),
    PROJECT,
  );
  expect(withReviewers.relationships?.reviewers).toEqual({
    data: [
      { type: 'user--user', id: reviewerA },
      { type: 'user--user', id: reviewerB },
    ],
  });
  expect(withReviewers.attributes?.title).toBe('Add a direct create');
  expect(withReviewers.relationships?.assignee_user_id).toEqual({
    data: { type: 'user--user', id: USER },
  });

  const emptyReviewers = buildTicketCreateBody(
    payload({ reviewers: [] }),
    PROJECT,
  );
  expect(emptyReviewers.relationships).not.toHaveProperty('reviewers');
});

it('createTicket posts the body against the ticket type', async () => {
  const client = fakeClient();
  await createTicket(client, buildTicketCreateBody(payload(), PROJECT));
  expect(client.creates).toHaveLength(1);
  expect(client.creates[0]?.type).toBe('bb_ticket--bb_ticket');
});

it('createTicket rejects by NAME when there is no client at all', async () => {
  await expect(createTicket(undefined, { attributes: {} })).rejects.toThrow(
    /no write client/,
  );
});

it('updateTicketFrozen PATCHes attributes.frozen on the ticket type', async () => {
  const client = fakeClient();
  await updateTicketFrozen(client, TICKET, true);
  expect(client.writes).toEqual([
    {
      type: 'bb_ticket--bb_ticket',
      id: TICKET,
      body: { attributes: { frozen: true } },
    },
  ]);
  await updateTicketFrozen(client, TICKET, false);
  expect(client.writes[1]?.body).toEqual({ attributes: { frozen: false } });
});

it('updateTicketFrozen rejects by NAME when there is no client at all', async () => {
  await expect(updateTicketFrozen(undefined, TICKET, true)).rejects.toThrow(
    /no write client/,
  );
});

it('updateTicketFrozen lets a refusal propagate to the caller', async () => {
  const boom = Object.assign(new Error('HTTP 403'), { status: 403 });
  const client = fakeClient({ writeError: boom });
  await expect(updateTicketFrozen(client, TICKET, true)).rejects.toBe(boom);
});
