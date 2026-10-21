import { describe, expect, it, vi } from 'vitest';
import { EditRunFormScreen } from '../../../../src/Entity/run/Screen/edit-run-form.js';
import {
  RunDetailScreen,
  runDetailInputContext,
} from '../../../../src/Entity/run/Screen/run-detail.js';
import { ContextBag } from '../../../../src/Routing/context.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import type { TicketDetailDocument } from '../../../../src/types.js';
import { renderTree } from '../../../render-tree.js';

const document = (state: string): TicketDetailDocument => ({
  data: { id: 'ticket-1', type: 'bb_ticket--bb_ticket' },
  included: [
    {
      id: 'run-1',
      type: 'bb_run--bb_run',
      attributes: { state },
    },
  ],
});

const contextFor = (_doc: TicketDetailDocument): ScreenContext => ({
  sessionGeneration: 1,
  requestDraw: vi.fn(),
  isActive: () => true,
  params: { ticketId: 'ticket-1', runId: 'run-1' },
  contexts: ContextBag.empty(),
  navigate: vi.fn(),
  back: vi.fn(() => true),
});

describe('run cancellation screen', () => {
  it.each(['claimed', 'running'])('offers edit for %s runs', async (state) => {
    const screen = new RunDetailScreen();
    const context = contextFor(document(state));
    screen.enter({
      ...context,
      contexts: ContextBag.empty().set(runDetailInputContext, {
        document: document(state),
      }),
    });
    await Promise.resolve();
    expect(screen.commandForInput?.('e')).toBe('edit-run');
  });

  it.each([
    'done',
    'failed',
    'expired',
    'cancelled',
  ])('does not offer edit for %s runs', async (state) => {
    const screen = new RunDetailScreen();
    const context = contextFor(document(state));
    screen.enter({
      ...context,
      contexts: ContextBag.empty().set(runDetailInputContext, {
        document: document(state),
      }),
    });
    await Promise.resolve();
    expect(screen.commandForInput?.('e')).toBeUndefined();
  });

  it('the edit screen submits the cancellation payload', async () => {
    const write = { update: vi.fn().mockResolvedValue({}) };
    const screen = new EditRunFormScreen();
    const context = {
      ...contextFor(document('running')),
      contexts: ContextBag.empty().set(runDetailInputContext, {
        document: document('running'),
      }),
      services: { client: write, writeClient: write },
    } as ScreenContext;
    screen.enter(context);
    await Promise.resolve();
    expect(screen.handleInput('enter', context)).toBe(true);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(write.update).toHaveBeenCalledWith('bb_run--bb_run', 'run-1', {
      attributes: { state: 'cancelled' },
    });
    expect(context.back).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'run-cancelled', runId: 'run-1' }),
    );
  });

  it('Esc closes without writing', async () => {
    const write = { update: vi.fn() };
    const screen = new EditRunFormScreen();
    const context = {
      ...contextFor(document('running')),
      contexts: ContextBag.empty().set(runDetailInputContext, {
        document: document('running'),
      }),
      services: { client: write, writeClient: write },
    } as ScreenContext;
    screen.enter(context);
    await Promise.resolve();

    expect(screen.handleInput('escape', context)).toBe(true);
    expect(write.update).not.toHaveBeenCalled();
    expect(screen.takeAction()).toEqual({ type: 'back' });
  });

  it('keeps the popup open and shows a rejected write', async () => {
    const write = { update: vi.fn().mockRejectedValue(new Error('forbidden')) };
    const screen = new EditRunFormScreen();
    const context = {
      ...contextFor(document('running')),
      contexts: ContextBag.empty().set(runDetailInputContext, {
        document: document('running'),
      }),
      services: { client: write, writeClient: write },
    } as ScreenContext;
    screen.enter(context);
    await Promise.resolve();

    expect(screen.handleInput('enter', context)).toBe(true);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.takeAction()).toBeUndefined();
    expect(renderTree(screen.present(context).body)).toContain('forbidden');
  });

  it('repaints the detail after cancellation', async () => {
    const screen = new RunDetailScreen();
    const context = contextFor(document('running'));
    screen.enter({
      ...context,
      contexts: ContextBag.empty().set(runDetailInputContext, {
        document: document('running'),
      }),
    });
    await Promise.resolve();

    screen.receiveResult(
      { type: 'run-cancelled', document: document('cancelled') },
      context,
    );
    expect(screen.commandForInput?.('e')).toBeUndefined();
    expect(context.requestDraw).toHaveBeenCalled();
  });

  it('forwards a received cancellation on Esc, for the Runs tab above it', async () => {
    const screen = new RunDetailScreen();
    const context = contextFor(document('running'));
    screen.enter({
      ...context,
      contexts: ContextBag.empty().set(runDetailInputContext, {
        document: document('running'),
      }),
    });
    await Promise.resolve();

    const result = { type: 'run-cancelled', document: document('cancelled') };
    screen.receiveResult(result, context);

    expect(screen.handleInput('escape', context)).toBe(true);
    expect(screen.takeAction()).toEqual({ type: 'back', result });
    // A second Esc, with nothing new received, carries no result.
    expect(screen.handleInput('escape', context)).toBe(false);
  });
});
