#!/usr/bin/env node
// BB-241 Amendment B — generate `src/lib/width-table.ts` from the vendored
// `data/EastAsianWidth.txt`.
//
// WHY THIS EXISTS. The table it writes used to be hand-listed, and a hand-listed
// table drifts: diffed against Unicode it measured 361 real `EAW=W`/`F` code
// points as ONE column (`U+2630..2637`, `U+4DC0..4DFF`, `U+1AFF0..1AFFE`,
// `U+1D300..1D356`, `U+1F6DC..1F6DF`, `U+1F7F0` among them) and over-claimed 2
// for the Ambiguous block `U+3248..324F`. The title and meta chrome rows have
// ZERO column slack — `'│ ' + fitLine(x, width - 4) + ' │'` is exactly `width`,
// and `title` is user data — so a single under-measured column makes the row
// `width + 1`, wraps it, turns the six-row chrome into seven, and lands every
// click one row too high. That is the Amendment A defect with a different
// character, so the table stopped being curated and became derived.
//
// The generator prints to stdout; `src/lib/width-table.ts` IS that output, and
// `tests/lib/width-table.test.ts` re-runs this script and compares byte for byte,
// so a refreshed data file without a regenerated table fails the suite.
//
// Usage: pnpm --filter @bakers-build/addon-bakers-ui run generate:width-table
//        (which is `node scripts/generate-width-table.mjs > src/lib/width-table.ts`)

import { readFileSync } from 'node:fs';

const DATA = new URL('../data/EastAsianWidth.txt', import.meta.url);
const source = readFileSync(DATA, 'utf8');

const version = (source.split('\n')[0] ?? '')
  .replace(/^#\s*EastAsianWidth-/, '')
  .replace(/\.txt\s*$/, '')
  .trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(
    `could not read the Unicode version from the data file's first line: ${version}`,
  );
}

// Collect every code point Unicode classifies `W` (Wide) or `F` (Fullwidth).
// Ambiguous (`A`) is deliberately excluded: the box-drawing characters the frame
// is built from, plus `·`, `▸`/`▾` and `…`, are all Ambiguous, and terminals
// render them narrow — widening them would break the geometry the other way.
const ranges = [];
for (const line of source.split('\n')) {
  const body = line.split('#')[0]?.trim();
  if (!body) continue;
  const [rangeText, cls] = body.split(';').map((s) => s.trim());
  if (cls !== 'W' && cls !== 'F') continue;
  const [loText, hiText] = rangeText.split('..');
  const lo = Number.parseInt(loText, 16);
  const hi = hiText === undefined ? lo : Number.parseInt(hiText, 16);
  if (Number.isNaN(lo) || Number.isNaN(hi)) {
    throw new Error(`unparsable range: ${line}`);
  }
  ranges.push([lo, hi]);
}
if (ranges.length === 0)
  throw new Error('no W/F ranges found — wrong data file?');

ranges.sort((a, b) => a[0] - b[0]);

// Merge adjacent and overlapping ranges so the binary search runs over as few
// entries as the data allows.
const merged = [];
for (const [lo, hi] of ranges) {
  const last = merged[merged.length - 1];
  if (last && lo <= last[1] + 1) {
    last[1] = Math.max(last[1], hi);
    continue;
  }
  merged.push([lo, hi]);
}

const hex = (n) => `0x${n.toString(16)}`;
const rows = merged.map(([lo, hi]) => `  [${hex(lo)}, ${hex(hi)}],`).join('\n');
const count = merged.reduce((sum, [lo, hi]) => sum + (hi - lo + 1), 0);

process.stdout.write(`// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Regenerate with:
//   pnpm --filter @bakers-build/addon-bakers-ui run generate:width-table
//
// Source: EastAsianWidth-${version}.txt (Unicode ${version}), vendored at
// \`addons/bakers-ui/data/EastAsianWidth.txt\`. Generator:
// \`addons/bakers-ui/scripts/generate-width-table.mjs\`.
//
// Contents: every code point Unicode classifies East_Asian_Width \`W\` (Wide) or
// \`F\` (Fullwidth) — ${count} code points in ${merged.length} merged ranges. These
// occupy TWO terminal columns. \`Ambiguous\` (\`A\`) is deliberately absent: the
// box-drawing frame characters, \`·\`, \`▸\`/\`▾\` and \`…\` are all Ambiguous and
// terminals render them narrow, so widening them would break the TUI's row
// geometry in the other direction.
//
// \`tests/lib/width-table.test.ts\` re-runs the generator and compares its output
// with this file byte for byte, so refreshing the data file without regenerating
// fails the suite.

/** The Unicode version the ranges below were generated from. */
export const UNICODE_VERSION = '${version}';

/** Sorted, non-overlapping, non-adjacent — binary-searched by \`lib/width.ts\`. */
export const WIDE_RANGES: readonly (readonly [number, number])[] = [
${rows}
];
`);
