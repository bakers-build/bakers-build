import { expect, it } from 'bun:test';
import type { RendererServices } from '../../src/types.js';
import { fakeClient } from '../../tests/test-support.js';
import { bootTui } from '../tui-harness.js';

// BB-326 — the ONE property that makes the insertion-point widget safe, and
// the only one that had no test. BB-340 Task 9 deleted `Kernel/caret-slot.ts`,
// which used to place that widget absolutely over composed rows; the widget
// itself is unchanged and is now a NODE in the popup's own tree, so the property
// is the same one and this file only stopped naming a module that is gone.
//
// `Widget/textarea.ts`'s `FieldTextarea` overrides `handleKeyPress` to
// `return false` and `handlePaste` to a no-op, with a comment stating why:
// OpenTUI's
// `InternalKeyHandler.emitWithPriority` runs GLOBAL listeners first and the
// focused renderable's handler second, so the kernel's key ladder and the widget
// both see every keystroke. The ladder feeds the reducer; a widget that also
// acted would insert the same character into its own buffer — and the widget IS
// the value block now, so its buffer is what the operator reads.
//
// Measured against the stock class before the override existed: typing `X` into a
// focused Textarea holding `ab` left `abX` in the widget AND `abX` in the reducer.
// Until now that was a comment. Delete the override and this test fails; nothing
// else in the suite does.
//
// WHY THE DOUBLING IS VISIBLE AT ALL, given that every draw re-writes the widget's
// `value` from the reducer. The order within one keystroke is: global ladder →
// reducer → `draw()` → `patchTree` writes the reducer's value onto the node →
// THEN the renderable handler runs and appends. So the widget ends each keystroke
// exactly one character ahead of the reducer, and `renderOnce()` paints that.
//
// Driven through the real kernel over the OpenTUI test renderer, because the
// property is an interaction between three things no unit test holds at once: the
// renderer's dispatch order, the kernel's ladder, and the widget's lifecycle.

/**
 * The project Tickets parent-filter picker (`p`): its query is a caret field,
 * so typing there puts the `FieldTextarea` on screen.
 */
async function openPopup() {
  const services: RendererServices = {
    client: fakeClient({ rows: {} }),
    baseUrl: 'https://x.test',
  };
  const tui = await bootTui({
    services,
    tui: {
      project: 'bakers',
      cwd: '/repo',
      route: { screen: 'project', projectId: 'p1', projectName: 'bakers' },
    },
  });
  await tui.press('\t'); // Overview -> Tickets
  await tui.press('p');
  expect(tui.frame()).toContain('Filter by parent');
  return tui;
}

/**
 * The query the widget owns, read off the rendered grid rather than from the
 * reducer on purpose: the reducer is exactly the thing that stays correct when
 * the widget doubles a key, so asking it would answer the wrong question.
 */
const queryRow = (tui: { rows(): string[] }): string => {
  const row = tui.rows().find((line) => line.includes('search:'));
  expect(row).toBeDefined();
  return (row ?? '').replace(/^.*search:/, '').replace(/[│\s]/g, '');
};

/**
 * One key, frame captured the instant the handlers have run. `press()`'s settle
 * would let the picker's debounced re-query redraw first and reset the widget,
 * masking a doubling (see `filter-caret.test.ts`).
 */
const typeRaw = async (
  tui: Awaited<ReturnType<typeof openPopup>>,
  key: string,
): Promise<void> => {
  tui.mockInput.pressKey(key);
  await tui.renderOnce();
};

it('the caret slot never applies a keystroke the ladder already applied', async () => {
  const tui = await openPopup();

  // Four distinct characters, so a doubling shows up as `aabb…` rather than as a
  // length that could be explained by a stray repeat.
  for (const key of ['a', 'b', 'c', 'd']) await typeRaw(tui, key);

  expect(
    queryRow(tui),
    'each key lands exactly once — `abcd`, never `aabbccdd` or `abcdd`',
  ).toBe('abcd');

  await tui.press('\x1b');
  tui.mockInput.pressKey('q');
  await tui.running;
  await tui.stop();
});

it('a backspace is not applied twice either', async () => {
  const tui = await openPopup();
  for (const key of ['a', 'b', 'c']) await typeRaw(tui, key);
  expect(queryRow(tui)).toBe('abc');

  // The mirror image of the insert case: a widget that also handled the delete
  // would remove one character too many, so the row would read `a` not `ab`.
  await typeRaw(tui, '\x7f');

  expect(queryRow(tui), 'one backspace removes one character').toBe('ab');

  await tui.press('\x1b');
  tui.mockInput.pressKey('q');
  await tui.running;
  await tui.stop();
});
