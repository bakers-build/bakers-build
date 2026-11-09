import type { Renderable } from '@opentui/core';
import {
  createTestRenderer,
  type TestRendererSetup,
} from '@opentui/core/testing';
import { runTicketTui } from '../src/Kernel/tui-kernel.js';
import type { RendererServices, TuiOptions } from '../src/types.js';

/**
 * BB-326 — the replacement for `FakeInput`/`FakeOutput`.
 *
 * `@opentui/core/testing` ships the in-process half of the harness
 * (`createTestRenderer`, `mockInput`, `captureCharFrame`, `waitForFrame`), so
 * this file is a boot helper rather than a terminal emulator. It runs under Bun
 * because the renderer reaches its Zig core through FFI; the ~18 000 lines of
 * data and routing tests stay on vitest under Node.
 *
 * THE ONE THING TO READ BEFORE CONVERTING A TEST: `frame()` is the CURRENT
 * SCREEN, not a transcript. The fake harness accumulated every byte ever
 * written and its `frame()` only re-split that transcript at the last
 * clear-screen, so a `toContain` could be answered by text that had already
 * scrolled away. Here the answer comes out of the render buffer, so an
 * assertion only passes if the thing is on screen when it is asked.
 */
export interface BootOptions {
  /** The services bag the kernel runs against — the test's fake client. */
  readonly services: RendererServices;
  /** The kernel options under test (route, agents, debounce, …). */
  readonly tui?: TuiOptions;
  /** Terminal columns. 120 is the width the fake harness defaulted to. */
  readonly columns?: number;
  /** Terminal rows. 40 is the height the fake harness defaulted to. */
  readonly rows?: number;
}

export interface BootedTui extends TestRendererSetup {
  /** Resolves when the kernel's `finish()` has run — i.e. after `q`. */
  readonly running: Promise<void>;
  /** The current screen as plain characters, trailing padding trimmed. */
  frame(): string;
  /** {@link frame} split into rows. */
  rows(): string[];
  /** Send raw bytes the way a terminal would, then let the kernel settle. */
  press(sequence: string): Promise<void>;
  /** Tear the renderer down. The kernel does not: the test owns what it made. */
  stop(): Promise<void>;
}

/**
 * Let the kernel's queued microtasks and promise chains settle.
 *
 * 40 ms rather than the fake harness's 10: a LONE Escape is the prefix of every
 * CSI sequence, so OpenTUI's parser holds it for a disambiguation window
 * (~25 ms observed in `key-input.test.ts`) before deciding it stands alone.
 * Every other key is delivered synchronously; this wait is sized for the one
 * that is not.
 */
export const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 40));

/**
 * The captured frame with each row's trailing padding removed.
 *
 * The render buffer is a GRID: every row is `width` cells wide whether or not
 * anything was written into them. The composed frame's rows are not, and the
 * assertions inherited from the fake harness compare against composed rows —
 * `expect(rows[5]).toBe('')` for the separator, most of all. Trimming the right
 * edge is what makes the two comparable; nothing inside a row is touched.
 */
const trimRows = (captured: string): string =>
  captured
    .split('\n')
    .map((row) => row.replace(/\s+$/, ''))
    .join('\n');

/**
 * The one construction site of the renderer every Bun test drives.
 *
 * It is a single function, not a config object copied twice, because
 * `exitOnCtrlC` was already lost once by having two of them — see the comment
 * inside.
 */
const createRenderer = (
  columns?: number,
  rows?: number,
): Promise<TestRendererSetup> =>
  createTestRenderer({
    width: columns ?? 120,
    height: rows ?? 40,
    // The kernel's own production settings, so a test drives the same renderer
    // the cockpit does: the legacy xterm encoding `keyEventToInput` depends on,
    // and no on-screen console overlay to swallow a handler exception.
    //
    // `exitOnCtrlC` belongs in that list too, and is easy to miss: the kernel
    // passes `false` because Ctrl+C is a key in its own ladder, but that config
    // only applies to a renderer the kernel CREATES. An INJECTED one keeps
    // OpenTUI's default of `true` and tears itself down on `\x03` behind the
    // kernel's back, which made the renderer unsafe to touch afterwards — a
    // probe segfaulted Bun. Setting it here is what makes the Ctrl+C path the
    // same path in a test as in the cockpit.
    exitOnCtrlC: false,
    useKittyKeyboard: null,
    consoleMode: 'disabled',
    openConsoleOnError: false,
  });

/**
 * A renderer and its root, with no cockpit in it.
 *
 * BB-340 — `Kernel/mount.ts` knows renderables and VNodes and nothing about
 * screens, so its test needs a renderer rather than a booted kernel. It goes
 * through {@link createRenderer} like {@link bootTui} does, so the settings the
 * cockpit depends on cannot drift apart between the two.
 */
export interface BareHarness extends TestRendererSetup {
  /** The renderer's root renderable — the parent a mounted tree is added to. */
  readonly root: Renderable;
}

export async function createHarness(options?: {
  readonly columns?: number;
  readonly rows?: number;
}): Promise<BareHarness> {
  const setup = await createRenderer(options?.columns, options?.rows);
  return { ...setup, root: setup.renderer.root };
}

export async function bootTui(options: BootOptions): Promise<BootedTui> {
  const setup = await createRenderer(options.columns, options.rows);
  const running = runTicketTui({}, {}, options.services, {
    ...options.tui,
    renderer: setup.renderer,
  });
  await settle();
  await setup.renderOnce();

  const frame = (): string => trimRows(setup.captureCharFrame());
  return {
    ...setup,
    running,
    frame,
    rows: () => frame().split('\n'),
    press: async (sequence: string): Promise<void> => {
      setup.mockInput.pressKey(sequence);
      await settle();
      await setup.renderOnce();
    },
    stop: async (): Promise<void> => {
      setup.renderer.destroy();
    },
  };
}
