import type { VNode } from '@opentui/core';
import { columnNode } from '../lib/vnode.js';
import { AsyncScreen } from './async-screen.js';
import type { ScreenContext } from './screen.js';

/** An intentional entity landing place: normal chrome and tabs, no body I/O. */
export abstract class EmptyOverviewScreen extends AsyncScreen<void> {
  protected load(_context: ScreenContext): Promise<void> {
    return Promise.resolve();
  }

  protected renderLoading(): string[] {
    return [];
  }

  protected renderReady(): VNode {
    return columnNode(this.frameId ?? this.id);
  }
}
