import { describe, expect, it, vi } from 'vitest';
import {
  cancelTicketRequest,
  restartRunRequest,
} from '../../../../src/Entity/ticket/Screen/ticket-actions.js';
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
import {
  type FakeClient,
  fakeClient,
  queryStringOf,
} from '../../../test-support.js';

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

const run = (id: string, state: string, number: number) => ({
  type: 'bb_run--bb_run',
  id,
  attributes: { state, drupal_internal__id: number },
});

/** What the dialog reads when it opens: the ticket with its runs. */
const withRuns = (...runs: ReturnType<typeof run>[]): TicketDetailDocument => ({
  data: {
    type: 'bb_ticket--bb_ticket',
    id: 'ticket-1',
    attributes: { identifier: 'BB-1', state: 'working' },
    relationships: {
      runs: { data: runs.map(({ type, id }) => ({ type, id })) },
    },
  },
  included: runs,
});

describe('restart run through the confirmation dialog', () => {
  it.each([
    [
      'an included claimed run',
      ticket({ state: 'working' }, [run('run-1', 'claimed', 7)]),
    ],
    [
      'derived_status running',
      ticket({ state: 'working', derived_status: 'running' }),
    ],
  ])('r is offered with %s', (_name, document) => {
    const { screen, context } = detailFor(document);
    expect(screen.actionForInput?.('r', context)).toMatchObject({
      type: 'navigate',
      routeId: ConfirmDialogScreen.route.id,
    });
    expect(keysOf(screen, context)).toContain('r restart run');
  });

  it('r is not offered without an active run', () => {
    const { screen, context } = detailFor(
      ticket({ state: 'working', derived_status: 'done' }, [
        run('run-1', 'done', 6),
      ]),
    );
    expect(screen.actionForInput?.('r', context)).toBeUndefined();
    expect(keysOf(screen, context)).not.toContain('r restart run');
  });

  it('reads the runs when it opens and names the active one', async () => {
    const client = fakeClient({
      documents: {
        'bb_ticket/bb_ticket/ticket-1': withRuns(
          run('run-0', 'done', 6),
          run('run-1', 'running', 7),
        ),
      },
    });
    const { screen, context } = await dialogFor(
      restartRunRequest('ticket-1', 'BB-1'),
      client,
    );
    const query = decodeURIComponent(queryStringOf(client.requests[0]?.params));
    expect(client.requests[0]?.path).toBe('bb_ticket/bb_ticket/ticket-1');
    expect(query).toContain('include=runs');
    expect(query).toContain('fields[bb_run--bb_run]=state,drupal_internal__id');
    const shown = screen.present(context);
    expect(shown.title).toBe('↻ Restart run');
    const text = renderTree(shown.body)
      .map((row) => row.trim())
      .join(' ');
    expect(text).toContain('Restart run #7 of BB-1?');
    expect(text).toContain(
      'The active run is cancelled; the conductor starts a new one.',
    );
  });

  it('confirming cancels exactly the active run and writes nothing else', async () => {
    const client = fakeClient({
      documents: {
        'bb_ticket/bb_ticket/ticket-1': withRuns(
          run('run-0', 'done', 6),
          run('run-1', 'running', 7),
        ),
      },
    });
    const { screen, context } = await dialogFor(
      restartRunRequest('ticket-1', 'BB-1'),
      client,
    );
    screen.handleInput('enter', context);
    await settle();
    expect(client.writes).toEqual([
      {
        type: 'bb_run--bb_run',
        id: 'run-1',
        body: { attributes: { state: 'cancelled' } },
      },
    ]);
    expect(context.back).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'run-cancelled', runId: 'run-1' }),
    );
  });

  it('a run that ended before the dialog opened is not cancelled', async () => {
    const client = fakeClient({
      documents: {
        'bb_ticket/bb_ticket/ticket-1': withRuns(run('run-1', 'done', 7)),
      },
    });
    const { screen, context } = await dialogFor(
      restartRunRequest('ticket-1', 'BB-1'),
      client,
    );
    expect(renderTree(screen.present(context).body)).toContain(
      'No active run any more.',
    );
    expect(screen.handleInput('enter', context)).toBe(false);
    await settle();
    expect(client.writes).toEqual([]);
  });

  it('Esc writes nothing', async () => {
    const client = fakeClient({
      documents: {
        'bb_ticket/bb_ticket/ticket-1': withRuns(run('run-1', 'running', 7)),
      },
    });
    const { screen, context } = await dialogFor(
      restartRunRequest('ticket-1', 'BB-1'),
      client,
    );
    screen.handleInput('escape', context);
    expect(screen.takeAction()).toEqual({ type: 'back' });
    expect(client.writes).toEqual([]);
  });

  it('the detail keeps its own includes when the cancelled run comes back', () => {
    const { screen, context } = detailFor(
      ticket({ state: 'working' }, [
        run('run-1', 'running', 7),
        { type: 'bb_term--label', id: 'label-1', attributes: { name: 'ui' } },
      ]),
    );
    screen.receiveResult(
      {
        type: 'run-cancelled',
        runId: 'run-1',
        document: withRuns(run('run-1', 'cancelled', 7)),
      },
      context,
    );
    const included = screen.document?.included ?? [];
    expect(included.find((r) => r.id === 'label-1')).toBeDefined();
    expect(included.find((r) => r.id === 'run-1')?.attributes?.state).toBe(
      'cancelled',
    );
    expect(screen.actionForInput?.('r', context)).toBeUndefined();
  });
});
