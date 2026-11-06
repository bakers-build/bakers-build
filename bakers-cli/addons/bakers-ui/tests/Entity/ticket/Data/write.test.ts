import { expect, it } from 'vitest';
import {
  updateTicketAssignment,
  updateTicketFrozen,
} from '../../../../src/Entity/ticket/Data/write.js';
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
  ticketType: null as string | null,
  recipe: null as string | null,
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
          ticket_type: { data: null },
          recipe: { data: null },
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
      ticket_type: { data: null },
      recipe: { data: null },
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
