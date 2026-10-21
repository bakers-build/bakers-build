/**
 * BB-326 — the one predicate the canonical key vocabulary exports to the rest
 * of the package.
 *
 * The vocabulary has exactly two halves: NAMED keys (`escape`, `up`,
 * `shift+tab`, `enter`, `ctrl+c`) and PRINTABLE characters, which are simply
 * themselves (`q`, `R`, `ä`, `' '`). A named form is always two or more
 * characters and a printable form is always exactly one code point, so the two
 * halves cannot collide — this function is that guarantee, written once.
 *
 * It lives in `lib/` rather than beside `keyEventToKeys` on purpose: `Form/`
 * asks this question and must not acquire a dependency on `@opentui/core`
 * through the ask. The Node test suite cannot load the renderer at all.
 *
 * The predicate replaced `!key.startsWith('\x1b') && key >= ' '`, which was
 * correct for bytes and actively wrong for names: `'escape' >= ' '` is true, so
 * pressing Escape in a text field would have typed the word "escape".
 */
export function isPrintableKey(key: string): boolean {
  const points = [...key];
  if (points.length !== 1) return false;
  const code = points[0]?.codePointAt(0) ?? 0;
  return code >= 0x20 && code !== 0x7f;
}
