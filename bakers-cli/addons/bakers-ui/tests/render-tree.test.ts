import { BoxRenderable, h, TextRenderable } from '@opentui/core';
import { describe, expect, it } from 'vitest';
import { idsOf, nodeById, renderTree } from './render-tree.js';

// BB-340 D8 — the Node half of the two text renderers.
//
// `renderTree` answers "is this text in the tree, in this order"; the Bun
// suite's `captureCharFrame()` answers "what does the terminal actually show".
// The two must not be conflated, which is why the cases below assert content
// and order and NEVER a column: a helper that measured columns would be
// `lib/width.ts` under a new name.

describe('renderTree', () => {
  it('returns one entry per text node, in tree order', () => {
    expect(
      renderTree(
        h(
          BoxRenderable,
          { id: 'body' },
          h(TextRenderable, { id: 'a', content: 'first' }),
          h(
            BoxRenderable,
            { id: 'group' },
            h(TextRenderable, { id: 'b', content: 'second' }),
          ),
        ),
      ),
    ).toEqual(['first', 'second']);
  });

  it('reads a StyledText node as its concatenated text', () => {
    const tree = h(
      BoxRenderable,
      { id: 'body' },
      h(TextRenderable, {
        id: 'a',
        content: { chunks: [{ text: 'x' }, { text: 'y' }] },
      }),
    );
    expect(renderTree(tree)).toEqual(['xy']);
  });

  it('ignores a node with no content rather than emitting an empty entry for it', () => {
    expect(
      renderTree(
        h(BoxRenderable, { id: 'body' }, h(BoxRenderable, { id: 'spacer' })),
      ),
    ).toEqual([]);
  });
});

// BB-340 D4/R4 — the id is the identity a patch follows, so a test that means
// "this row is that entity's" has to be able to reach a node BY id rather than
// by counting from the top. Both helpers walk the same tree order `renderTree`
// does, and neither reads a column.

describe('idsOf / nodeById', () => {
  const tree = h(
    BoxRenderable,
    { id: 'body' },
    h(TextRenderable, { id: 'a', content: 'first' }),
    h(
      BoxRenderable,
      { id: 'group' },
      h(TextRenderable, { id: 'b', content: 'second' }),
    ),
  );

  it('lists every declared id, in tree order, so duplicates are visible', () => {
    expect(idsOf(tree)).toEqual(['body', 'a', 'group', 'b']);
  });

  it('finds a node anywhere in the tree by its id, and nothing for an unknown one', () => {
    expect(
      (nodeById(tree, 'b')?.props as { content?: string } | undefined)?.content,
    ).toBe('second');
    expect(nodeById(tree, 'nope')).toBeUndefined();
  });
});
