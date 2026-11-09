import { describe, expect, it } from 'bun:test';
import { BoxRenderable } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { type ChromeInput, frameTrees } from '../../src/Kernel/chrome.js';
import { bodyWindowRoot, mountTree } from '../../src/Kernel/mount.js';
import { columnNode, textNode } from '../../src/lib/vnode.js';
import { presentation } from '../../src/Screen/screen.js';

// BB-340 Task 9b — THE MODAL BORDER IS A REAL BOX.
//
// Until this step the box was composed text: `'│ ' + fitLine(line) + ' │'` per
// row, so a screen that handed over a TREE drew an empty box — not clipped, not
// misplaced, absent. That is why the border had to become structural before any
// form screen converts (plan Task 9 Step 4): a Yoga border can hold a child, a
// string cannot.
//
// Under Bun because the claim is about what the terminal SHOWS: a border the
// renderer paints from `borderColor`, and a body Yoga placed inside it. The Node
// suite can only see the tree (spec D8).

const CONTENT = ['▸ Title:', '    the value', '  [ Save ]'];

const input = (over: Partial<ChromeInput> = {}): ChromeInput => ({
  tab: null,
  busy: false,
  reloadable: false,
  modal: true,
  width: 80,
  title: '⚡ Edit ticket',
  meta: 'bakers',
  status: ' Esc cancel ',
  ...over,
});

const fields = columnNode(
  'form-fields',
  ...CONTENT.map((content, index) =>
    textNode({ id: `field-row-${index}`, content }),
  ),
);

/**
 * What a CONVERTED screen hands over — through `presentation()` itself.
 *
 * Read from the contract rather than rebuilt here, because the root a converted
 * body gets is exactly what this file is about: `presentation()` puts the body
 * WINDOW's two-column inset on a normal screen's tree, and a popup is not the
 * body window (its box supplies its own padding). Restating the root here would
 * make the case assert this file's assumption instead of the product's answer.
 */
const converted = presentation(fields, { modal: true }).body;
/** …and the same tree rooted the way a NON-modal screen's body is rooted. */
const inBodyWindow = bodyWindowRoot(fields);

const paint = async (
  chrome: ChromeInput,
  body: Parameters<typeof frameTrees>[1],
): Promise<string[]> => {
  const setup = await createTestRenderer({ width: chrome.width, height: 30 });
  const shell = new BoxRenderable(setup.renderer, {
    id: 'shell',
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    flexDirection: 'column',
  });
  setup.renderer.root.add(shell);
  const [region] = frameTrees(chrome, body);
  if (!region) throw new Error('the frame published no region');
  mountTree(setup.renderer, shell, region[1]);
  await setup.renderOnce();
  const rows = setup
    .captureCharFrame()
    .split('\n')
    .map((row) => row.replace(/\s+$/, ''));
  setup.renderer.destroy();
  return rows;
};

const columnOf = (rows: string[], needle: string): number => {
  const row = rows.find((line) => line.includes(needle));
  if (row === undefined) throw new Error(`the box drew no "${needle}"`);
  return row.indexOf(needle);
};

describe('the modal box holds a screen`s tree (spec D1)', () => {
  it("draws a converted screen's TREE inside the border", async () => {
    const rows = await paint(input(), converted);
    const text = rows.join('\n');
    for (const line of CONTENT) expect(text).toContain(line);
    // The border is the renderer's, and the popup's header and status ride in
    // the same box as the tree.
    expect(text).toContain('╭');
    expect(text).toContain('╰');
    expect(text).toContain('⚡ Edit ticket · bakers');
    expect(text).toContain('Esc cancel');
  });

  it('starts a popup`s body flush in the box, without the body window`s inset', async () => {
    // The defect this catches is invisible to `toContain`: a popup's body sat
    // two columns right of where the same popup's rows sat, because a converted
    // body is rooted for the body WINDOW — which insets it by two columns — and
    // a popup is not the body window. Its box already spends four columns on
    // border and padding.
    //
    // BB-340 Task 12 — it used to compare the popup against the SAME popup
    // drawn through the bridge, which was the byte-level subject while a screen
    // could still hand over rows. The bridge is gone, so what is compared is the
    // two ROOTS `presentation()` chooses between, which is what the flag has
    // always decided and the only half of the comparison that was ever about
    // this code.
    const popup = await paint(input(), converted);
    const inset = await paint(input(), inBodyWindow);
    for (const line of CONTENT)
      expect(columnOf(inset, line), line).toBe(columnOf(popup, line) + 2);
  });
});
