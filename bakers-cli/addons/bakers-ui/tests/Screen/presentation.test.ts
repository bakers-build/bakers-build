import { BoxRenderable, h, TextRenderable, type VNode } from '@opentui/core';
import { describe, expect, it } from 'vitest';
import { emptyRegionTree } from '../../src/Kernel/chrome.js';
import { presentation } from '../../src/Screen/screen.js';
import { renderTree } from '../render-tree.js';

// BB-340 D1 — the boundary, and since Task 12 the only surface there is.
//
// `ScreenPresentation.body` is the screen's own surface as a renderable tree,
// and nothing else: the `string[]` leg and the `linesToTree` bridge that made
// the two one render path (D5) went with the last screen to convert. A
// `string[]` reaching `presentation()` is a compile error now, which is why no
// case below can state that half any more.
//
// These cases assert content and order, never a column: measuring columns is
// what `lib/width.ts` did and deleting it is half of what this ticket is for.

const rootIdOf = (node: VNode): string | undefined =>
  (node.props as { id?: string } | undefined)?.id;

/** A screen's own body, in the shape the converted screens hand over. */
const bodyTree = (...rows: readonly string[]): VNode =>
  h(
    BoxRenderable,
    { id: 'screen-body' },
    ...rows.map((content, index) =>
      h(TextRenderable, { id: `screen-body-${index}`, content }),
    ),
  );

describe('presentation()', () => {
  it('roots a screen`s own tree under the body window', () => {
    // BB-340 Task 6 — the root id belongs to the KERNEL (`region-body-window`,
    // the slot the kernel already stands an empty tree in), and a component may
    // not import the kernel to learn it (`tests/boundary.test.ts` G5). So the
    // rooting happens HERE, once, for every converted screen: the screen hands
    // over its own subtree and gets the kernel's root put over it. That is what
    // lets `patchTree` reuse the standing box instead of building a second one
    // beside it.
    const tree = h(
      BoxRenderable,
      { id: 'run-detail' },
      h(TextRenderable, { id: 'run-detail-row-0', content: 'from a tree' }),
    );
    const shown = presentation(tree);
    expect(rootIdOf(shown.body)).toBe(rootIdOf(emptyRegionTree('body')));
    expect(shown.body.children?.[0]).toBe(tree);
    expect(renderTree(shown.body)).toEqual(['from a tree']);
  });

  it('gives a POPUP`s tree the same root without the body window`s inset', () => {
    // BB-340 Task 9c — the body window insets a converted body by the two
    // columns `styleVisibleLines` bakes into every bridged row. A popup is not
    // the body window: `modalTree` puts the body inside a box that already
    // spends a border and a column of padding on each side, so the same inset
    // would push a converted popup two columns right of where its own rows sit.
    // The ROOT ID is unchanged — the kernel mounts the same slot either way.
    const tree = h(
      BoxRenderable,
      { id: 'form-fields' },
      h(TextRenderable, { id: 'field-title-row-0', content: '▸ Title:' }),
    );
    const shown = presentation(tree, { modal: true });
    const props = shown.body.props as {
      paddingLeft?: number;
      paddingRight?: number;
    };
    expect(rootIdOf(shown.body)).toBe(rootIdOf(emptyRegionTree('body')));
    expect(props.paddingLeft).toBe(0);
    expect(props.paddingRight).toBe(0);
    // Stated whether or not it is zero: `patchTree` writes only what the next
    // tree declares, so an omitted padding would survive a navigation from a
    // normal screen into a popup and indent the popup by it.
    expect(props).toHaveProperty('paddingLeft');
    // And the non-modal leg is unchanged, which is what makes this a property
    // of the flag rather than of the inset having been dropped everywhere.
    const normal = presentation(tree).body.props as { paddingLeft?: number };
    expect(normal.paddingLeft).toBe(2);
  });

  it('does not publish the modal flag as part of the presentation', () => {
    // It selects a ROOT; `Screen.modal` is what the kernel reads to decide the
    // frame. Two places saying it would be two places to disagree.
    expect(presentation(bodyTree('alpha'), { modal: true })).not.toHaveProperty(
      'modal',
    );
  });

  it('gives a flush framed body the same inset-free root as a popup (BB-375)', () => {
    // Framed list/detail bodies align their FRAME with the chrome header box —
    // same root as `modal`, without publishing `flush` onto the presentation.
    const tree = bodyTree('framed');
    const shown = presentation(tree, { flush: true });
    const props = shown.body.props as {
      paddingLeft?: number;
      paddingRight?: number;
    };
    expect(rootIdOf(shown.body)).toBe('region-body-window');
    expect(props.paddingLeft).toBe(0);
    expect(props.paddingRight).toBe(0);
    expect(shown).not.toHaveProperty('flush');
  });

  it('names the body window region rather than the ScrollBox itself', () => {
    // The region name is NOT `body`: `region-body` is the body ScrollBox
    // itself, and two renderables under one id is what `mount.ts` refuses.
    // Read from `emptyRegionTree`, the tree the kernel actually stands up in
    // that slot, so the contract and the kernel cannot drift apart.
    expect(rootIdOf(presentation(bodyTree('alpha')).body)).toBe(
      rootIdOf(emptyRegionTree('body')),
    );
    expect(rootIdOf(presentation(bodyTree('alpha')).body)).toBe(
      'region-body-window',
    );
  });

  it('carries the selection state a screen declares beside its body', () => {
    const shown = presentation(bodyTree('alpha'), {
      selectable: 3,
      selectedIndex: 2,
    });
    expect(shown.selectable).toBe(3);
    expect(shown.selectedIndex).toBe(2);
  });
});
