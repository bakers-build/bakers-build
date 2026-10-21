import type { RGBA, VNode } from '@opentui/core';
import { mountTree, patchTree, unmountTree } from '../src/Kernel/mount.js';
import { createHarness } from './tui-harness.js';

export interface PaintedSpan {
  text: string;
  attributes: number;
  fg: RGBA;
}

export interface PaintedTree {
  readonly rows: string[];
  readonly spans: PaintedSpan[][];
  readonly frame: string;
}

/**
 * Paint one component tree on a bare renderer, the way the kernel does: mount
 * it, then PATCH it with a second build and paint that. A component that
 * only survives its first construction fails here, and `build` is called
 * again so a width it reported through a size callback is drawn.
 */
export async function paintTree(
  build: () => VNode,
  columns: number,
  rows = 32,
): Promise<PaintedTree> {
  const setup = await createHarness({ columns, rows });
  let mounted = mountTree(setup.renderer, setup.root, build());
  try {
    await setup.renderOnce();
    mounted = patchTree(setup.renderer, mounted, build());
    await setup.renderOnce();
    const painted = setup.captureCharFrame().split('\n');
    const spans = setup
      .captureSpans()
      .lines.map((line) => line.spans as PaintedSpan[]);
    return { rows: painted, spans, frame: painted.join('\n') };
  } finally {
    unmountTree(setup.root, mounted);
    setup.renderer.destroy();
  }
}
