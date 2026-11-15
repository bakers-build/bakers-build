import { describe, expect, it, vi } from 'vitest';
import { cancelTicketRequest } from '../../../../src/Entity/ticket/Screen/ticket-actions.js';
import {
  TicketDetailScreen,
  ticketDetailInputContext,
} from '../../../../src/Entity/ticket/Screen/ticket-detail.js';
import { ContextBag } from '../../../../src/Routing/context.js';
import {
  ConfirmDialogScreen,
  type ConfirmRequest,
  confirmRequestContext,
} from '../../../../src/Screen/confirm-dialog.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import type { TicketDetailDocument } from '../../../../src/types.js';
import { renderTree } from '../../../render-tree.js';
import { type FakeClient, fakeClient } from '../../../test-support.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const ticket = (
  attributes: Record<string, unknown>,
  included: TicketDetailDocument['included'] = [],
): TicketDetailDocument => ({
  data: {
    type: 'bb_ticket--bb_ticket',
    id: 'ticket-1',
    attributes: { identifier: 'BB-1', title: 'A ticket', ...attributes },
  },
  included,
});

const keysOf = (screen: TicketDetailScreen, context: ScreenContext) =>
  (screen.present(context).actions ?? []).map((a) => `${a.key} ${a.label}`);

const detailFor = (document: TicketDetailDocument) => {
  const screen = new TicketDetailScreen();
  const context: ScreenContext = {
    sessionGeneration: 1,
    requestDraw: vi.fn(),
    isActive: () => true,
    params: { ticketId: 'ticket-1' },
    contexts: ContextBag.empty().set(ticketDetailInputContext, { document }),
    navigate: vi.fn(),
    nowSeconds: () => 0,
  };
  screen.enter(context);
  return { screen, context };
};

const dialogFor = async (request: ConfirmRequest, client: FakeClient) => {
  const screen = new ConfirmDialogScreen();
  const context: ScreenContext = {
    sessionGeneration: 1,
    requestDraw: vi.fn(),
    isActive: () => true,
    params: {},
    contexts: ContextBag.empty().set(confirmRequestContext, request),
    services: { client, writeClient: client } as never,
    back: vi.fn(() => true),
  };
  screen.enter(context);
  await settle();
  return { screen, context };
};

describe('cancel ticket through the confirmation dialog', () => {
  it('x on a non-terminal ticket opens the dialog', () => {
    const { screen, context } = detailFor(ticket({ state: 'working' }));
    expect(screen.actionForInput?.('x', context)).toMatchObject({
      type: 'navigate',
      routeId: ConfirmDialogScreen.route.id,
    });
    expect(keysOf(screen, context)).toContain('x cancel ticket');
  });

  it.each([
    ['done', { state: 'done' }],
    ['cancelled', { state: 'cancelled' }],
    ['closed', { state: 'working', closed: true }],
  ])('offers no cancel on a %s ticket', (_name, attributes) => {
    const { screen, context } = detailFor(ticket(attributes));
    expect(screen.actionForInput?.('x', context)).toBeUndefined();
    expect(keysOf(screen, context)).not.toContain('x cancel ticket');
  });

  it('asks about the ticket by its identifier', async () => {
    const { screen, context } = await dialogFor(
      cancelTicketRequest(ticket({ state: 'working' })),
      fakeClient(),
    );
    const shown = screen.present(context);
    expect(shown.title).toBe('✕ Cancel ticket');
    expect(renderTree(shown.body)).toContain('Cancel BB-1?');
    expect(renderTree(shown.body)).toContain('The ticket moves to cancelled.');
  });

  it('confirming writes only the cancelled state and returns the reloaded ticket', async () => {
    const reloaded = ticket({ state: 'cancelled' });
    const client = fakeClient({
      documents: { 'bb_ticket/bb_ticket/ticket-1': reloaded },
    });
    const { screen, context } = await dialogFor(
      cancelTicketRequest(ticket({ state: 'working' })),
      client,
    );
    screen.handleInput('enter', context);
    await settle();
    expect(client.writes).toEqual([
      {
        type: 'bb_ticket--bb_ticket',
        id: 'ticket-1',
        body: { attributes: { state: 'cancelled' } },
      },
    ]);
    expect(context.back).toHaveBeenCalledWith({
      type: 'ticket-cancelled',
      document: reloaded,
    });
  });

  it('Esc writes nothing', async () => {
    const client = fakeClient();
    const { screen, context } = await dialogFor(
      cancelTicketRequest(ticket({ state: 'working' })),
      client,
    );
    screen.handleInput('escape', context);
    expect(screen.takeAction()).toEqual({ type: 'back' });
    expect(client.writes).toEqual([]);
  });

  it('the detail repaints with the cancelled ticket', () => {
    const { screen, context } = detailFor(ticket({ state: 'working' }));
    screen.receiveResult(
      { type: 'ticket-cancelled', document: ticket({ state: 'cancelled' }) },
      context,
    );
    expect(screen.document?.data?.attributes?.state).toBe('cancelled');
    expect(screen.actionForInput?.('x', context)).toBeUndefined();
  });
});
