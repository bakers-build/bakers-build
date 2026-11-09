import { describe, expect, it } from 'bun:test';
import type { VNode } from '@opentui/core';
import { Card } from '../../src/Component/card/index.js';
import { KeyValue } from '../../src/Component/key-value/index.js';
import { Markdown } from '../../src/Component/markdown/index.js';
import { mountTree, patchTree, unmountTree } from '../../src/Kernel/mount.js';
import { BORDER, FOREGROUND_HIGHLIGHT } from '../../src/lib/theme.js';
import { paintTree } from '../paint-tree.js';
import { createHarness } from '../tui-harness.js';

/** The bit value of `@opentui/core@0.5.1`'s underline text attribute. */
const UNDERLINE_BIT = 8;

/**
 * A tree mounted once and then PATCHED with each next build — the kernel's
 * draw cycle — so a prop that stops applying must be cleared by the patch.
 */
const patching = async (columns = 60, rows = 12) => {
  const setup = await createHarness({ columns, rows });
  let mounted: ReturnType<typeof mountTree> | undefined;
  const draw = async (tree: VNode) => {
    mounted =
      mounted === undefined
        ? mountTree(setup.renderer, setup.root, tree)
        : patchTree(setup.renderer, mounted, tree);
    await setup.renderOnce();
  };
  const rowsOf = () => setup.captureCharFrame().split('\n');
  const close = () => {
    if (mounted !== undefined) unmountTree(setup.root, mounted);
    setup.renderer.destroy();
  };
  return { setup, draw, rowsOf, close };
};

describe('shared widgets through mount, patch and paint', () => {
  it('fires a linked value once per click and drops the link when it goes away', async () => {
    const harness = await patching();
    let clicks = 0;
    const tree = (linked: boolean) =>
      KeyValue({
        id: 'kv',
        items: [
          {
            key: 'parent',
            value: 'BB-1',
            underline: linked,
            ...(linked ? { onMouseDown: () => clicks++ } : {}),
          },
        ],
      });
    try {
      await harness.draw(tree(true));
      const row = harness.rowsOf().findIndex((line) => line.includes('BB-1'));
      const column = (harness.rowsOf()[row] ?? '').indexOf('BB-1');
      await harness.setup.mockMouse.click(column, row);
      await harness.setup.mockMouse.click(column, row);
      expect(clicks).toBe(2);
      const underlined = () =>
        harness.setup
          .captureSpans()
          .lines.flatMap((line) => line.spans)
          .find((span) => span.text.includes('BB-1'));
      expect((underlined()?.attributes ?? 0) & UNDERLINE_BIT).toBe(
        UNDERLINE_BIT,
      );

      await harness.draw(tree(false));
      await harness.setup.mockMouse.click(column, row);
      expect(clicks).toBe(2);
      expect((underlined()?.attributes ?? 0) & UNDERLINE_BIT).toBe(0);
    } finally {
      harness.close();
    }
  });

  it('repaints a card border when its selection is taken away', async () => {
    const harness = await patching();
    const tree = (selected: boolean) =>
      Card({
        id: 'card',
        borderColor: selected ? FOREGROUND_HIGHLIGHT : BORDER,
        children: [Markdown({ id: 'card-body', source: 'Body text' })],
      });
    const corner = () =>
      harness.setup
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .find((span) => span.text.includes('╭'));
    try {
      await harness.draw(tree(true));
      expect(corner()?.fg.equals(FOREGROUND_HIGHLIGHT)).toBe(true);
      await harness.draw(tree(false));
      expect(corner()?.fg.equals(BORDER)).toBe(true);
      await harness.draw(tree(true));
      expect(corner()?.fg.equals(FOREGROUND_HIGHLIGHT)).toBe(true);
    } finally {
      harness.close();
    }
  });

  it('wraps wide glyphs inside the width without losing any', async () => {
    const text = '漢字テスト'.repeat(6);
    const painted = await paintTree(
      () => Markdown({ id: 'wide', source: text, width: 20 }),
      40,
      10,
    );
    const occupied = painted.rows.filter((row) => row.trim() !== '');
    expect(occupied.length).toBeGreaterThan(1);
    expect(painted.frame.replace(/\s/g, '')).toBe(text);
  });
});
