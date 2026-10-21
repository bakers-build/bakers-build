// BB-241 Amendment A / B — display width, the unit the TUI's row geometry is
// actually drawn in.
//
// Everything in the renderer assumes "one rendered entry is one physical row",
// and the hit test turns a clicked row back into an entry. Both are only true if
// padding and truncation count the COLUMNS a terminal will occupy, not UTF-16
// code units. `⚡` (U+26A1) is one code unit and two columns; measuring it as one
// made the top frame `width + 1` columns wide, wrapped its closing `╮` onto a
// second physical row, and pushed the body down by one — so every click landed a
// row too high.
//
// The stakes are the same for every other wide character, because the title and
// meta chrome rows have ZERO column slack: `'│ ' + fitLine(x, width - 4) + ' │'`
// is exactly `width`, and `title` is user data. Amendment B therefore replaced
// this module's hand-listed range table with a GENERATED one (`width-table.ts`,
// derived from the vendored `data/EastAsianWidth.txt`) — the hand-listed version
// measured 361 real `EAW=W`/`F` code points as one column, `U+2630..2637`,
// `U+4DC0..4DFF`, `U+1AFF0..1AFFE`, `U+1D300..1D356`, `U+1F6DC..1F6DF` and
// `U+1F7F0` among them, i.e. the same defect waiting on a different character.
//
// Pure apart from the generated table — a leaf module like `scroll.ts`.

import { WIDE_RANGES } from './width-table.js';

/** Code points that occupy NO column: combining marks (including the variation
 *  selectors of an emoji presentation sequence), format controls such as ZWJ,
 *  and the C0/C1 controls (which `sanitizeDisplay` strips before we ever see
 *  them, but which must not be counted if they slip through). */
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}\p{Cc}]+$/u;

/** U+FE0F VARIATION SELECTOR-16 — "render the preceding character as an emoji",
 *  which means two columns even when its base is Narrow or Ambiguous. */
const VARIATION_SELECTOR_16 = '️';

/** Everything a terminal lays out one column per code unit: printable ASCII. The
 *  overwhelmingly common case, kept on a fast path so the measurement stays
 *  byte-identical (and cheap) for it. */
const ASCII_ONLY = /^[\x20-\x7e]*$/;

/** An SGR sequence (`\x1b[7m` and friends): it RESTYLES what follows but
 *  occupies no terminal column, so measurement must skip it — a row carrying
 *  the text field's inverse-video caret (BB-283) is exactly as wide as the
 *  text it draws. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching SGR is the whole point — it measures as zero columns.
const SGR = /\x1b\[[0-9;]*m/g;

/** An SGR sequence at the START of the string — the prefix test the
 *  truncating scanner below applies while it walks. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching SGR is the whole point — it measures as zero columns.
const SGR_PREFIX = /^\x1b\[[0-9;]*m/;

/** Iterating GRAPHEME CLUSTERS rather than code points is what keeps an emoji
 *  presentation sequence (`X` + U+FE0F) measurable as one two-column unit, and
 *  what stops `truncateToWidth` from cutting between its halves — which would
 *  drop the base back to text presentation and leave the row a column short of
 *  what it was padded for. Node >= 20.19 per the workspace's `engines`. */
const clusters = new Intl.Segmenter('en', { granularity: 'grapheme' });

function isWide(codePoint: number): boolean {
  let low = 0;
  let high = WIDE_RANGES.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const range = WIDE_RANGES[mid];
    if (range === undefined) return false;
    if (codePoint < range[0]) high = mid - 1;
    else if (codePoint > range[1]) low = mid + 1;
    else return true;
  }
  return false;
}

/** The columns a single code point occupies: 0, 1 or 2. The zero-width rule
 *  OUTRANKS the width table on purpose — Unicode classifies some combining marks
 *  (U+3099, U+302A…) as `W`, but a terminal advances no column for them. */
export function charWidth(char: string): number {
  if (ZERO_WIDTH.test(char)) return 0;
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) return 0;
  return isWide(codePoint) ? 2 : 1;
}

/**
 * The columns one grapheme cluster occupies.
 *
 * A cluster is what the terminal advances its cursor for, so its width is its
 * BASE character's — the trailing marks add nothing. The two emoji rules are the
 * exception, and they are why code-point measurement was wrong: `⚠️` is U+26A0
 * (Ambiguous, one column on its own) plus U+FE0F (a combining mark, zero), which
 * measures 1 while every modern terminal renders it as 2.
 */
export function clusterWidth(cluster: string): number {
  if (cluster === '') return 0;
  // A cluster made ENTIRELY of marks/format/control characters advances nothing.
  if (ZERO_WIDTH.test(cluster)) return 0;
  const first = cluster.codePointAt(0);
  if (first === undefined) return 0;
  if (isWide(first)) return 2;
  // Emoji presentation: either the base defaults to it, or U+FE0F asks for it.
  if (/^\p{Emoji_Presentation}/u.test(cluster)) return 2;
  if (cluster.includes(VARIATION_SELECTOR_16) && /^\p{Emoji}/u.test(cluster)) {
    return 2;
  }
  return 1;
}

/** The columns `text` occupies when rendered in a terminal. SGR sequences
 *  count as ZERO — they restyle, they do not draw. */
export function displayWidth(text: string): number {
  if (ASCII_ONLY.test(text)) return text.length;
  const visible = text.replace(SGR, '');
  if (ASCII_ONLY.test(visible)) return visible.length;
  let total = 0;
  for (const { segment } of clusters.segment(visible)) {
    total += clusterWidth(segment);
  }
  return total;
}

/**
 * The longest prefix of `text` that fits in `columns` display columns.
 *
 * Cuts only on a GRAPHEME CLUSTER boundary, so it never splits a wide character,
 * a combining sequence, a ZWJ emoji or an emoji presentation sequence. The result
 * may therefore be one column narrower than asked for; callers that need an exact
 * column count must pad the remainder.
 */
export function truncateToWidth(text: string, columns: number): string {
  if (columns <= 0) return '';
  if (ASCII_ONLY.test(text)) return text.slice(0, columns);
  let total = 0;
  let out = '';
  let rest = text;
  // Walk cluster by cluster, copying SGR sequences through UNCOUNTED: the cut
  // is measured in drawn columns, and a restyle is not one. (A cut landing
  // between an SGR pair leaves the style open — unreachable for the wrapped,
  // pre-fitted rows this package truncates.)
  while (rest !== '') {
    const sgr = SGR_PREFIX.exec(rest)?.[0];
    if (sgr !== undefined) {
      out += sgr;
      rest = rest.slice(sgr.length);
      continue;
    }
    const cluster = clusters.segment(rest).containing(0)?.segment ?? '';
    if (cluster === '') break;
    const width = clusterWidth(cluster);
    if (total + width > columns) break;
    total += width;
    out += cluster;
    rest = rest.slice(cluster.length);
  }
  return out;
}

/**
 * Break `word` onto rows of at most `columns` columns, cutting only on grapheme
 * cluster boundaries. Used when a single word does not fit any row at all.
 *
 * `firstColumns` is the budget for the FIRST piece only, which is how an
 * over-long word can be split onto a row that already carries its line's
 * indentation. It defaults to the full budget.
 *
 * A cluster WIDER than the whole budget is emitted on a row of its own and
 * overflows it — the alternative is to make no progress, which is how a wrap
 * loops forever. Unreachable at the popup's real budget; guarded because a wrap
 * that can spin is a hang, not a rendering glitch.
 */
function splitWord(
  word: string,
  columns: number,
  firstColumns: number = columns,
): string[] {
  const rows: string[] = [];
  let line = '';
  let used = 0;
  let budget = firstColumns;
  for (const { segment } of clusters.segment(word)) {
    const width = clusterWidth(segment);
    if (line !== '' && used + width > budget) {
      rows.push(line);
      line = '';
      used = 0;
      budget = columns;
    }
    line += segment;
    used += width;
  }
  if (line !== '') rows.push(line);
  return rows;
}

/** The leading whitespace of a logical line — its indentation. */
const LEADING_WHITESPACE = /^\s*/;

/** Splits on whitespace runs while KEEPING them as tokens of their own. */
const KEEPING_WHITESPACE = /(\s+)/;

/** A token that is entirely whitespace, i.e. a separator rather than a word. */
const WHITESPACE_ONLY = /^\s+$/;

/**
 * Soft-wrap `text` to rows of at most `columns` DISPLAY COLUMNS.
 *
 * The complement of `truncateToWidth`: where that one drops the tail that does
 * not fit, this one moves it to the next row. Both measure in the same unit,
 * which is the point — a wrap measured in code units (`String.length`) is one
 * column short per wide character, so its rows would still be clipped by the
 * `fitLine` that draws them (BB-257 D1 / R5).
 *
 * Word-preferring: whole words are kept together while they fit, and only a word
 * longer than the budget is split. Each `\n` in `text` is a paragraph break and
 * always starts a new row, so an empty line stays an empty row — the renderer's
 * one-entry-one-row invariant holds for the result.
 *
 * A budget of zero or less yields the logical lines UNWRAPPED rather than an
 * empty list or an endless loop.
 *
 * WHITESPACE-FAITHFUL within a logical line: the leading indentation is kept (on
 * the FIRST row of that line), and interior runs are kept verbatim — `foo␣␣bar`
 * renders as `foo␣␣bar`. That is not cosmetic. What this wraps is what the writer
 * is typing, and a bakers.build description is Markdown (`bb_rich`): an indented list
 * item and a deliberate double space are content, so collapsing them would show
 * the writer something other than what they typed and than what gets submitted —
 * the very defect AC-1 exists to remove (BB-257 D1, "no character is ever
 * lost"). The ONE exception is deliberate: the whitespace run AT which a row
 * breaks is consumed by the break, as in every soft wrap. Every non-break
 * whitespace character survives.
 *
 * There USED to be a sibling `wrap()` in `Component/edit-form` that normalised
 * whitespace instead, kept on the argument that it wraps a SERVER ERROR MESSAGE
 * nobody is authoring (BB-257 R6). That argument held for the whitespace and
 * missed the unit: it measured in UTF-16 code units, so a translated 403 wrapped
 * one column short per wide character and the frame clipped it. It is gone —
 * this is the ONE wrap in the package, and both popups measure through it.
 */
export function wrapToWidth(text: string, columns: number): string[] {
  return wrapToWidthRows(text, columns).map((row) => row.row);
}

/** One wrapped row, annotated with WHERE its text came from. */
export interface WrappedRow {
  /** The row's text — always a verbatim substring of the wrapped `text`. */
  row: string;
  /** The offset in `text` (UTF-16 code units) of the row's FIRST character.
   *  Because every row is verbatim, the character at source offset `from + k`
   *  is `row[k]` — which is how a logical cursor offset is translated onto the
   *  wrapped rows without reverse-engineering them (BB-283). The whitespace
   *  a soft break consumes simply leaves a gap between one row's end and the
   *  next row's `from`. */
  from: number;
}

/**
 * The offset-aware twin of `wrapToWidth` — the same wrap, the same rows, each
 * carrying the source offset of its first character.
 *
 * BB-283: a text field's caret sits at a CHARACTER OFFSET into the value,
 * and `wrapToWidth`'s output alone cannot say which row that offset lands on —
 * the whitespace run a soft break eats is exactly what a reverse mapping
 * cannot recover. So the wrap itself reports the mapping while it still knows
 * it, and `wrapToWidth` remains a thin projection over this.
 */
export function wrapToWidthRows(text: string, columns: number): WrappedRow[] {
  if (columns <= 0) {
    let at = 0;
    return text.split('\n').map((row) => {
      const wrapped = { row, from: at };
      at += row.length + 1;
      return wrapped;
    });
  }
  const rows: WrappedRow[] = [];
  // The offset in `text` at which the current paragraph starts.
  let paragraphFrom = 0;
  for (const paragraph of text.split('\n')) {
    const rawIndent = LEADING_WHITESPACE.exec(paragraph)?.[0] ?? '';
    // An indent alone wider than the whole budget is degenerate; clip it rather
    // than emit a row the frame would truncate with an ellipsis.
    const indent =
      displayWidth(rawIndent) > columns
        ? truncateToWidth(rawIndent, columns)
        : rawIndent;
    let line = indent;
    let used = displayWidth(line);
    // The source offset of `line`'s first character — the paragraph's start,
    // since every row of a paragraph but a broken word's continuation carries
    // either the indent or a token starting there.
    let lineFrom = paragraphFrom;
    // Whether the row already holds a word — i.e. whether breaking before the
    // next one would leave an indent-only row behind.
    let hasWord = false;
    // The whitespace run seen since the last word, held back until we know
    // whether it separates two words on this row or is consumed by a break.
    let pending = '';

    const body = paragraph.slice(rawIndent.length);
    // The offset in `text` of the current token: `split` gives no positions,
    // so they are rebuilt by accumulation — every token is verbatim.
    let tokenFrom = paragraphFrom + rawIndent.length;
    for (const token of body.split(KEEPING_WHITESPACE)) {
      const at = tokenFrom;
      tokenFrom += token.length;
      if (token === '') continue;
      if (WHITESPACE_ONLY.test(token)) {
        pending = token;
        continue;
      }
      const width = displayWidth(token);
      const separator = displayWidth(pending);
      if (used + separator + width <= columns) {
        line += pending + token;
        used += separator + width;
        pending = '';
        hasWord = true;
        continue;
      }
      // The word does not fit: this is the break, and it eats `pending`.
      pending = '';
      if (hasWord) {
        rows.push({ row: line, from: lineFrom });
        line = '';
        used = 0;
        if (width <= columns) {
          line = token;
          lineFrom = at;
          used = width;
          continue;
        }
        const pieces = splitWord(token, columns);
        // The pieces of a split word are verbatim and contiguous, so each
        // piece's offset follows from the length of the ones before it.
        let pieceFrom = at;
        for (const piece of pieces.slice(0, -1)) {
          rows.push({ row: piece, from: pieceFrom });
          pieceFrom += piece.length;
        }
        line = pieces[pieces.length - 1] ?? '';
        lineFrom = pieceFrom;
        used = displayWidth(line);
        continue;
      }
      // Only the indent is on the row. Do not break — that would leave a row of
      // pure whitespace behind; hard-split the word into what the indent left.
      const remainder = columns - used;
      const pieces =
        remainder > 0
          ? splitWord(token, columns, remainder)
          : ['', ...splitWord(token, columns)];
      const merged = [line + (pieces[0] ?? ''), ...pieces.slice(1)];
      // `merged[0]` starts at the indent; each further piece is a verbatim
      // continuation of the token, its offset accumulated as above.
      if (merged.length > 1) {
        rows.push({ row: merged[0] ?? '', from: lineFrom });
        let pieceFrom = at + (pieces[0] ?? '').length;
        for (const piece of merged.slice(1, -1)) {
          rows.push({ row: piece, from: pieceFrom });
          pieceFrom += piece.length;
        }
        line = merged[merged.length - 1] ?? '';
        lineFrom = pieceFrom;
      } else {
        line = merged[0] ?? '';
      }
      used = displayWidth(line);
      hasWord = true;
    }

    // A trailing run is not a break point, so it survives — up to the budget,
    // beyond which it could only be clipped by the frame anyway.
    if (pending !== '') line += truncateToWidth(pending, columns - used);
    rows.push({ row: line, from: lineFrom });
    paragraphFrom += paragraph.length + 1;
  }
  return rows;
}
