// BB-241 Amendment B — an INDEPENDENT display-width oracle for the AC-13
// geometry check.
//
// Why this file exists: `tests/Kernel/render-geometry.test.ts` used to assert
// `displayWidth(row) <= width` with `displayWidth` — the function under test. A
// SYSTEMATIC under-measurement therefore passed by construction: a row that a
// real terminal renders at `width + 1` columns measures `width` to a buggy
// measurer, and the assertion holds while the terminal wraps the line and shifts
// every body row below it. That is precisely the Amendment A defect, and the
// test could not have caught it.
//
// WHAT THIS ORACLE PROVES: it shares the Unicode ground truth with
// `src/lib/width.ts` — both read the same vendored `data/EastAsianWidth.txt` —
// and shares Node's own grapheme segmenter, but NOT ONE LINE of the code under
// test: not the generated range table, not the binary search, not the cluster
// rule, not the iteration. A bug in any of those five is caught here.
//
// WHAT IT DOES NOT PROVE: that the Unicode data itself matches what a specific
// terminal emulator does. Both sides read the same file, so a disagreement
// between Unicode and (say) a terminal that renders `⚠️` narrow is invisible to
// this check by construction. It is a check of INTERNAL consistency against the
// standard, not of any one emulator's behaviour — the emulator half is what the
// plan's manual walkthrough covers.

import { readFileSync } from 'node:fs';

const DATA = new URL('../../data/EastAsianWidth.txt', import.meta.url);

interface EawRange {
  lo: number;
  hi: number;
  cls: string;
}

let cache: EawRange[] | null = null;

/**
 * Every explicit range of `EastAsianWidth.txt`, in file order. Deliberately a
 * plain array walked LINEARLY below — the code under test binary-searches a
 * merged table, so a boundary bug in that search cannot hide here.
 */
export function eawRanges(): EawRange[] {
  if (cache) return cache;
  const ranges: EawRange[] = [];
  for (const line of readFileSync(DATA, 'utf8').split('\n')) {
    const body = line.split('#')[0]?.trim();
    if (!body) continue;
    const [rangeText, cls] = body.split(';').map((s) => s.trim());
    if (!rangeText || !cls) continue;
    const [loText, hiText] = rangeText.split('..');
    if (!loText) continue;
    const lo = Number.parseInt(loText, 16);
    const hi = hiText === undefined ? lo : Number.parseInt(hiText, 16);
    if (Number.isNaN(lo) || Number.isNaN(hi)) continue;
    ranges.push({ lo, hi, cls });
  }
  cache = ranges;
  return ranges;
}

/** The East_Asian_Width class of a code point. Unlisted code points default to
 *  `N` per the file's own `@missing: 0000..10FFFF; N` line. */
export function eawClass(codePoint: number): string {
  for (const r of eawRanges()) {
    if (codePoint >= r.lo && codePoint <= r.hi) return r.cls;
  }
  return 'N';
}

/** The Unicode version the vendored file declares, e.g. `17.0.0`. */
export function eawUnicodeVersion(): string {
  const first = readFileSync(DATA, 'utf8').split('\n')[0] ?? '';
  return first.replace(/^#\s*EastAsianWidth-/, '').replace(/\.txt\s*$/, '');
}

const oracleSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** U+FE0F VARIATION SELECTOR-16 — "render the preceding emoji as an emoji". */
const VARIATION_SELECTOR_16 = '️';

/**
 * The columns a grapheme cluster occupies, derived straight from the file's
 * classification plus the two emoji rules UAX #11 / TR #51 imply. Written as a
 * flat sequence of ifs on purpose: it is meant to be obviously correct by
 * reading, not efficient.
 */
function oracleClusterWidth(cluster: string): number {
  const first = cluster.codePointAt(0);
  if (first === undefined) return 0;
  // A cluster made ENTIRELY of marks/format/control characters occupies nothing.
  if (/^[\p{Mn}\p{Me}\p{Cf}\p{Cc}]+$/u.test(cluster)) return 0;
  const cls = eawClass(first);
  if (cls === 'W' || cls === 'F') return 2;
  // An emoji shown in emoji presentation is two columns wide even when its base
  // code point is Neutral or Ambiguous: either it defaults to emoji
  // presentation, or a U+FE0F variation selector asks for it explicitly.
  if (/^\p{Emoji_Presentation}/u.test(cluster)) return 2;
  if (cluster.includes(VARIATION_SELECTOR_16) && /^\p{Emoji}/u.test(cluster)) {
    return 2;
  }
  return 1;
}

/** The columns `text` occupies in a terminal, measured independently of
 *  `src/lib/width.ts`. */
export function oracleWidth(text: string): number {
  let total = 0;
  for (const { segment } of oracleSegmenter.segment(text)) {
    total += oracleClusterWidth(segment);
  }
  return total;
}
