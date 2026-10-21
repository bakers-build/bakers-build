import { describe, expect, it, vi } from 'vitest';
import { messageTree } from '../../src/lib/vnode.js';
import { AsyncScreen } from '../../src/Screen/async-screen.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import { renderTree } from '../render-tree.js';

class Subject extends AsyncScreen<string> {
  readonly id = 'subject';
  constructor(private readonly operation: () => Promise<string>) {
    super();
  }
  protected load() {
    return this.operation();
  }
  protected renderLoading() {
    return ['loading'];
  }
  protected renderReady(value: string) {
    return messageTree(this.id, [value]);
  }
  protected chrome() {
    return { title: 'subject' };
  }
  mutate(value: string) {
    this.replaceReady(value);
  }
}

/**
 * The rows this screen is showing.
 *
 * BB-340 Task 12 — it was `shownRows(screen, context)`, an optional member of the
 * `Screen` interface returning `string[]`. The row surface is off the contract,
 * so what a screen shows is read where the kernel reads it: off `present()`,
 * through the tree.
 */
const shownRows = (screen: Subject, context: ScreenContext): string[] =>
  renderTree(screen.present(context).body);

describe('AsyncScreen', () => {
  it('draws loading before calling load and caches ready data', async () => {
    const order: string[] = [];
    const load = vi.fn(async () => {
      order.push('load');
      return 'ready';
    });
    const screen = new Subject(load);
    const context = {
      sessionGeneration: 1,
      requestDraw: () => order.push('draw'),
      isActive: () => true,
    };
    screen.enter(context);
    expect(order.slice(0, 2)).toEqual(['draw', 'load']);
    await vi.waitFor(() =>
      expect(shownRows(screen, context)).toEqual(['ready']),
    );
    screen.enter(context);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('retry on a ready screen keeps the body and states busy until the re-read lands', async () => {
    let release!: (value: string) => void;
    let loads = 0;
    const screen = new Subject(
      () =>
        new Promise((resolve) => {
          loads += 1;
          if (loads === 1) resolve('ready');
          else release = resolve;
        }),
    );
    const context = {
      sessionGeneration: 1,
      requestDraw: vi.fn(),
      isActive: () => true,
    };
    screen.enter(context);
    await vi.waitFor(() =>
      expect(shownRows(screen, context)).toEqual(['ready']),
    );
    expect(screen.busy).toBe(false);

    screen.retry(context);
    expect(screen.busy).toBe(true);
    expect(shownRows(screen, context)).toEqual(['ready']);

    release('next');
    await vi.waitFor(() =>
      expect(shownRows(screen, context)).toEqual(['next']),
    );
    expect(screen.busy).toBe(false);
  });

  it('a failed re-read of a ready screen keeps the body and toasts the error', async () => {
    let loads = 0;
    const screen = new Subject(async () => {
      loads += 1;
      if (loads === 1) return 'ready';
      throw new Error('list failed');
    });
    const context = {
      sessionGeneration: 1,
      requestDraw: vi.fn(),
      isActive: () => true,
    };
    screen.enter(context);
    await vi.waitFor(() =>
      expect(shownRows(screen, context)).toEqual(['ready']),
    );

    screen.retry(context);
    await vi.waitFor(() =>
      expect(screen.present(context).toast).toBe('list failed'),
    );
    expect(shownRows(screen, context)).toEqual(['ready']);
    expect(screen.state).toBe('ready');
    expect(screen.busy).toBe(false);
  });

  it('ignores settlement after reset and retries errors', async () => {
    let release!: (value: string) => void;
    const screen = new Subject(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const context = {
      sessionGeneration: 1,
      requestDraw: vi.fn(),
      isActive: () => true,
    };
    screen.enter(context);
    screen.reset();
    release('stale');
    await Promise.resolve();
    expect(screen.state).toBe('idle');
  });

  it('invalidates cached data when route parameters change', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('ticket A')
      .mockResolvedValueOnce('ticket B');
    const screen = new Subject(load);
    const base = {
      sessionGeneration: 1,
      requestDraw: vi.fn(),
      isActive: () => true,
    };
    const a = { ...base, params: { ticketId: 'a' } };
    const b = { ...base, params: { ticketId: 'b' } };

    screen.enter(a);
    await vi.waitFor(() => expect(shownRows(screen, a)).toEqual(['ticket A']));
    screen.enter(b);
    expect(shownRows(screen, b)).toEqual(['loading']);
    await vi.waitFor(() => expect(shownRows(screen, b)).toEqual(['ticket B']));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('turns a synchronous loader failure into screen-local error state', async () => {
    const screen = new Subject(() => {
      throw new Error('no context');
    });
    const context = {
      sessionGeneration: 1,
      requestDraw: vi.fn(),
      isActive: () => true,
    };

    expect(() => screen.enter(context)).not.toThrow();
    await vi.waitFor(() => expect(screen.state).toBe('error'));
    expect(shownRows(screen, context)[0]).toBe('no context');
  });

  it('rejects an older read after a local mutation', async () => {
    const pending = Promise.withResolvers<string>();
    const screen = new Subject(() => pending.promise);
    const requestDraw = vi.fn();
    const context = {
      sessionGeneration: 1,
      requestDraw,
      isActive: () => true,
    };

    screen.enter(context);
    screen.mutate('newer');
    requestDraw.mockClear();
    pending.resolve('older');
    await pending.promise;
    await Promise.resolve();

    expect(shownRows(screen, context)).toEqual(['newer']);
    expect(requestDraw).not.toHaveBeenCalled();
  });

  it('rejects settlement after leaving the activation', async () => {
    const pending = Promise.withResolvers<string>();
    const screen = new Subject(() => pending.promise);
    const requestDraw = vi.fn();
    const context = {
      sessionGeneration: 1,
      requestDraw,
      isActive: () => false,
    };
    screen.enter(context);
    screen.leave();
    pending.resolve('stale');
    await pending.promise;
    await Promise.resolve();

    expect(screen.state).toBe('idle');
    expect(requestDraw).toHaveBeenCalledTimes(1);
  });
});
