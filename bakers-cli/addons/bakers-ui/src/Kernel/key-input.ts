import { type KeyEvent, type ParsedKey, parseKeypress } from '@opentui/core';
import { isPrintableKey } from '../lib/key-vocabulary.js';

const ESC = '\x1b';

/**
 * BB-326 — THE ONE PLACE IN THIS PACKAGE THAT KNOWS AN ENCODING EXISTS.
 *
 * OpenTUI parses keys; this turns a parsed key into the single canonical string
 * the cockpit compares against. `Screen.handleInput(input: string)` keeps its
 * signature — changing it would churn all 58 `Entity/` screens instead of the 14
 * that actually compare — but the string now carries a NAME, not bytes:
 * `escape`, `up`, `shift+tab`, `enter`, `ctrl+c`, and printable characters as
 * themselves (`q`, `R`, `ä`, `' '`).
 *
 * ---------------------------------------------------------------------------
 * WHY THE BYTES HAD TO GO — THREE FAILURES, ONE CAUSE
 * ---------------------------------------------------------------------------
 *
 * The kernel used to hand screens the raw bytes and every site asked
 * `key === '\x1b'`. That failed three times in the operator's hands, and every
 * time the PARSER WAS RIGHT and our byte comparison threw the answer away:
 *
 *  1. A coalescing link (mosh) delivered Escape glued to the next key. The
 *     parser reported one ALT chord, `name: 'escape'` — but `\x1b\x1b` is not
 *     `\x1b`.
 *  2. Their Ghostty sends Escape as `\x1b[27u`, the Kitty protocol's CSI-u form,
 *     while arrows still arrive as `\x1b[C`. `name: 'escape'` again correct,
 *     again not equal to the literal.
 *  3. Ctrl+C stayed dead even after a CSI-u resolver was added, and THIS is the
 *     one that ends the approach: for a printable key the parser normalises
 *     `sequence` down to the base character and keeps the chord only in the
 *     flags. Ctrl+C arrives as `name: 'c'`, `ctrl: true`, `sequence: 'c'` — the
 *     CSI-u bytes are already gone, so no byte-matching resolver could ever see
 *     them. Meanwhile the ladder received a bare `'c'`, which several screens
 *     bind to "clear filters": the defect did not fail to quit, it did
 *     something else.
 *
 * `sequence` is not uniform (it keeps the CSI-u bytes for a NAMED key and
 * discards them for a PRINTABLE one), so it cannot be the source of truth.
 * `name` plus the modifier flags is the only field set that is.
 */

/** `\r` and `\n` are two parser names for one intent. All eight sites that
 *  compared them as a pair meant "the user committed the current thing", so the
 *  pair collapses to one canonical key rather than being carried forward. */
const NAME_ALIASES: Record<string, string> = {
  return: 'enter',
  linefeed: 'enter',
};

/**
 * The canonical name for one parsed key.
 *
 * Order is load-bearing. The chord check runs BEFORE the printable check
 * because Ctrl+C's `sequence` is itself a printable single character (`'c'`);
 * reading it first is exactly the bug in failure 3 above.
 *
 * Shift is deliberately NOT a prefix on a printable key: the parser lowercases
 * the name (`R` is `name: 'r'`, `shift: true`) while `sequence` carries the
 * shifted character, so taking the character preserves the case the cockpit
 * binds on — `R` reloads, `r` does not — with no special case. Shift becomes a
 * prefix only on keys that are not printable, which in practice is `shift+tab`.
 */
function canonicalKey(key: ParsedKey): string {
  const ctrl = key.ctrl === true;
  // The parser sets `meta` and `option` for the same Alt press on different
  // paths; either one means Alt.
  const alt = key.meta === true || key.option === true;
  const superKey = key.super === true;
  const hyper = key.hyper === true;
  const sequence = key.sequence ?? '';
  if (!ctrl && !alt && !superKey && !hyper && isPrintableKey(sequence))
    return sequence;
  const name = key.name !== undefined && key.name !== '' ? key.name : sequence;
  const base = NAME_ALIASES[name] ?? name;
  const modifiers: string[] = [];
  if (ctrl) modifiers.push('ctrl');
  if (alt) modifiers.push('alt');
  if (key.shift === true) modifiers.push('shift');
  if (superKey) modifiers.push('super');
  if (hyper) modifiers.push('hyper');
  return [...modifiers, base].join('+');
}

/**
 * ---------------------------------------------------------------------------
 * WHY THIS RETURNS A LIST: ONE EVENT CAN CARRY MORE THAN ONE KEYPRESS
 * ---------------------------------------------------------------------------
 *
 * Escape is the prefix of every CSI sequence, so the parser cannot classify a
 * lone `\x1b` when it lands — it holds the byte for `DEFAULT_TIMEOUT_MS = 20`
 * (`@opentui/core@0.5.1`, `src/lib/stdin-parser.ts`) to see whether a `[`
 * follows. Whatever else arrives inside that window is MERGED with the Escape
 * and reported as one ALT chord: `\x1b` then `j` becomes a single event with
 * `sequence: '\x1bj'`, `meta: true`.
 *
 * Comparing `name` does NOT fix that on its own — the merged event is named `j`,
 * and `\x1b\x1b[B` is named `down` with the Escape folded away entirely. So the
 * unmerge stays load-bearing after the vocabulary swap.
 *
 * That merge is a DELIVERY property, which is why it does not show up on a fast
 * local link and does on the operator's. Measured with real mosh 1.4.0 over a
 * ~180 ms link: three Escape taps 40 ms apart reach the far pty as two writes —
 * `[1b]`, then `[1b 1b]`.
 *
 * So this UNMERGES, and it does so by CLASSIFYING rather than by re-timing.
 * Widening the 20 ms window would only move the boundary; a link that coalesces
 * at all can always deliver inside whatever window is chosen. The structure of
 * the bytes is decidable with no clock:
 *
 *   a real CSI or SS3 sequence always has `[` or `O` at index 1
 *   — `\x1b[A`, `\x1b[Z`, `\x1b[3~`, `\x1b[1;3A`, `\x1bOP` —
 *   and a leading Escape that got glued to a following key never does
 *   — `\x1b\x1b`, `\x1bj`, `\x1b\r`, `\x1b\x1b[B`.
 *
 * While the sequence begins with an Escape that is NOT introducing a CSI or SS3
 * sequence, peel that Escape off as its own keypress and RE-PARSE the rest.
 * Re-parsing is what makes carrying the Alt modifier safe: the re-parsed tail of
 * `\x1bj` is a plain `j` with `meta: false`, while a genuine Alt chord
 * (`\x1b[1;3A`) peels nothing and keeps its modifier, becoming an inert
 * `alt+up`. The CSI vocabulary is unreachable by this loop by construction, not
 * by a list of exceptions that could fall out of date.
 *
 * The one behaviour this deliberately changes is a genuine legacy ALT chord:
 * `Alt+j` reads as Escape then `j`. On the legacy wire those are literally the
 * same bytes, the cockpit binds no ALT combination anywhere, and the pre-swap
 * kernel already behaved this way whenever the two bytes landed in separate
 * chunks — so this is the older contract restored, not a new one invented.
 *
 * The full table lives in `tests-bun/key-input.test.ts`.
 */
export function keyEventToKeys(event: KeyEvent): string[] {
  const delivered = event.sequence !== '' ? event.sequence : event.raw;
  let rest = delivered;
  const keys: string[] = [];
  while (
    rest.length > 1 &&
    rest[0] === ESC &&
    rest[1] !== '[' &&
    rest[1] !== 'O'
  ) {
    keys.push('escape');
    rest = rest.slice(1);
  }
  // Nothing was peeled: the event the parser handed us describes the whole key,
  // modifiers included. Re-parsing here would DISCARD a genuine CSI-u Alt chord,
  // whose `sequence` the parser has already normalised to a bare character.
  if (keys.length === 0) return [canonicalKey(event)];
  // Kitty parsing is additive: it resolves a CSI-u tail and leaves the legacy
  // vocabulary alone, so it is always the right way to read a remainder.
  const tail = parseKeypress(rest, { useKittyKeyboard: true });
  keys.push(tail !== null ? canonicalKey(tail) : rest);
  return keys;
}
