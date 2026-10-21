import { isVNode } from '@opentui/core';
import { expect } from 'vitest';
import type { Screen, ScreenContext } from '../../src/Screen/screen.js';

/**
 * The minimal {@link ScreenContext} every registered screen can be presented
 * with — the three members the interface requires and nothing else.
 *
 * One helper rather than one per test file (BB-340 Task 12): the teardown test
 * presents all thirteen screens, and a context assembled a second time is a
 * second thing to keep in step with the interface.
 */
export const contextFor = (
  overrides: Partial<ScreenContext> = {},
): ScreenContext => ({
  sessionGeneration: 1,
  requestDraw: () => {},
  isActive: () => true,
  ...overrides,
});

/**
 * Shared lifecycle assertions for registered destination instances.
 *
 * BB-340 Task 12 — it used to assert `present(context).lines` against
 * `render(context)`, which made this helper itself a consumer of the row
 * surface. The surface is off the contract, so what a lifecycle now asserts is
 * the contract that replaced it: a screen hands over a VNode body and no rows
 * at all (spec A1).
 */
export const expectScreenLifecycle = (
  screen: Screen,
  context: ScreenContext,
): void => {
  expect(() => screen.enter(context)).not.toThrow();
  const shown = screen.present(context);
  expect(isVNode(shown.body)).toBe(true);
  expect('lines' in shown).toBe(false);
  expect(() => screen.leave()).not.toThrow();
  expect(() => screen.reset()).not.toThrow();
};
