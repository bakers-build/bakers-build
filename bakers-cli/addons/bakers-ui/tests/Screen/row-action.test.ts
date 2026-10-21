import { describe, expect, it, vi } from 'vitest';
import { runRowAction } from '../../src/Screen/row-action.js';
import type { ScreenContext } from '../../src/Screen/screen.js';

function context(): ScreenContext {
  return {
    sessionGeneration: 1,
    requestDraw: vi.fn(),
    isActive: () => true,
  };
}

describe('runRowAction', () => {
  it('refuses a second activation while in flight', async () => {
    const busy = new Set<string>();
    let started = 0;
    let release!: (value: { message: string }) => void;
    const perform = () => {
      started += 1;
      return new Promise<{ message: string }>((resolve) => {
        release = resolve;
      });
    };
    const options = {
      rowId: 'row-1',
      busy,
      context: context(),
      perform,
      refresh: vi.fn(),
      setStatus: vi.fn(),
      captureLifecycle: () => 'g1',
      lifecycleIsCurrent: () => true,
      failPrefix: 'act failed',
    };
    expect(runRowAction(options)).toBe(true);
    expect(runRowAction(options)).toBe(true);
    expect(started).toBe(1);
    expect(busy.has('row-1')).toBe(true);
    release({ message: 'done' });
    await Promise.resolve();
    expect(busy.has('row-1')).toBe(false);
  });

  it('sets busy, draws, then clears busy after settle', async () => {
    const busy = new Set<string>();
    const ctx = context();
    const order: string[] = [];
    let release!: (value: { message: string }) => void;
    runRowAction({
      rowId: 'row-1',
      busy,
      context: ctx,
      perform: () => {
        order.push(`busy:${busy.has('row-1')}`);
        return new Promise<{ message: string }>((resolve) => {
          release = resolve;
        });
      },
      refresh: vi.fn(),
      setStatus: vi.fn(),
      captureLifecycle: () => 'g1',
      lifecycleIsCurrent: () => true,
      failPrefix: 'act failed',
    });
    expect(busy.has('row-1')).toBe(true);
    expect(ctx.requestDraw).toHaveBeenCalledTimes(1);
    release({ message: 'ok' });
    await Promise.resolve();
    expect(order).toEqual(['busy:true']);
    expect(busy.has('row-1')).toBe(false);
  });

  it('refreshes first, then writes perform.message', async () => {
    const order: string[] = [];
    const ctx = context();
    runRowAction({
      rowId: 'row-1',
      busy: new Set(),
      context: ctx,
      perform: async () => ({ message: 'tunnel started' }),
      refresh: () => {
        order.push('refresh');
      },
      setStatus: (status) => {
        order.push(`status:${status}`);
      },
      captureLifecycle: () => 'g1',
      lifecycleIsCurrent: () => true,
      failPrefix: 'act failed',
    });
    await Promise.resolve();
    expect(order).toEqual(['refresh', 'status:tunnel started']);
  });

  it('waits for an async refresh before writing the notice', async () => {
    const order: string[] = [];
    let release!: () => void;
    runRowAction({
      rowId: 'row-1',
      busy: new Set(),
      context: context(),
      perform: async () => ({ message: 'tunnel started' }),
      refresh: () =>
        new Promise<void>((resolve) => {
          order.push('refresh-start');
          release = () => {
            order.push('refresh-end');
            resolve();
          };
        }),
      setStatus: (status) => {
        order.push(`status:${status}`);
      },
      captureLifecycle: () => 'g1',
      lifecycleIsCurrent: () => true,
      failPrefix: 'act failed',
    });
    await Promise.resolve();
    expect(order).toEqual(['refresh-start']);
    release();
    await Promise.resolve();
    expect(order).toEqual([
      'refresh-start',
      'refresh-end',
      'status:tunnel started',
    ]);
  });

  it('writes failPrefix plus the thrown message and still refreshes once', async () => {
    const setStatus = vi.fn();
    const refresh = vi.fn();
    runRowAction({
      rowId: 'row-1',
      busy: new Set(),
      context: context(),
      perform: async () => {
        throw new Error('boom');
      },
      refresh,
      setStatus,
      captureLifecycle: () => 'g1',
      lifecycleIsCurrent: () => true,
      failPrefix: 'start failed',
    });
    await Promise.resolve();
    expect(setStatus).toHaveBeenCalledWith('start failed: boom');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('writes nothing and does not refresh when the lifecycle has moved on, but still clears busy', async () => {
    const busy = new Set<string>();
    const setStatus = vi.fn();
    const refresh = vi.fn();
    let current = true;
    let release!: (value: { message: string }) => void;
    runRowAction({
      rowId: 'row-1',
      busy,
      context: context(),
      perform: () =>
        new Promise<{ message: string }>((resolve) => {
          release = resolve;
        }),
      refresh,
      setStatus,
      captureLifecycle: () => 'g1',
      lifecycleIsCurrent: () => current,
      failPrefix: 'act failed',
    });
    expect(busy.has('row-1')).toBe(true);
    current = false;
    release({ message: 'late' });
    await Promise.resolve();
    expect(setStatus).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(busy.has('row-1')).toBe(false);
  });

  it('writes status via statusIsCurrent after a generation-bumping refresh', async () => {
    const setStatus = vi.fn();
    let generationCurrent = true;
    runRowAction({
      rowId: 'row-1',
      busy: new Set(),
      context: context(),
      perform: async () => ({ message: 'started' }),
      refresh: () => {
        generationCurrent = false;
      },
      setStatus,
      captureLifecycle: () => 'g1',
      lifecycleIsCurrent: () => generationCurrent,
      statusIsCurrent: () => true,
      failPrefix: 'act failed',
    });
    await Promise.resolve();
    expect(setStatus).toHaveBeenCalledWith('started');
  });

  it('does not write status when statusIsCurrent is already false after refresh', async () => {
    const setStatus = vi.fn();
    runRowAction({
      rowId: 'row-1',
      busy: new Set(),
      context: context(),
      perform: async () => ({ message: 'started' }),
      refresh: vi.fn(),
      setStatus,
      captureLifecycle: () => 'g1',
      lifecycleIsCurrent: () => true,
      statusIsCurrent: () => false,
      failPrefix: 'act failed',
    });
    await Promise.resolve();
    expect(setStatus).not.toHaveBeenCalled();
  });
});
