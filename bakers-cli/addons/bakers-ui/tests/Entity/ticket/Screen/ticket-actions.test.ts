import { describe, expect, it, vi } from 'vitest';
import {
  cancelTicketRequest,
  restartTicketRequest,
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

/** A client whose site tools list `runs` as the ticket's restartable runs. */
const siteWith = (
  runs: { run: string; number: number; state: string }[],
  documents: Record<string, unknown> = {},
) => {
  const callTool = vi.fn(async (name: string, args: Record<string, unknown>) =>
    name === 'bakers_run_restartable'
      ? {
          tickets: runs.length
            ? [{ ticket: 'BB-1', uuid: 'ticket-1', title: 'A ticket', runs }]
            : [],
        }
      : { runs: args.runs },
  );
  return Object.assign(fakeClient({ documents }), { callTool });
};

describe('restart runs of a ticket through the confirmation dialog', () => {
  it('r is offered on an open ticket that is not frozen', () => {
    const { screen, context } = detailFor(ticket({ state: 'working' }));
    expect(screen.actionForInput?.('r', context)).toMatchObject({
      type: 'navigate',
      routeId: ConfirmDialogScreen.route.id,
    });
    expect(keysOf(screen, context)).toContain('r restart runs');
  });

  it.each([
    ['frozen', ticket({ state: 'working', frozen: true })],
    ['closed', ticket({ state: 'done' })],
  ])('r is not offered on a %s ticket', (_name, document) => {
    const { screen, context } = detailFor(document);
    expect(screen.actionForInput?.('r', context)).toBeUndefined();
    expect(keysOf(screen, context)).not.toContain('r restart runs');
  });

  it("asks the site for the ticket's runs and names them, with OK and Cancel", async () => {
    const client = siteWith([{ run: 'run-1', number: 7, state: 'failed' }]);
    const { screen, context } = await dialogFor(
      restartTicketRequest('ticket-1', 'BB-1'),
      client,
    );
    expect(client.callTool).toHaveBeenCalledWith('bakers_run_restartable', {
      ticket: 'ticket-1',
    });
    const shown = screen.present(context);
    expect(shown.title).toBe('↻ Restart runs');
    const text = renderTree(shown.body)
      .map((row) => row.trim())
      .join(' ');
    expect(text).toContain('Restart BB-1?');
    expect(text).toContain('run #7 (failed) is cancelled');
    expect(text).toContain('[ OK ]');
    expect(text).not.toContain('[x]');
  });

  it('OK cancels its runs through bakers_run_cancel and returns the ticket as read after', async () => {
    const after = ticket({ state: 'working', derived_status: 'idle' });
    const client = siteWith([{ run: 'run-1', number: 7, state: 'running' }], {
      'bb_ticket/bb_ticket/ticket-1': after,
    });
    const { screen, context } = await dialogFor(
      restartTicketRequest('ticket-1', 'BB-1'),
      client,
    );
    screen.handleInput('enter', context);
    await settle();
    expect(client.callTool).toHaveBeenCalledWith('bakers_run_cancel', {
      runs: ['run-1'],
      reason: 'Restart runs (ticket BB-1)',
    });
    expect(client.writes).toEqual([]);
    const result = vi.mocked(context.back).mock.calls[0]?.[0] as {
      type: string;
      document: TicketDetailDocument;
    };
    expect(result.type).toBe('run-cancelled');
    expect(result.document.data?.attributes?.derived_status).toBe('idle');
  });

  it('a failed read after the cancel still reports the cancel', async () => {
    const client = siteWith([{ run: 'run-1', number: 7, state: 'running' }]);
    client.get = vi.fn().mockRejectedValue(new Error('offline'));
    const { screen, context } = await dialogFor(
      restartTicketRequest('ticket-1', 'BB-1'),
      client,
    );
    screen.handleInput('enter', context);
    await settle();
    expect(context.back).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'run-cancelled' }),
    );
  });

  it('a ticket with nothing to restart says so and cancels nothing', async () => {
    const client = siteWith([]);
    const { screen, context } = await dialogFor(
      restartTicketRequest('ticket-1', 'BB-1'),
      client,
    );
    expect(renderTree(screen.present(context).body)).toContain(
      'There is no run to restart.',
    );
    expect(screen.handleInput('enter', context)).toBe(true);
    expect(screen.takeAction()).toEqual({ type: 'back' });
    await settle();
    expect(
      client.callTool.mock.calls.filter(
        ([name]) => name === 'bakers_run_cancel',
      ),
    ).toEqual([]);
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
  });
});
