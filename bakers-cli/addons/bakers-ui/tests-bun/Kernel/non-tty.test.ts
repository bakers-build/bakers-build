import { describe, expect, it } from 'bun:test';
import { bodyWindowRoot, renderBodyToText } from '../../src/Kernel/mount.js';
import { columnNode, textNode } from '../../src/lib/vnode.js';

/**
 * BB-340 Task 10 — the pipe path, as the tree renders it.
 *
 * The subject is a body EXACTLY as `presentation()` hands it over: rooted
 * through `bodyWindowRoot`, which is what a screen's own tree arrives wrapped
 * in. Testing the inner column alone would pass while the real caller printed
 * every row two columns right of where the pipe has always put it.
 */
const body = (rows: readonly string[]) =>
  bodyWindowRoot(
    columnNode(
      'block',
      ...rows.map((text, index) =>
        textNode({ id: `row-${index}`, content: text }),
      ),
    ),
  );

describe('renderBodyToText', () => {
  it('renders a body tree to the lines a terminal would show', async () => {
    const text = await renderBodyToText(body(['alpha', 'beta']), {
      width: 80,
      height: 24,
    });
    expect(text).toEqual(['alpha', 'beta']);
  });

  it('keeps every row when the body is taller than the terminal', async () => {
    // The pipe prints the whole screen, never a window into it: a run's log is
    // its transcript `split('\n')`, so hundreds of rows is the ordinary case
    // and a capture sized to the terminal would silently drop all but the
    // first 24.
    const rows = Array.from({ length: 100 }, (_, index) => `row ${index}`);
    const text = await renderBodyToText(body(rows), { width: 80, height: 24 });
    expect(text).toEqual(rows);
  });

  it('keeps a blank row rather than collapsing it', async () => {
    // The gap between two sections is a row of the surface. The kernel drops
    // empty rows itself (`.filter(Boolean)`), so this function must hand them
    // over intact and leave that decision where it already is.
    const text = await renderBodyToText(body(['Run', '', 'State']), {
      width: 80,
      height: 24,
    });
    expect(text).toEqual(['Run', '', 'State']);
  });
});
