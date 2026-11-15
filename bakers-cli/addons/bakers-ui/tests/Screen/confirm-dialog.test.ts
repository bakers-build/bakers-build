import { describe, expect, it, vi } from 'vitest';
import { ContextBag } from '../../src/Routing/context.js';
import {
  ConfirmDialogScreen,
  type ConfirmPrompt,
  type ConfirmRequest,
  confirmNavigation,
  confirmRequestContext,
} from '../../src/Screen/confirm-dialog.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import { renderTree } from '../render-tree.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const requestOf = (prompt: ConfirmPrompt): ConfirmRequest => ({
  title: '✕ Do it',
  prepare: () => Promise.resolve(prompt),
});

const contextWith = (request: ConfirmRequest): ScreenContext => ({
  sessionGeneration: 1,
  requestDraw: vi.fn(),
  isActive: () => true,
  params: {},
  contexts: ContextBag.empty().set(confirmRequestContext, request),
  back: vi.fn(() => true),
});

const opened = async (request: ConfirmRequest) => {
  const screen = new ConfirmDialogScreen();
  const context = contextWith(request);
  screen.enter(context);
  await settle();
  return { screen, context };
};

describe('confirmation dialog', () => {
  it('is a modal route the actions navigate to with their request', () => {
    expect(ConfirmDialogScreen.route.presentation).toBe('modal');
    const request = requestOf({ message: 'Sure?' });
    expect(confirmNavigation(request)).toEqual({
      type: 'navigate',
      routeId: ConfirmDialogScreen.route.id,
      params: {},
      result: request,
    });
  });

  it('shows the title, message and detail with Enter and Esc in the footer', async () => {
    const { screen, context } = await opened(
      requestOf({
        message: 'Sure?',
        detail: 'It is final.',
        confirm: () => Promise.resolve(undefined),
      }),
    );
    const shown = screen.present(context);
    expect(shown.title).toBe('✕ Do it');
    const text = renderTree(shown.body);
    expect(text).toContain('Sure?');
    expect(text).toContain('It is final.');
    expect(shown.actions?.map((a) => `${a.key} ${a.label}`)).toEqual([
      'Enter confirm',
      'Esc close',
    ]);
  });

  it('Enter confirms once and goes back with its result', async () => {
    const confirm = vi.fn().mockResolvedValue({ type: 'done' });
    const { screen, context } = await opened(
      requestOf({ message: 'Sure?', confirm }),
    );
    expect(screen.handleInput('enter', context)).toBe(true);
    expect(screen.handleInput('enter', context)).toBe(true);
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(context.back).toHaveBeenCalledWith({ type: 'done' });
  });

  it('Esc goes back without a result and confirms nothing', async () => {
    const confirm = vi.fn();
    const { screen, context } = await opened(
      requestOf({ message: 'Sure?', confirm }),
    );
    expect(screen.handleInput('escape', context)).toBe(true);
    expect(screen.takeAction()).toEqual({ type: 'back' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('a rejected confirm shows the message and stays open', async () => {
    const confirm = vi.fn().mockRejectedValue(new Error('forbidden'));
    const { screen, context } = await opened(
      requestOf({ message: 'Sure?', confirm }),
    );
    screen.handleInput('enter', context);
    await settle();
    expect(context.back).not.toHaveBeenCalled();
    expect(screen.takeAction()).toBeUndefined();
    expect(renderTree(screen.present(context).body)).toContain('forbidden');
  });

  it('a prompt without confirm makes Enter write nothing', async () => {
    const { screen, context } = await opened(
      requestOf({ message: 'Nothing to do.' }),
    );
    expect(screen.handleInput('enter', context)).toBe(false);
    await settle();
    expect(context.back).not.toHaveBeenCalled();
    expect(
      screen.present(context).actions?.map((a) => `${a.key} ${a.label}`),
    ).toEqual(['Esc close']);
  });

  it('a second open runs the new request, not the first one', async () => {
    const screen = new ConfirmDialogScreen();
    const first = contextWith(requestOf({ message: 'First?' }));
    screen.enter(first);
    await settle();
    screen.leave();
    const second = contextWith(requestOf({ message: 'Second?' }));
    screen.enter(second);
    await settle();
    expect(renderTree(screen.present(second).body)).toContain('Second?');
  });
});
