import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  charWidth,
  displayWidth,
  truncateToWidth,
} from '../../src/lib/width.js';
import { UNICODE_VERSION } from '../../src/lib/width-table.js';
import { eawRanges, eawUnicodeVersion } from '../support/eaw-oracle.js';

// BB-241 Amendment B — the width table is PINNED against the authoritative
// Unicode classification, and the generated file is pinned against its generator.
//
// The hand-listed table this replaces measured 361 real `EAW=W`/`F` code points
// as ONE column — `U+2630..2637`, `U+4DC0..4DFF`, `U+1AFF0..1AFFE`,
// `U+1D300..1D356`, `U+1F6DC..1F6DF`, `U+1F7F0` among them. The title and meta
// chrome rows have ZERO column slack (`'│ ' + fitLine(x, width - 4) + ' │'` is
// exactly `width`), and `title` is user data — so one under-measured column makes
// the row `width + 1`, wraps it, turns the six-row chrome into seven, and lands
// every click one row too high. That is the Amendment A defect with a different
// character, which is why the table is now GENERATED and checked rather than
// curated.

const WIDE_CLASSES = new Set(['W', 'F']);
/** The rule that outranks the width table: a mark/format/control code point
 *  occupies no column even when Unicode classifies it `W` (U+3099, U+302A…). */
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}\p{Cc}]$/u;

describe('the generated width table agrees with Unicode', () => {
  it('every W/F code point measures two columns', () => {
    const wrong: string[] = [];
    for (const range of eawRanges()) {
      if (!WIDE_CLASSES.has(range.cls)) continue;
      for (let cp = range.lo; cp <= range.hi; cp += 1) {
        const char = String.fromCodePoint(cp);
        if (ZERO_WIDTH.test(char)) continue;
        if (charWidth(char) !== 2) wrong.push(cp.toString(16).toUpperCase());
      }
    }
    expect(
      wrong.slice(0, 40),
      `${wrong.length} W/F code points measure != 2`,
    ).toEqual([]);
  });

  it('it does not over-claim: a non-W/F code point never measures two', () => {
    // The hand-listed table blanketed whole blocks, so `U+3248..324F` (class
    // `A`, Ambiguous) measured 2. Ambiguous MUST stay 1: the box-drawing frame,
    // `·`, `▸`/`▾` and `…` are all Ambiguous, and widening them would break the
    // geometry in the other direction.
    const wrong: string[] = [];
    for (const range of eawRanges()) {
      if (WIDE_CLASSES.has(range.cls)) continue;
      for (let cp = range.lo; cp <= range.hi; cp += 1) {
        const char = String.fromCodePoint(cp);
        if (ZERO_WIDTH.test(char)) continue;
        if (charWidth(char) === 2) wrong.push(cp.toString(16).toUpperCase());
      }
    }
    expect(
      wrong.slice(0, 40),
      `${wrong.length} non-W/F code points measure 2`,
    ).toEqual([]);
  });

  it('it names the Unicode version of the data it was generated from', () => {
    expect(UNICODE_VERSION).toBe(eawUnicodeVersion());
  });
});

describe('the checked-in generated table is up to date', () => {
  it('regenerating from the vendored data reproduces it byte for byte', () => {
    // The generator prints to stdout; the checked-in file is that output. If the
    // vendored `EastAsianWidth.txt` is ever refreshed without re-running the
    // generator, this is what says so.
    const generated = execFileSync(
      process.execPath,
      [
        new URL('../../scripts/generate-width-table.mjs', import.meta.url)
          .pathname,
      ],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    );
    const committed = readFileSync(
      new URL('../../src/lib/width-table.ts', import.meta.url),
      'utf8',
    );
    expect(generated).toBe(committed);
  });
});

describe('emoji presentation sequences measure two columns', () => {
  it('a base + U+FE0F sequence is two columns, not one', () => {
    // `⚠️` is U+26A0 (EAW=A → 1 column on its own) plus U+FE0F (a `Mn`, zeroed by
    // the mark rule). Measured code point by code point that is ONE column,
    // while every modern terminal renders it as two.
    expect(displayWidth('⚠️')).toBe(2);
    expect(displayWidth('▶️')).toBe(2);
    expect(displayWidth('❤️')).toBe(2);
    // A keycap sequence: '1' + U+FE0F + U+20E3.
    expect(displayWidth('1️⃣')).toBe(2);
  });

  it('a bare emoji base without U+FE0F keeps its own width', () => {
    // U+26A0 alone is Ambiguous — text presentation, one column. Widening it
    // would over-claim on the far more common non-emoji use.
    expect(displayWidth('⚠')).toBe(1);
    // A default-emoji-presentation code point is two columns with or without it.
    expect(displayWidth('🛜')).toBe(2);
    expect(displayWidth('🛜️')).toBe(2);
  });

  it('the newly covered wide ranges measure two columns', () => {
    // One representative per range the hand-listed table missed.
    expect(displayWidth('☰'), 'U+2630 TRIGRAM FOR HEAVEN').toBe(2);
    expect(displayWidth('䷀'), 'U+4DC0 HEXAGRAM FOR THE CREATIVE').toBe(2);
    expect(displayWidth('𫿰'), 'U+1AFF0 KATAKANA LETTER MINNAN TONE-2').toBe(2);
    expect(displayWidth('𝌀'), 'U+1D300 MONOGRAM FOR EARTH').toBe(2);
    expect(displayWidth('🛜'), 'U+1F6DC WIRELESS').toBe(2);
    expect(displayWidth('🟰'), 'U+1F7F0 HEAVY EQUALS SIGN').toBe(2);
  });

  it('the frame characters and the list glyphs stay narrow', () => {
    // Ambiguous, and the geometry depends on them being 1.
    for (const glyph of ['╭', '─', '╮', '│', '╰', '╯', '·', '▸', '▾', '…']) {
      expect(displayWidth(glyph), glyph).toBe(1);
    }
  });
});

describe('truncateToWidth respects grapheme clusters', () => {
  it('it never splits an emoji presentation sequence', () => {
    // Cutting between the base and U+FE0F would leave the base rendered in TEXT
    // presentation — one column, not the two the row was budgeted for — so the
    // row would come back a column short and the padding would be wrong.
    const text = 'ab⚠️cd';
    for (let budget = 0; budget <= 8; budget += 1) {
      const out = truncateToWidth(text, budget);
      const half = out.endsWith('⚠') && !out.endsWith('⚠️');
      expect(
        half,
        `budget ${budget} split the sequence: ${JSON.stringify(out)}`,
      ).toBe(false);
      expect(
        displayWidth(out),
        `budget ${budget} overshot`,
      ).toBeLessThanOrEqual(budget);
    }
    // With exactly the columns for it, the sequence survives whole.
    expect(truncateToWidth(text, 4)).toBe('ab⚠️');
    // One column short of it, neither half is emitted.
    expect(truncateToWidth(text, 3)).toBe('ab');
  });

  it('it never splits a combining sequence or a ZWJ emoji', () => {
    // `e` + U+0301 COMBINING ACUTE ACCENT: one cluster, one column.
    expect(truncateToWidth('éx', 1)).toBe('é');
    // A ZWJ family sequence is one cluster of two columns.
    const family = '👨‍👩‍👧';
    expect(displayWidth(family)).toBe(2);
    expect(truncateToWidth(family, 1)).toBe('');
    expect(truncateToWidth(family, 2)).toBe(family);
  });
});
