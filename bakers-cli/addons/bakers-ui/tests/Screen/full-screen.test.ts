import type { VNode } from '@opentui/core';
import { describe, expect, it } from 'vitest';
import { actionItem } from '../../src/Component/footer-actions/index.js';
import { textNode } from '../../src/lib/vnode.js';
import {
  AsyncScreen,
  type FullScreenChrome,
} from '../../src/Screen/async-screen.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import { childrenOf, nodeById, renderTree } from '../render-tree.js';

class ProbeScreen extends AsyncScreen<string> {
  readonly id = 'probe';
  readonly frameId = 'probe';
  private withBadges = false;

  enableBadges(): void {
    this.withBadges = true;
  }

  protected load(): Promise<string> {
    return Promise.resolve('ok');
  }

  protected renderLoading(): string[] {
    return ['loading'];
  }

  protected renderReady(): VNode {
    return textNode({ id: 'probe-table', content: 'rows' });
  }

  protected badges() {
    return this.withBadges
      ? [{ id: 'closed', label: 'x closed', value: 'closed: only' }]
      : [];
  }

  protected chrome(_context: ScreenContext): FullScreenChrome {
    return { title: 'probe' };
  }

  protected actions() {
    return [actionItem('probe-tab', 'Tab', 'tabs')];
  }
}

const ctx = {
  sessionGeneration: 1,
  requestDraw: () => {},
  isActive: () => true,
} as ScreenContext;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AsyncScreen — always-async chrome (BB-375)', () => {
  it('mounts surface without a badge strip when badges are empty', async () => {
    const screen = new ProbeScreen();
    screen.enter(ctx);
    await tick();
    const shown = screen.present(ctx);
    const body = nodeById(shown.body, 'probe-body');
    expect(body).toBeDefined();
    expect(nodeById(shown.body, 'probe-filter')).toBeUndefined();
    expect(nodeById(shown.body, 'probe-frame')).toBeUndefined();
    expect(
      childrenOf(body!).map((c) => (c.props as { id?: string }).id),
    ).toEqual(['probe-table']);
    expect(shown.actions?.[0]?.key).toBe('Tab');
  });

  it('puts the filter strip above the surface when badges are set', async () => {
    const screen = new ProbeScreen();
    screen.enableBadges();
    screen.enter(ctx);
    await tick();
    const shown = screen.present(ctx);
    const body = nodeById(shown.body, 'probe-body');
    expect(
      childrenOf(body!).map((c) => (c.props as { id?: string }).id),
    ).toEqual(['probe-filter', 'probe-table']);
    expect(nodeById(shown.body, 'probe-paging')).toBeUndefined();
    expect(renderTree(shown.body).join('')).toContain('closed: only');
    expect(
      renderTree(nodeById(shown.body, 'probe-filter-closed-chip')!).join(''),
    ).toBe('x closed: only');
  });
});
