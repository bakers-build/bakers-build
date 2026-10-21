import { describe, expect, it, vi } from 'vitest';
import { Router } from '../../src/Routing/router.js';

const screen = (id: string) => ({
  id,
  enter: vi.fn(),
  leave: vi.fn(),
  render: vi.fn(() => []),
  handleInput: vi.fn(() => false),
  reset: vi.fn(),
  saveState: vi.fn(() => ({ selectedId: 't1' })),
  restoreState: vi.fn(),
});

describe('Router', () => {
  it('uses one synchronous navigation and history path', () => {
    const a = screen('a');
    const b = screen('b');
    const router = new Router(
      new Map([
        ['a', a],
        ['b', b],
      ]),
      vi.fn(),
      1,
    );
    router.navigate('a');
    router.navigate('b');
    expect(a.leave).toHaveBeenCalledOnce();
    expect(router.active?.id).toBe('b');
    router.back();
    expect(router.active?.id).toBe('a');
    expect(router.historyForTest()).toEqual([]);
  });

  it('stores destination-owned restore tokens in its sole history', () => {
    const list = screen('list');
    const detail = screen('detail');
    const router = new Router(
      new Map([
        ['list', list],
        ['detail', detail],
      ]),
      vi.fn(),
      1,
    );
    router.navigate('list');
    router.navigate('detail', { id: 't1' });
    expect(router.historyForTest()).toEqual([
      { routeId: 'list', params: {}, restore: { selectedId: 't1' } },
    ]);
    router.back();
    expect(list.restoreState).toHaveBeenCalledWith({ selectedId: 't1' });
  });

  it('injects the same navigate path into screen actions', () => {
    const a = screen('a');
    const b = screen('b');
    const router = new Router(
      new Map([
        ['a', a],
        ['b', b],
      ]),
      vi.fn(),
      1,
    );
    router.navigate('a');
    const context = a.enter.mock.calls[0]?.[0];
    context.navigate('b', { source: 'action' });
    expect(router.active).toBe(b);
    expect(b.enter).toHaveBeenCalledWith(
      expect.objectContaining({ params: { source: 'action' } }),
    );
  });

  it('makes a prior parameterized entry inactive after navigating to the same screen', () => {
    const a = screen('a');
    const router = new Router(new Map([['a', a]]), vi.fn(), 1);
    router.navigate('a', { id: 'first' });
    const first = a.enter.mock.calls[0]?.[0];
    router.navigate('a', { id: 'second' });
    const second = a.enter.mock.calls[1]?.[0];
    expect(first.isActive()).toBe(false);
    expect(second.isActive()).toBe(true);
  });
});
