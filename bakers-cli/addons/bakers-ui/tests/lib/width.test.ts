import { describe, expect, it } from 'vitest';
import {
  displayWidth,
  truncateToWidth,
  wrapToWidth,
} from '../../src/lib/width.js';

// BB-241 Amendment A (spec D11) — display width is the row model's unit. The
// TUI's whole row geometry rests on "one rendered entry is one physical row",
// and that is only true if the padding/truncation primitives measure COLUMNS
// rather than UTF-16 code units. `⚡` (U+26A1) is the character that falsified
// it: one code unit, two display columns.

describe('displayWidth', () => {
  it('displayWidth counts East-Asian wide characters as two columns', () => {
    expect(displayWidth('⚡')).toBe(2);
    expect(displayWidth('bakers.build')).toBe(4);
    expect(displayWidth('╭─')).toBe(2);
    expect(displayWidth('日本')).toBe(4);
    expect(displayWidth('')).toBe(0);
    // The exact prefix `renderScreen` builds its top frame from: 10 code units,
    // 11 columns. That gap is the whole defect.
    expect('╭─ ⚡ bakers.build '.length).toBe(10);
    expect(displayWidth('╭─ ⚡ bakers.build ')).toBe(11);
  });

  it('displayWidth ignores combining marks', () => {
    expect(displayWidth('é'), 'e + combining acute').toBe(1);
    expect(displayWidth('àb')).toBe(2);
    // A variation selector is a combining mark too, so an emoji presentation
    // sequence still measures as its base character.
    expect(displayWidth('⚡️')).toBe(2);
  });
});

describe('truncateToWidth', () => {
  it('truncateToWidth never cuts a wide character in half', () => {
    expect(truncateToWidth('a⚡b', 2)).toBe('a');
    expect(truncateToWidth('⚡⚡', 3)).toBe('⚡');
    expect(truncateToWidth('⚡⚡', 4)).toBe('⚡⚡');
  });

  it('truncateToWidth is the identity below the budget', () => {
    expect(truncateToWidth('abc', 10)).toBe('abc');
    expect(truncateToWidth('abc', 3)).toBe('abc');
    expect(truncateToWidth('', 5)).toBe('');
    expect(truncateToWidth('abc', 0)).toBe('');
  });
});

// BB-257 D1 — soft wrap, the OTHER half of the row budget. `fitLine` truncates
// what does not fit; a writer typing into the New-ticket popup needs the tail
// moved to the next row instead. Both must measure in the SAME unit (spec R5),
// which is why this lives beside `truncateToWidth` rather than beside the
// component: `Component/edit-form`'s local `wrap()` measures `String.length` and
// is therefore one column short per wide character. That duplication is left
// standing deliberately (spec R6); this function is the display-column one.

describe('wrapToWidth', () => {
  it('hard-splits an over-long word and loses no character', () => {
    const word = 'a'.repeat(200);
    const rows = wrapToWidth(word, 20);
    expect(rows).toHaveLength(10);
    for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(20);
    expect(rows.join('')).toBe(word);
  });

  it('prefers a word boundary over a mid-word break', () => {
    const rows = wrapToWidth('the quick brown fox jumps over', 11);
    for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(11);
    // Greedy word wrap: as many whole words per row as fit.
    expect(rows).toEqual(['the quick', 'brown fox', 'jumps over']);
  });

  it('measures in DISPLAY COLUMNS, not code units', () => {
    // 40 code units, 80 columns. A `String.length` wrap would emit rows of 10
    // code units = 20 columns, i.e. double the budget — exactly the drift R5
    // names.
    const run = '⚡'.repeat(40);
    const rows = wrapToWidth(run, 10);
    for (const row of rows) expect(displayWidth(row)).toBe(10);
    expect(rows.join('')).toBe(run);

    const cjk = '日本語のテキストはここで折り返される';
    for (const row of wrapToWidth(cjk, 9)) {
      expect(displayWidth(row)).toBeLessThanOrEqual(9);
    }
    expect(wrapToWidth(cjk, 9).join('')).toBe(cjk);
  });

  it('keeps an embedded newline as a paragraph break', () => {
    expect(wrapToWidth('one\n\ntwo', 20)).toEqual(['one', '', 'two']);
    // Each paragraph wraps on its own, and the break survives the wrap.
    expect(wrapToWidth('aaa bbb\nccc ddd', 4)).toEqual([
      'aaa',
      'bbb',
      'ccc',
      'ddd',
    ]);
  });

  it('leaves the input unwrapped when the budget is zero or negative', () => {
    // Not a loop and not an empty list: a degenerate budget yields the logical
    // lines verbatim, so a caller can never spin on it.
    expect(wrapToWidth('a b c', 0)).toEqual(['a b c']);
    expect(wrapToWidth('a\nb', -5)).toEqual(['a', 'b']);
  });

  it('terminates on a cluster wider than the whole budget, keeping it', () => {
    // Unreachable at the real popup budget (54), but a hard split that cannot
    // make progress is exactly how a wrap loops forever.
    expect(wrapToWidth('⚡⚡', 1)).toEqual(['⚡', '⚡']);
  });
});

// BB-257 D1, whitespace fidelity — "so no character is ever lost" is not
// satisfied by keeping every WORD. What the create popup wraps is what the
// writer is typing, and a bakers.build description is Markdown (`bb_rich`): an
// indented list item and a deliberate double space are content. Collapsing them
// re-creates, inside the wrap, the very defect AC-1 exists to remove — the
// writer cannot see what they are typing. The single exception is the
// whitespace run AT which a row breaks: that run is consumed by the break, as in
// every soft wrap. Every other whitespace character survives.

describe('wrapToWidth whitespace fidelity', () => {
  it('preserves an interior whitespace run on a row that fits', () => {
    expect(wrapToWidth('foo  bar', 20)).toEqual(['foo  bar']);
    expect(wrapToWidth('a  b   c', 20)).toEqual(['a  b   c']);
  });

  it('preserves the leading indentation of a logical line', () => {
    expect(wrapToWidth('  - item', 20)).toEqual(['  - item']);
    // Each `\n`-separated logical line keeps its own indent.
    expect(wrapToWidth('- top\n  - nested\n    - deeper', 20)).toEqual([
      '- top',
      '  - nested',
      '    - deeper',
    ]);
  });

  it('keeps the indent on the first row of a wrapped indented line', () => {
    const typed = '  - the quick  brown fox jumps over the lazy dog';
    const rows = wrapToWidth(typed, 20);
    for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(20);
    expect(rows).toEqual([
      '  - the quick  brown',
      'fox jumps over the',
      'lazy dog',
    ]);
    // Every space that is not a break point survives: the input's spaces minus
    // the one consumed per break.
    const spaces = (s: string): number => (s.match(/ /g) ?? []).length;
    expect(rows.reduce((n, r) => n + spaces(r), 0)).toBe(
      spaces(typed) - (rows.length - 1),
    );
  });

  it('rejoining the rows at their break points reproduces the input', () => {
    // Whitespace-heavy on purpose: a leading indent, interior double spaces and
    // a trailing run, none of which lands on a break point here.
    const typed = '  a  b  c dddddddddd eeeeeeeeee ffffffffff gg  ';
    const rows = wrapToWidth(typed, 22);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(22);
    expect(rows.join(' ')).toBe(typed);
  });
});
