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

/** The buttons as one line, in order (the tree renders one line per cell). */
const buttonRow = (screen: ConfirmDialogScreen, context: ScreenContext) =>
  renderTree(screen.present(context).body)
    .filter((row) => /\[ (Confirm|Close) \]/.test(row))
    .join('  ');

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
      '←→ button',
      'Enter press',
      'Esc close',
    ]);
  });

  it('shows Confirm and Close buttons, Confirm focused', async () => {
    const { screen, context } = await opened(
      requestOf({ message: 'Sure?', confirm: vi.fn() }),
    );
    expect(buttonRow(screen, context)).toBe('▸[ Confirm ]   [ Close ]');
  });

  it('→ and Tab move the focus, ← and Shift-Tab move it back', async () => {
    const { screen, context } = await opened(
      requestOf({ message: 'Sure?', confirm: vi.fn() }),
    );
    expect(screen.handleInput('right', context)).toBe(true);
    expect(buttonRow(screen, context)).toBe(' [ Confirm ]  ▸[ Close ]');
    screen.handleInput('left', context);
    expect(buttonRow(screen, context)).toContain('▸[ Confirm ]');
    screen.handleInput('tab', context);
    expect(buttonRow(screen, context)).toContain('▸[ Close ]');
    screen.handleInput('shift+tab', context);
    expect(buttonRow(screen, context)).toContain('▸[ Confirm ]');
  });

  it('Enter on Close goes back without a result and confirms nothing', async () => {
    const confirm = vi.fn();
    const { screen, context } = await opened(
      requestOf({ message: 'Sure?', confirm }),
    );
    screen.handleInput('right', context);
    expect(screen.handleInput('enter', context)).toBe(true);
    expect(screen.takeAction()).toEqual({ type: 'back' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Space presses the focused button too', async () => {
    const confirm = vi.fn().mockResolvedValue('ok');
    const { screen, context } = await opened(
      requestOf({ message: 'Sure?', confirm }),
    );
    screen.handleInput(' ', context);
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
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

  it('Esc while the write is pending does not leave; the result still goes back once', async () => {
    let finish: (value: unknown) => void = () => {};
    const confirm = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    const { screen, context } = await opened(
      requestOf({ message: 'Sure?', confirm }),
    );
    screen.handleInput('enter', context);
    expect(screen.handleInput('escape', context)).toBe(true);
    expect(screen.takeAction()).toBeUndefined();
    finish({ type: 'done' });
    await settle();
    expect(context.back).toHaveBeenCalledTimes(1);
    expect(context.back).toHaveBeenCalledWith({ type: 'done' });
  });

  it('a write that settles after the dialog was left goes back nowhere', async () => {
    let finish: (value: unknown) => void = () => {};
    const confirm = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    const request = requestOf({ message: 'Sure?', confirm });
    const screen = new ConfirmDialogScreen();
    let active = true;
    const context = { ...contextWith(request), isActive: () => active };
    screen.enter(context);
    await settle();
    screen.handleInput('enter', context);
    active = false;
    finish({ type: 'done' });
    await settle();
    expect(context.back).not.toHaveBeenCalled();
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

  it('wraps a long server message instead of clipping it', async () => {
    const detail =
      'state: The transition from working to cancelled is not allowed for this ticket right now.';
    const confirm = vi.fn().mockRejectedValue(new Error(detail));
    const { screen, context } = await opened(
      requestOf({ message: 'Sure?', confirm }),
    );
    screen.handleInput('enter', context);
    await settle();
    const rows = renderTree(screen.present(context).body);
    expect(rows.every((row) => row.trimEnd().length <= 58)).toBe(true);
    expect(rows.map((row) => row.trim()).join(' ')).toContain(detail);
  });

  it('a prompt without confirm offers only Close', async () => {
    const { screen, context } = await opened(
      requestOf({ message: 'Nothing to do.' }),
    );
    expect(buttonRow(screen, context)).toBe('▸[ Close ]');
    expect(screen.handleInput('right', context)).toBe(true);
    expect(buttonRow(screen, context)).toBe('▸[ Close ]');
    expect(screen.handleInput('enter', context)).toBe(true);
    expect(screen.takeAction()).toEqual({ type: 'back' });
    expect(context.back).not.toHaveBeenCalled();
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
