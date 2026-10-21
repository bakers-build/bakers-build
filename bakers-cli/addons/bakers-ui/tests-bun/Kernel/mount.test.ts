import { afterEach, describe, expect, it } from 'bun:test';
import {
  BoxRenderable,
  h,
  type Renderable,
  TextRenderable,
} from '@opentui/core';
import { mountTree, patchTree, unmountTree } from '../../src/Kernel/mount.js';
import { type BareHarness, createHarness } from '../tui-harness.js';

/**
 * Every renderable in this file is built against a renderer of its own, so each
 * case starts from an empty root. They are torn down rather than left to the
 * process: a renderer registers a listener on the shared terminal console cache
 * and nine leaked ones is what it takes to trip Node's max-listeners warning —
 * a suite that prints a warning has stopped being a clean signal.
 */
const live: BareHarness[] = [];

const newHarness = async (): Promise<BareHarness> => {
  const harness = await createHarness();
  live.push(harness);
  return harness;
};

afterEach(() => {
  for (const harness of live.splice(0)) harness.renderer.destroy();
});

/** Rows with a declared height — the shape the row pool has always had. */
const tree = (rows: readonly string[]) =>
  h(
    BoxRenderable,
    { id: 'body', flexDirection: 'column' },
    ...rows.map((text, index) =>
      h(TextRenderable, { id: `row-${index}`, content: text, height: 1 }),
    ),
  );

/** The same, with the height left to the content — see the un-park case. */
const autoTree = (rows: readonly string[]) =>
  h(
    BoxRenderable,
    { id: 'body', flexDirection: 'column' },
    ...rows.map((text, index) =>
      h(TextRenderable, { id: `row-${index}`, content: text }),
    ),
  );

/**
 * A node's text.
 *
 * `TextRenderable.content` is a `StyledText`, not a string — it is a list of
 * chunks carrying their own colours and links — so `toContain` cannot be asked
 * of it directly.
 */
const textOf = (node: Renderable | undefined): string =>
  ((node as TextRenderable | undefined)?.content.chunks ?? [])
    .map((chunk) => chunk.text)
    .join('');

/**
 * The height a node DECLARES, straight off its Yoga node.
 *
 * `Renderable.height` is the LAID-OUT height (`_heightValue`), which
 * `updateFromLayout` floors at `Math.max(layout.height, 1)` — so it is never 0
 * and cannot answer "was this node parked". The declared value can.
 */
const declaredHeight = (node: Renderable | undefined): number | null =>
  node === undefined ? null : node.getLayoutNode().getHeight().value;

describe('mountTree / patchTree', () => {
  it('patches content without constructing a new renderable', async () => {
    const { renderer, root } = await newHarness();
    const mounted = mountTree(renderer, root, tree(['a', 'b']));
    const before = mounted.byId.get('row-0');
    const after = patchTree(renderer, mounted, tree(['A', 'b']));
    expect(after.byId.get('row-0')).toBe(before);
    expect(textOf(after.byId.get('row-0'))).toContain('A');
  });

  it('grows when the next tree has more children', async () => {
    const { renderer, root } = await newHarness();
    const mounted = mountTree(renderer, root, tree(['a']));
    const after = patchTree(renderer, mounted, tree(['a', 'b', 'c']));
    expect(after.byId.size).toBe(4); // body + three rows
    expect(textOf(after.byId.get('row-2'))).toContain('c');
  });

  it('parks the surplus with height 0, not visible alone', async () => {
    const { renderer, root } = await newHarness();
    const mounted = mountTree(renderer, root, tree(['a', 'b', 'c']));
    const surplus = mounted.byId.get('row-2');
    patchTree(renderer, mounted, tree(['a']));
    expect(surplus?.visible).toBe(false);
    expect(declaredHeight(surplus)).toBe(0);
  });

  it('brings a parked node back into the layout', async () => {
    const harness = await newHarness();
    const { renderer, root } = harness;
    // Rows that declare no height: parking writes a 0 into the Yoga node, and
    // nothing in the next tree's props would ever write it back.
    const mounted = mountTree(renderer, root, autoTree(['a', 'b', 'c']));
    await harness.renderOnce();
    expect(mounted.root.height).toBe(3);

    const shrunk = patchTree(renderer, mounted, autoTree(['a']));
    await harness.renderOnce();
    expect(shrunk.root.height).toBe(1);

    const grown = patchTree(renderer, shrunk, autoTree(['a', 'b', 'c']));
    await harness.renderOnce();
    expect(grown.byId.get('row-2')?.visible).toBe(true);
    expect(grown.root.height).toBe(3);
  });

  it('follows the id, not the position, when rows reorder', async () => {
    const { renderer, root } = await newHarness();
    const keyed = (ids: readonly string[]) =>
      h(
        BoxRenderable,
        { id: 'body', flexDirection: 'column' },
        ...ids.map((id) =>
          h(TextRenderable, {
            id: `row-${id}`,
            content: `ticket ${id}`,
            height: 1,
          }),
        ),
      );
    const mounted = mountTree(renderer, root, keyed(['x', 'y']));
    const nodeX = mounted.byId.get('row-x');
    const after = patchTree(renderer, mounted, keyed(['y', 'x']));
    expect(after.byId.get('row-x')).toBe(nodeX);
    expect(textOf(after.byId.get('row-x'))).toContain('ticket x');
  });

  /**
   * BB-340 Task 7 — and the case the one above cannot make.
   *
   * Identity is only half of a reorder: a list that re-sorts must also be
   * PAINTED in the new order. Yoga stacks a column in child order, and
   * `Renderable.add` appends, so a walk that only writes props leaves the rows
   * standing where they were first added — correct content in a stale order,
   * with no error and nothing on screen to say so. The run detail could not
   * reorder, which is why Task 6 never met this; a ticket list re-sorts on every
   * search, every page and every reload.
   */
  it('paints a reordered list in the NEW order, not the order it grew in', async () => {
    const { renderer, root } = await newHarness();
    const keyed = (ids: readonly string[]) =>
      h(
        BoxRenderable,
        { id: 'body', flexDirection: 'column' },
        ...ids.map((id) =>
          h(TextRenderable, {
            id: `row-${id}`,
            content: `ticket ${id}`,
            height: 1,
          }),
        ),
      );
    const mounted = mountTree(renderer, root, keyed(['x', 'y', 'z']));
    const after = patchTree(renderer, mounted, keyed(['z', 'x', 'y']));
    expect(
      (after.root.getChildren() as Renderable[]).map((child) => child.id),
    ).toEqual(['row-z', 'row-x', 'row-y']);
  });

  it('replaces a node whose type changed at the same id', async () => {
    const { renderer, root } = await newHarness();
    const mounted = mountTree(
      renderer,
      root,
      h(
        BoxRenderable,
        { id: 'body' },
        h(TextRenderable, { id: 'slot', content: 'text' }),
      ),
    );
    const before = mounted.byId.get('slot');
    const after = patchTree(
      renderer,
      mounted,
      h(BoxRenderable, { id: 'body' }, h(BoxRenderable, { id: 'slot' })),
    );
    expect(after.byId.get('slot')).not.toBe(before);
  });

  it('constructs nothing on a pure content patch', async () => {
    const { renderer, root } = await newHarness();
    const mounted = mountTree(renderer, root, tree(['a', 'b', 'c']));
    const ids = [...mounted.byId.values()];
    const after = patchTree(renderer, mounted, tree(['x', 'y', 'z']));
    expect([...after.byId.values()]).toEqual(ids);
  });

  it('refuses a tree whose nodes are not each uniquely identified', async () => {
    const { renderer, root } = await newHarness();
    expect(() =>
      mountTree(
        renderer,
        root,
        h(BoxRenderable, { id: 'body' }, h(TextRenderable, { content: 'x' })),
      ),
    ).toThrow(/props\.id/);
    expect(() =>
      mountTree(
        renderer,
        root,
        h(
          BoxRenderable,
          { id: 'body' },
          h(TextRenderable, { id: 'dup', content: 'x' }),
          h(TextRenderable, { id: 'dup', content: 'y' }),
        ),
      ),
    ).toThrow(/declared twice/);
  });

  it('destroys everything on unmount', async () => {
    const { renderer, root } = await newHarness();
    const mounted = mountTree(renderer, root, tree(['a', 'b']));
    unmountTree(root, mounted);
    expect(root.getChildren?.().length ?? 0).toBe(0);
  });
});
