// The `text` widget: a label row and the value as PROSE beneath it.
//
// The wrap is presentation only. The state keeps one logical line per Enter and
// the form's `toObject` hands on exactly the characters that were typed
// (BB-257 AC-2), so what this draws must never be mistaken for what it
// submits — which is also why it wraps rather than clips: the writer has to be
// able to read back the sentence they are authoring (AC-1).
//
// BB-283 drew the insertion point as an inverse-video cell spliced into the
// row. BB-326 REPLACED THAT WITH A TERMINAL CURSOR, on an operator decision:
// they drive the cockpit over mosh from a phone, and mosh's local predictive
// echo — the thing that makes a typed character appear before the round trip —
// only works when the terminal has a real cursor to predict at. An inverse cell
// is a repaint mosh cannot predict.
//
// So this module no longer draws a caret. It publishes WHERE the caret goes
// (`caret`), and the kernel hands that to a `TextareaRenderable` which owns the
// cell and drives the terminal cursor. Submit integrity (AC-6) is unaffected and
// for a stronger reason than before: the caret was never in the value, and now
// it is not even in the frame.
//
// WHAT STAYED HERE, AND WHY. The wrap does — `wrapToWidthRows` decides how many
// rows the field occupies, and that number sizes the popup, centres it and
// places every field below it. It has to be answerable by a pure function with
// no renderer in reach. So the widget keeps the wrap and hands the renderable
// the ALREADY-WRAPPED text; what the renderable adds is the offset→cell
// resolution (grapheme- and width-aware, over its own buffer) and the terminal
// cursor's lifecycle. Letting it wrap instead was measured and rejected: its
// native word wrap breaks a line that exactly fills the width, so it disagreed
// with `wrapToWidthRows` on 3 of 10 sampled values — and a disagreement is a row
// count the frame reserved wrongly.

import { type WrappedRow, wrapToWidthRows } from '../lib/width.js';
import { BODY_INDENT, BODY_INDENT_COLUMNS } from './chrome.js';
import type { FieldCaret, FieldWidget, WidgetContext } from './types.js';

/** The row an empty field still occupies, so the popup's rows keep lining up. */
const EMPTY = '<empty>';

/**
 * The wrapped row a source offset belongs to, and where in that row it sits.
 *
 * The translation is the offset mapping `wrapToWidthRows` reported while it
 * still knew it: each row is a verbatim substring starting at `from`, so the
 * point belongs to the first row whose successor starts PAST it. A point in the
 * gap a soft break ate (or before a paragraph's `\n`) belongs to the END of the
 * row before the gap, and a point at the value's end trails the last row.
 *
 * This is the half of the old `withCaret` that survives: only the SPLICING of
 * the inverse-video bytes went away.
 */
const rowAndColumn = (
  rows: readonly WrappedRow[],
  cursor: number,
): { index: number; within: number } => {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as WrappedRow;
    const next = rows[i + 1];
    if (next !== undefined && cursor >= next.from) continue;
    return {
      index: i,
      within: Math.min(Math.max(0, cursor - r.from), r.row.length),
    };
  }
  return { index: 0, within: 0 };
};

/**
 * The insertion point's offset into the WRAPPED text.
 *
 * The wrapped text is the rows joined by `\n`, so a row's start there is the
 * running length of the rows before it plus one separator each — which is NOT
 * the source offset, because a soft break eats its whitespace and the two
 * strings drift apart by exactly the eaten columns.
 */
const wrappedOffset = (rows: readonly WrappedRow[], cursor: number): number => {
  const { index, within } = rowAndColumn(rows, cursor);
  let at = 0;
  for (let i = 0; i < index; i++) at += (rows[i] as WrappedRow).row.length + 1;
  return at + within;
};

const wrapFor = (ctx: WidgetContext): WrappedRow[] =>
  wrapToWidthRows(ctx.text(), ctx.width - BODY_INDENT_COLUMNS);

const textWidget: FieldWidget = {
  ownsError: false,
  inlineValue: false,
  render(ctx) {
    const typed = ctx.text();
    // `<empty>` rather than a blank row: an empty field must still occupy one
    // line, or the popup's rows stop lining up with its fields.
    if (typed.length === 0) {
      return [`${ctx.field.label}:`, `${BODY_INDENT}${EMPTY}`];
    }
    return [
      `${ctx.field.label}:`,
      ...wrapFor(ctx).map((r) => `${BODY_INDENT}${r.row}`),
    ];
  },
  caret(ctx): FieldCaret | undefined {
    if (!ctx.active) return undefined;
    const typed = ctx.text();
    const width = ctx.width - BODY_INDENT_COLUMNS;
    // Row 1: the label owns row 0 and the value block starts under it.
    const common = { row: 1, column: BODY_INDENT_COLUMNS, width } as const;
    if (typed.length === 0) {
      return { ...common, height: 1, text: '', offset: 0, placeholder: EMPTY };
    }
    const rows = wrapFor(ctx);
    return {
      ...common,
      height: rows.length,
      text: rows.map((r) => r.row).join('\n'),
      offset: wrappedOffset(rows, ctx.cursor),
      placeholder: undefined,
    };
  },
};

export default textWidget;
