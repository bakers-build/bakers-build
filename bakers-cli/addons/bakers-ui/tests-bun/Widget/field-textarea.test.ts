import { afterEach, expect, it } from 'bun:test';
import { h, type Renderable } from '@opentui/core';
import { mountTree, patchTree } from '../../src/Kernel/mount.js';
import { FieldTextarea } from '../../src/Widget/textarea.js';
import { type BareHarness, createHarness } from '../tui-harness.js';

/**
 * BB-340 Task 9 Step 3 — why the field widget is a SUBCLASS.
 *
 * `TextareaRenderable` carries no settable text: `setText` is a method,
 * `plainText` is read-only, and `initialValue` applies exactly ONCE (its setter
 * is guarded by `_initialValueSet`). `Kernel/mount.ts` patches by writing props
 * as property assignments, so a raw `h(TextareaRenderable, { initialValue })`
 * in a patched tree would paint the value the field had when it was mounted and
 * never change again — a defect no text reader can see, because the first frame
 * is right.
 *
 * The two cases below are that defect, stated as behaviour: the value follows
 * the reducer across a patch, and the cursor offset does too.
 */
const live: BareHarness[] = [];

afterEach(() => {
  for (const harness of live.splice(0)) harness.renderer.destroy();
});

const newHarness = async (): Promise<BareHarness> => {
  const harness = await createHarness();
  live.push(harness);
  return harness;
};

const field = (value: string, offset: number) =>
  h(FieldTextarea, {
    id: 'field-title-input',
    value,
    caretOffset: offset,
    width: 20,
    height: 1,
  });

it('the value FOLLOWS the reducer across a patch', async () => {
  const harness = await newHarness();
  const mounted = mountTree(harness.renderer, harness.root, field('ab', 2));
  await harness.renderOnce();
  patchTree(harness.renderer, mounted, field('abc', 3));
  await harness.renderOnce();
  const node = mounted.byId.get('field-title-input') as
    | (Renderable & { plainText: string })
    | undefined;
  expect(node?.plainText).toBe('abc');
});

it('the cursor offset follows it too', async () => {
  const harness = await newHarness();
  const mounted = mountTree(harness.renderer, harness.root, field('abcdef', 6));
  await harness.renderOnce();
  patchTree(harness.renderer, mounted, field('abcdef', 2));
  await harness.renderOnce();
  const node = mounted.byId.get('field-title-input') as
    | (Renderable & { cursorOffset: number })
    | undefined;
  expect(node?.cursorOffset).toBe(2);
});

it('the reducer owns every key — the widget declines all of them', async () => {
  // Moved from the deleted `Kernel/caret-slot.ts`'s `ViewOnlyTextarea`, unchanged in
  // substance: a focused renderable's `handleKeyPress` runs after the kernel's
  // global listener, which does not `preventDefault()`, so a widget that
  // consumed keys would apply every keystroke twice.
  const harness = await newHarness();
  const mounted = mountTree(harness.renderer, harness.root, field('ab', 2));
  await harness.renderOnce();
  const node = mounted.byId.get('field-title-input') as unknown as {
    handleKeyPress(): boolean;
    plainText: string;
  };
  expect(node.handleKeyPress()).toBe(false);
  expect(node.plainText).toBe('ab');
});
