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
  drawForTest(context: ScreenContext) {
    this.requestActiveDraw(context);
  }
}

/** The rows this screen shows, read where the kernel reads them (Task 12). */
const shownRows = (screen: Subject, context: ScreenContext): string[] =>
  renderTree(screen.present(context).body);

describe('routed-screen concurrency matrix', () => {
  it.each([
    'A-then-B',
    'B-then-A',
  ])('%s rejects inactive screen settlement', async (order) => {
    const a = Promise.withResolvers<string>();
    const b = Promise.withResolvers<string>();
    const first = new Subject(() => a.promise);
    const second = new Subject(() => b.promise);
    let active = 'A';
    const drawA = vi.fn();
    const drawB = vi.fn();
    first.enter({
      sessionGeneration: 1,
      requestDraw: drawA,
      isActive: () => active === 'A',
    });
    first.leave();
    active = 'B';
    second.enter({
      sessionGeneration: 1,
      requestDraw: drawB,
      isActive: () => active === 'B',
    });
    drawA.mockClear();
    drawB.mockClear();
    for (const target of order === 'A-then-B' ? [a, b] : [b, a])
      target.resolve(target === a ? 'A' : 'B');
    await Promise.all([a.promise, b.promise]);
    await Promise.resolve();
    expect(first.state).toBe('idle');
    expect(second.state).toBe('ready');
    expect(drawA).not.toHaveBeenCalled();
    expect(first.staleRedraws()).toBe(0);
    expect(second.staleRedraws()).toBe(0);
  });

  it.each([
    'read-then-mutation',
    'mutation-then-read',
  ])('%s keeps the newest local revision', async () => {
    const read = Promise.withResolvers<string>();
    const screen = new Subject(() => read.promise);
    const context = {
      sessionGeneration: 1,
      requestDraw: vi.fn(),
      isActive: () => true,
    };
    screen.enter(context);
    screen.mutate('newer');
    read.resolve('older');
    await read.promise;
    await Promise.resolve();
    expect(shownRows(screen, context)).toEqual(['newer']);
    expect(screen.staleRedraws()).toBe(0);
  });

  it('counts an attempted draw through an inactive lifecycle guard', () => {
    const screen = new Subject(async () => 'ready');
    const draw = vi.fn();
    screen.enter({
      sessionGeneration: 1,
      requestDraw: draw,
      isActive: () => false,
    });
    draw.mockClear();

    screen.drawForTest({
      sessionGeneration: 1,
      requestDraw: draw,
      isActive: () => false,
    });

    expect(draw).not.toHaveBeenCalled();
    expect(screen.staleRedraws()).toBe(1);
  });
});
