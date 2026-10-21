import { expect, it, vi } from 'vitest';
import { createSessionStore } from '../../src/Data/session-store.js';
import {
  loadTicketView,
  readTicket,
  refreshTicket,
  saveTicket,
} from '../../src/Entity/ticket/Data/store.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import type { TicketDetailDocument } from '../../src/types.js';

const overview: TicketDetailDocument = {
  data: {
    id: 't1',
    type: 'bb_ticket--bb_ticket',
    attributes: { title: 'Shared', identifier: 'TEST-1', state: 'coding' },
    relationships: {
      labels: { data: [{ id: 'label' }] },
      comments: { data: [{ id: 'old' }] },
    },
  },
  included: [
    {
      id: 'label',
      type: 'bb_term--bb_labels',
      attributes: { name: 'work:code' },
    },
    {
      id: 'old',
      type: 'bb_comment--bb_comment',
      attributes: { body: { value: 'old comment' } },
    },
  ],
};
function setup(responses: TicketDetailDocument[]) {
  const queries: string[] = [];
  const context = {
    params: { ticketId: 't1' },
    store: createSessionStore(),
    sessionGeneration: 1,
    requestDraw: vi.fn(),
    isActive: () => true,
    services: {
      client: {
        get: async (path: string, params: { getQueryString(): string }) => {
          queries.push(
            `${path}?${decodeURIComponent(params.getQueryString())}`,
          );
          const next = responses.shift();
          if (!next) throw Error('unexpected request');
          return next;
        },
      },
    },
  } as unknown as ScreenContext;
  return { context, queries };
}

it('retains header labels across a narrow response and loads only missing includes', async () => {
  const { context, queries } = setup([
    overview,
    {
      data: overview.data,
      included: [{ id: 'r1', type: 'bb_run--bb_run' }],
    },
  ]);
  await loadTicketView(context, ['labels', 'comments']);
  await loadTicketView(context, ['comments']);
  const result = await loadTicketView(context, ['runs']);
  expect(
    result.included?.some(
      (resource) => resource.attributes?.name === 'work:code',
    ),
  ).toBe(true);
  expect(queries).toEqual([
    'bb_ticket/bb_ticket/t1?include=comments,labels',
    'bb_ticket/bb_ticket/t1?include=runs',
  ]);
});

it('reload removes deleted comments while retaining unrelated included labels', async () => {
  const { context } = setup([
    overview,
    {
      data: {
        id: 't1',
        type: 'bb_ticket--bb_ticket',
        relationships: { comments: { data: [] } },
      },
      included: [],
    },
  ]);
  await loadTicketView(context, ['comments']);
  refreshTicket(context);
  const reloaded = await loadTicketView(context, ['comments']);
  expect(reloaded.included?.map((resource) => resource.id)).toEqual(['label']);
  expect(reloaded.data?.attributes?.title).toBe('Shared');
});

it('publishes a write to readers immediately and invalidates dependent include coverage', async () => {
  const { context } = setup([overview]);
  await loadTicketView(context, ['comments']);
  saveTicket(context, {
    data: { ...overview.data, attributes: { title: 'Saved' } },
  });
  expect(readTicket(context).data?.attributes?.title).toBe('Saved');
  expect(
    readTicket(context).included?.some((resource) => resource.id === 'label'),
  ).toBe(true);
});
