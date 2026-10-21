// BB-257 (re-entry) — the small measured primitives every widget and both
// popups share. All of them count DISPLAY COLUMNS, which is the point: the edit
// popup used to measure its own wrap in UTF-16 code units, so a server message
// carrying CJK or an emoji wrapped one column short per wide character and the
// frame clipped what it drew. One unit, in one place (AC-14).

import type { Option } from '../Form/index.js';
import { displayWidth, truncateToWidth, wrapToWidth } from '../lib/width.js';

/** The indent a field's continuation rows sit at, in the popup body. */
export const BODY_INDENT = '    ';

/** …and its width, in the one unit this package measures in. ASCII today, so it
 *  equals `BODY_INDENT.length` exactly — measured anyway, because "it happens to
 *  agree" is how the second unit of measure got in last time (AC-14). */
export const BODY_INDENT_COLUMNS = displayWidth(BODY_INDENT);

/** Columns the `▸ `/`  ` active marker occupies on a field's first row. */
export const MARK_WIDTH = 2;

/** The gap between the longest inline label and the value column. */
const LABEL_GAP = 2;

/**
 * A `⚠` note, wrapped so the frame never has to clip it.
 *
 * Continuations line up under the TEXT, not under the sigil, and the budget
 * gives up both the indent and the sigil's two columns.
 */
export function note(text: string, indent: string, width: number): string[] {
  return wrapToWidth(text, width - displayWidth(indent) - 2).map(
    (row, i) => `${indent}${i === 0 ? '⚠ ' : '  '}${row}`,
  );
}

/**
 * Cut `text` to `columns` display columns, saying so with an ellipsis.
 *
 * For a row of a CURSOR LIST, never for prose: one entry must stay one row or
 * the cursor stops meaning anything, whereas prose the writer is authoring must
 * be readable back whole and is therefore wrapped instead. The cut is made here
 * rather than left to the frame so it is visible and deliberate.
 */
export function clip(text: string, columns: number): string {
  return displayWidth(text) <= columns
    ? text
    : `${truncateToWidth(text, Math.max(0, columns - 1))}…`;
}

/** `<label>:` padded — in COLUMNS — to the shared inline-value column. */
export function padLabel(label: string, columns: number): string {
  const head = `${label}:`;
  return head + ' '.repeat(Math.max(0, columns - displayWidth(head)));
}

/**
 * The column the inline values of a declaration line up at.
 *
 * Derived from the fields that actually HAVE an inline value, never from all of
 * them: the create popup declares `Description`, whose label is longer than any
 * of its selects but which renders its value on rows of its own, so counting it
 * would push every ring two columns right for nothing.
 */
export function inlineLabelColumn(labels: readonly string[]): number {
  if (labels.length === 0) return 0;
  return Math.max(...labels.map(displayWidth)) + LABEL_GAP;
}

/** The option with `id`, or undefined. The ONE option lookup in the package. */
export function findOption(
  list: readonly Option[],
  id: string | null,
): Option | undefined {
  return id === null ? undefined : list.find((o) => o.id === id);
}
