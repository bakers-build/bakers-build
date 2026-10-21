// The `autocomplete` widget: a select you TYPE into.
//
// The field row shows the current VALUE, so a pick stays readable from any
// field; the search box and its suggestions appear only while the field is
// active, which is the only way a bag of up to a server page can share a popup
// with five other fields.
//
// It filters through the kernel's OWN `filterOptions` — never a rule of its own.
// `apply` clamps its cursor against exactly that list and `pick` reads the row
// under it, so a private filtering rule here would point `›` at a row Enter does
// not take (BB-257 D7).

import { filterOptions } from '../Form/index.js';
import { scrollTo } from '../lib/scroll.js';
import { displayWidth, wrapToWidth } from '../lib/width.js';
import {
  BODY_INDENT,
  BODY_INDENT_COLUMNS,
  clip,
  findOption,
  note,
  padLabel,
} from './chrome.js';
import type { FieldCaret, FieldWidget, WidgetContext } from './types.js';

/**
 * How many suggestions are drawn at once.
 *
 * The window follows the cursor and whatever it leaves out is COUNTED rather
 * than dropped silently — spec R3's mitigation: never imply the list is
 * complete. Note what the count IS: the render window's overflow, and nothing
 * about the server. The page cap is disclosed separately, below.
 */
const MAX_SUGGESTIONS = 5;

/**
 * The query row(s), wrapped once and read by BOTH consumers.
 *
 * `render` turns them into composed rows and `caret` measures the insertion
 * point against them, so the characters the frame carries and the characters
 * the renderable paints over those cells come from one call and cannot
 * disagree about where a line breaks. Exactly the invariant `Widget/text.ts`
 * keeps for a `text` value, and the reason the double paint is safe rather than
 * sloppy.
 */
const queryRows = (ctx: WidgetContext): string[] =>
  wrapToWidth(`search: ${ctx.query()}`, ctx.width - BODY_INDENT_COLUMNS);

/**
 * Whether the query row is on screen at all.
 *
 * `render` returns EARLY on a failed bag and on an absent one, so on those the
 * field has no query row — and a cursor parked on a `⚠` note or on
 * `(no project context …)` would be a cursor on a row nobody can type into.
 * Stated once and read by `caret`, so the two can never disagree about whether
 * the row exists.
 */
const hasQueryRow = (ctx: WidgetContext): boolean =>
  ctx.active && ctx.error === undefined && ctx.list() !== undefined;

const autocompleteWidget: FieldWidget = {
  ownsError: true,
  inlineValue: true,
  render(ctx) {
    const head = padLabel(ctx.field.label, ctx.labelColumn);
    const picked = findOption(ctx.list() ?? [], ctx.selected());
    // The budget the value has left once the marker and the label column are
    // paid for — measured, not counted in code units (AC-14, observation 3).
    const inline = ctx.width - ctx.markWidth - displayWidth(head);
    const rows = [head + clip(picked?.label ?? '—', inline)];
    if (ctx.error !== undefined) {
      // The read failed, so the candidates are UNKNOWN: neither "none" nor "no
      // project" would be a truthful thing to say.
      return [...rows, ...note(ctx.error, BODY_INDENT, ctx.width)];
    }
    const list = ctx.list();
    if (list === undefined) {
      // The bag is ABSENT, not empty — the field has nothing it could offer. The
      // wording is domain text and rides on the declaration; a widget that knows
      // no entity cannot invent it.
      if (ctx.field.absentNote !== undefined) {
        rows.push(`${BODY_INDENT}${ctx.field.absentNote}`);
      }
      return rows;
    }
    if (!ctx.active) return rows;

    // The row wraps for the same reason prose does: the frame truncates, and a
    // typed query is text the writer must read back. The insertion point is NOT
    // a character in it — see `caret` below.
    rows.push(...queryRows(ctx).map((row) => `${BODY_INDENT}${row}`));
    const query = ctx.query();
    const matches = filterOptions(list, query);
    const start = scrollTo(ctx.cursor, 0, MAX_SUGGESTIONS);
    const shown = matches.slice(start, start + MAX_SUGGESTIONS);
    shown.forEach((option, i) => {
      const cursor = start + i === ctx.cursor ? '›' : ' ';
      rows.push(
        `   ${cursor}${clip(option.label, ctx.width - BODY_INDENT_COLUMNS)}`,
      );
    });

    // Two DIFFERENT incompletenesses, and conflating them is what the review
    // caught the README doing. `+N more` counts what the render window left out
    // of the matches it has. A bag sitting AT the server page size may itself be
    // a truncated answer — a fact of the load, not of the window — so when the
    // local filter narrows the matches into the window the disclosure must not
    // vanish with the counter (AC-17).
    const hidden = matches.length - shown.length;
    const capped =
      ctx.field.pageSize !== undefined && list.length >= ctx.field.pageSize;
    if (hidden > 0) {
      rows.push(`${BODY_INDENT}+${hidden} more — narrow the search`);
    } else if (capped) {
      rows.push(`${BODY_INDENT}more may exist — narrow the search`);
    }
    return rows;
  },
  /**
   * BB-326 (widget-fit F2) — where the query's insertion point goes.
   *
   * The row used to end in `▌`, a character the frame carried. It is now a real
   * TERMINAL cursor, driven by `Widget/textarea.ts`'s controlled `FieldTextarea`
   * — the same renderable, the same seam and the same
   * operator reason as `title` and `description`: they run the cockpit over mosh
   * from a phone, and mosh's local predictive echo only works when the terminal
   * has a cursor to predict at. An inverse cell (or a `▌`) is a repaint mosh
   * cannot predict, so every keystroke cost a round trip.
   *
   * NOT `InputRenderable`, which the decision doc named as this row's candidate.
   * Measured: it forces `height = 1` and does not wrap, so a query longer than
   * the row painted only its LAST characters — the head of what was typed went
   * off screen, which is the one thing this row's contract forbids. Its other
   * claimed advantage, `onSubmit` wired straight to the `pick` intent, is
   * unreachable anyway: it requires the widget to CONSUME Enter, and the seam's
   * whole discipline is that the ladder keeps every key.
   *
   * Row 1 always: `render` puts the picked-value row at 0 and, whenever it
   * returns a query row at all, puts it immediately below.
   */
  caret(ctx): FieldCaret | undefined {
    if (!hasQueryRow(ctx)) return undefined;
    const rows = queryRows(ctx);
    return {
      row: 1,
      column: BODY_INDENT_COLUMNS,
      width: ctx.width - BODY_INDENT_COLUMNS,
      height: rows.length,
      text: rows.join('\n'),
      // The END, always. A query is APPEND-ONLY — `Form/form.ts`'s autocomplete
      // branch is `query + intent.text` for an insert and `query.slice(0, -1)`
      // for a backspace, with no `cursor` intent reaching it (the field's
      // `cursor` is the SUGGESTION row, BB-300 D3). So there is no insertion
      // point to track: it is the cell the `▌` occupied.
      //
      // COUNTED THE WAY `Widget/text.ts`'s `wrappedOffset` counts — over the
      // wrapped rows plus one separator each — and for the same reason. The unit
      // is UTF-16 CODE UNITS, which is what `TextCaret.offset` declares and what
      // the renderable's `EditBuffer` resolves; it is a BUFFER POSITION, not a
      // layout measurement, and must not be confused with the display columns
      // every other number in this file is in (AC-14).
      offset: rows.reduce((at, row) => at + row.length, rows.length - 1),
      // Never empty: the row always carries its `search: ` prefix, so there is
      // nothing for a placeholder to stand in for.
      placeholder: undefined,
    };
  },
};

export default autocompleteWidget;
