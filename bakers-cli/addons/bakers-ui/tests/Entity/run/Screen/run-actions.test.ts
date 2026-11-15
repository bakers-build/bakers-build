import { describe, expect, it, vi } from 'vitest';
import { cancelRunRequest } from '../../../../src/Entity/run/Screen/run-actions.js';
import {
  RunDetailScreen,
  runDetailInputContext,
} from '../../../../src/Entity/run/Screen/run-detail.js';
import { ContextBag } from '../../../../src/Routing/context.js';
import { buildRoutes } from '../../../../src/Routing/routes.js';
import {
  ConfirmDialogScreen,
  type ConfirmRequest,
  confirmRequestContext,
} from '../../../../src/Screen/confirm-dialog.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import type { TicketDetailDocument } from '../../../../src/types.js';
import { renderTree } from '../../../render-tree.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const document = (state: string): TicketDetailDocument => ({
  data: { id: 'ticket-1', type: 'bb_ticket--bb_ticket' },
  included: [
    {
      id: 'run-1',
      type: 'bb_run--bb_run',
      attributes: { state, drupal_internal__id: 42 },
    },
  ],
});

const contextFor = (): ScreenContext => ({
  sessionGeneration: 1,
  requestDraw: vi.fn(),
  isActive: () => true,
  params: { ticketId: 'ticket-1', runId: 'run-1' },
  contexts: ContextBag.empty(),
  navigate: vi.fn(),
  back: vi.fn(() => true),
});

const detailFor = async (state: string) => {
  const screen = new RunDetailScreen();
  const context = {
    ...contextFor(),
    contexts: ContextBag.empty().set(runDetailInputContext, {
      document: document(state),
    }),
  };
  screen.enter(context);
  await Promise.resolve();
  return { screen, context };
};

/** The dialog opened on `request`, as the router would open it. */
const dialogFor = async (
  request: ConfirmRequest,
  services: ScreenContext['services'],
) => {
  const screen = new ConfirmDialogScreen();
  const context = {
    ...contextFor(),
    contexts: ContextBag.empty().set(confirmRequestContext, request),
    services,
  } as ScreenContext;
  screen.enter(context);
  await settle();
  return { screen, context };
};

describe('cancel run through the confirmation dialog', () => {
  it.each([
    'claimed',
    'running',
  ])('x on a %s run opens the dialog directly', async (state) => {
    const { screen, context } = await detailFor(state);
    const action = screen.actionForInput?.('x', context);
    expect(action).toMatchObject({
      type: 'navigate',
      routeId: ConfirmDialogScreen.route.id,
    });
    expect(
      screen.present(context).actions?.map((a) => `${a.key} ${a.label}`),
    ).toContain('x cancel run');
  });

  it.each([
    'done',
    'failed',
    'expired',
    'cancelled',
  ])('offers no cancel on a %s run', async (state) => {
    const { screen, context } = await detailFor(state);
    expect(screen.actionForInput?.('x', context)).toBeUndefined();
    expect(
      (screen.present(context).actions ?? []).some((a) => a.key === 'x'),
    ).toBe(false);
  });

  it('no longer offers e edit on a run, and no run edit route exists', async () => {
    const { screen, context } = await detailFor('running');
    expect(screen.actionForInput?.('e', context)).toBeUndefined();
    expect(
      (screen.present(context).actions ?? []).some((a) => a.key === 'e'),
    ).toBe(false);
    const session = buildRoutes().createSession({ services: {} });
    expect([...session.screens().keys()]).not.toContain('run.edit');
  });

  it('asks about the run by its number', async () => {
    const request = cancelRunRequest(document('running'), 'run-1');
    const { screen, context } = await dialogFor(request, undefined);
    const shown = screen.present(context);
    expect(shown.title).toBe('✕ Cancel run');
    expect(renderTree(shown.body)).toContain('Cancel run #42?');
    expect(renderTree(shown.body)).toContain(
      'This marks the run as cancelled.',
    );
  });

  it('confirming writes the cancellation and returns run-cancelled', async () => {
    const write = { update: vi.fn().mockResolvedValue({}) };
    const { screen, context } = await dialogFor(
      cancelRunRequest(document('running'), 'run-1'),
      { client: write, writeClient: write } as never,
    );
    expect(screen.handleInput('enter', context)).toBe(true);
    await settle();
    expect(write.update).toHaveBeenCalledTimes(1);
    expect(write.update).toHaveBeenCalledWith('bb_run--bb_run', 'run-1', {
      attributes: { state: 'cancelled' },
    });
    expect(context.back).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run-cancelled',
        runId: 'run-1',
        document: expect.objectContaining({
          included: [
            expect.objectContaining({
              attributes: expect.objectContaining({ state: 'cancelled' }),
            }),
          ],
        }),
      }),
    );
  });

  it('Esc writes nothing', async () => {
    const write = { update: vi.fn() };
    const { screen, context } = await dialogFor(
      cancelRunRequest(document('running'), 'run-1'),
      { client: write, writeClient: write } as never,
    );
    expect(screen.handleInput('escape', context)).toBe(true);
    expect(screen.takeAction()).toEqual({ type: 'back' });
    expect(write.update).not.toHaveBeenCalled();
  });

  it('repaints the detail after cancellation', async () => {
    const { screen, context } = await detailFor('running');
    screen.receiveResult(
      { type: 'run-cancelled', document: document('cancelled') },
      context,
    );
    expect(screen.actionForInput?.('x', context)).toBeUndefined();
    expect(context.requestDraw).toHaveBeenCalled();
  });

  it('forwards a received cancellation on Esc, for the Runs tab above it', async () => {
    const { screen, context } = await detailFor('running');
    const result = { type: 'run-cancelled', document: document('cancelled') };
    screen.receiveResult(result, context);

    expect(screen.handleInput('escape', context)).toBe(true);
    expect(screen.takeAction()).toEqual({ type: 'back', result });
    // A second Esc, with nothing new received, carries no result.
    expect(screen.handleInput('escape', context)).toBe(false);
  });
});
