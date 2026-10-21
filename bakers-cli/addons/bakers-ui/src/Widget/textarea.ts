// BB-340 (ticket decision 6) — the widget layer's own `Renderable`, and the
// one control the cockpit does not hand-paint.
//
// It arrived in BB-326 as `ViewOnlyTextarea` inside `Kernel/caret-slot.ts`,
// where it was placed ABSOLUTELY over rows the frame had already composed. Here
// it is a node in the tree the form returns, laid out by Yoga like every other
// node — same class, same reasons, one owner. Task 9 Step 5 deleted that module
// with the last screen that composed a popup out of rows, so this is the only
// place the cockpit's insertion point has ever to be looked for.
//
// WHY A SUBCLASS AT ALL, since `@opentui/core` already ships the control:
// `Kernel/mount.ts` patches a standing tree by ASSIGNING the props the next
// frame declares, and `TextareaRenderable` exposes no assignable text. `setText`
// is a method, `plainText` is read-only, and `initialValue`'s setter is guarded
// by `_initialValueSet` so it applies exactly once. A raw
// `h(TextareaRenderable, { initialValue })` would therefore paint the value the
// field held when it was mounted and never change again — and the first frame
// would look right, which is the kind of defect the PTY drivers exist for.
// `value` and `caretOffset` are the two assignable props that fix it.

import {
  type RenderContext,
  type TextareaOptions,
  TextareaRenderable,
} from '@opentui/core';
import {
  BORDER,
  DEFAULT_BACKGROUND,
  DEFAULT_FOREGROUND,
} from '../lib/theme.js';

/**
 * Every colour the field uses — only {@link ../lib/theme.js} tokens, never
 * terminal defaults or truecolor hex (`verify-colors.mjs` rejects those).
 */
const COLORS = () => ({
  textColor: DEFAULT_FOREGROUND,
  backgroundColor: DEFAULT_BACKGROUND,
  focusedTextColor: DEFAULT_FOREGROUND,
  focusedBackgroundColor: DEFAULT_BACKGROUND,
  placeholderColor: BORDER,
  cursorColor: DEFAULT_FOREGROUND,
});

export interface FieldTextareaOptions extends TextareaOptions {
  /** The text to display — assignable on every patch, unlike `initialValue`. */
  readonly value?: string;
  /** Where the terminal cursor goes, as a UTF-16 offset into {@link value}. */
  readonly caretOffset?: number;
}

/**
 * A text field's value block: a Textarea that paints and never listens.
 *
 * CONTROLLED, and that word carries the whole design. The form reducer stays the
 * single source of truth: this renderable is handed the current value and the
 * current offset on every draw and owns NOTHING. So it must not also process
 * keys — a focused renderable's `handleKeyPress` runs after the kernel's global
 * listener, which does not `preventDefault()` (and could not do so per-widget),
 * so both would apply the same keystroke. Measured against the stock class:
 * typing `X` into a focused Textarea holding `ab` left `abX` in the widget AND
 * `abX` in the reducer.
 */
export class FieldTextarea extends TextareaRenderable {
  constructor(ctx: RenderContext, options: FieldTextareaOptions) {
    super(ctx, {
      ...COLORS(),
      // The widget layer's own wrap already decided where the lines break and
      // the caller reserved exactly that many rows, so the renderable must not
      // wrap again: it is handed the finished rows and lays them out verbatim.
      // Measured, and the reason this is not `'word'`: the native word wrap
      // breaks a line that exactly fills the width, so it disagreed with
      // `wrapToWidthRows` on 3 of 10 sampled values — and a disagreement is a
      // row the caller did not reserve.
      wrapMode: 'none',
      // No context margin: the viewport is sized to hold the whole row plus the
      // cursor's cell, so there is nothing to scroll towards and a margin would
      // only invent a reason to scroll.
      scrollMargin: 0,
      ...options,
    });
    // A picture of a value, not a document: a drag over it would paint a
    // selection the cockpit never asked for, exactly as on the composed rows.
    this.selectable = false;
    // `instantiate` passes props to the CONSTRUCTOR and assigns nothing, while
    // `patchTree` assigns and constructs nothing — so both entry points have to
    // be served, and the first frame goes through here.
    if (options.value !== undefined) this.value = options.value;
    if (options.caretOffset !== undefined)
      this.caretOffset = options.caretOffset;
  }

  /** The reducer owns every key. This one sees them and declines all of them. */
  override handleKeyPress(): boolean {
    return false;
  }

  /** …and a bracketed paste is just a very fast sequence of them. */
  override handlePaste(): void {}

  get value(): string {
    return this.plainText;
  }

  /**
   * Guarded because `setText` resets the whole buffer through FFI, and a draw
   * happens on every keystroke, wheel notch and resize — most of which leave the
   * value alone and move only the offset.
   */
  set value(text: string) {
    if (this.plainText !== text) this.setText(text);
  }

  get caretOffset(): number {
    return this.cursorOffset;
  }

  /**
   * Focus before the offset: `renderCursor` draws nothing unless the renderable
   * is focused, and the offset is what it resolves into a cell. Re-asserted on
   * every draw rather than once, so a focus the renderer moved elsewhere (a
   * click's `autoFocus`) is taken back on the next repaint instead of leaving
   * the operator without a cursor.
   *
   * A node declaring both props must state `value` BEFORE `caretOffset`:
   * `patchTree` assigns in declaration order and `setText` resets the offset.
   */
  set caretOffset(offset: number) {
    if (!this.focused) this.focus();
    this.cursorOffset = offset;
  }
}
