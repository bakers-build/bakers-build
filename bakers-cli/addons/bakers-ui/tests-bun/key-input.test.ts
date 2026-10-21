import { describe, expect, test } from 'bun:test';
import { type ParsedKey, parseKeypress } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { keyEventToKeys } from '../src/Kernel/key-input.js';

/**
 * BB-326 — the cockpit's key vocabulary is OpenTUI's PARSED one, not the bytes.
 *
 * `Screen.handleInput(input: string)` keeps its signature; what changes is what
 * the string carries. `keyEventToKeys` derives a canonical name from
 * `KeyEvent.name` plus the modifier flags, and reads `sequence` only for the
 * printable branch and as the fallback for an event the parser could not name.
 *
 * WHY EVERY EVENT IN THIS FILE COMES FROM `parseKeypress` AND NOT FROM A LITERAL
 * ------------------------------------------------------------------------------
 * The previous revision of this table built its events by hand —
 * `{ sequence: '\x1b[99;5u', raw: … }` — and that is precisely how the Ctrl+C
 * defect survived a green suite. The real parser does NOT leave that sequence
 * intact: for a printable key it normalises `sequence` down to the base
 * character and keeps the chord only in the flags, so the real Ctrl+C event
 * carries `sequence: 'c'`, `ctrl: true`. The hand-written event asserted against
 * a shape the parser never produces, so the resolver that read `sequence` passed
 * its test and shipped dead.
 *
 * Every row below therefore states BYTES and runs them through the same
 * `parseKeypress` the renderer uses. A test can no longer agree with its subject
 * about a shape neither of them will meet in production.
 */

/** The renderer resolves `useKittyKeyboard: null` per terminal. A terminal that
 *  speaks CSI-u gets kitty parsing (proved by the operator's trace, where
 *  `\x1b[27u` arrives named `escape`); one that does not, does not. Rows state
 *  which wire they are on, because the point of the vocabulary is that both
 *  wires land on the same canonical name. */
type Wire = 'legacy' | 'csi-u';

function eventFor(bytes: string, wire: Wire): ParsedKey {
  const parsed = parseKeypress(bytes, { useKittyKeyboard: wire === 'csi-u' });
  if (parsed === null) throw new Error(`parser returned null for ${bytes}`);
  return parsed;
}

function keysFor(bytes: string, wire: Wire): string[] {
  return keyEventToKeys(eventFor(bytes, wire) as never);
}

/**
 * The BB-326 key mapping table.
 * Every literal the audit found under `src/` has a row, on BOTH wires wherever
 * the terminal has a choice — that equivalence is the whole deliverable.
 */
const VOCABULARY: Array<
  [label: string, bytes: string, wire: Wire, want: string]
> = [
  // Named keys — legacy wire.
  ['escape', '\x1b', 'legacy', 'escape'],
  ['up', '\x1b[A', 'legacy', 'up'],
  ['down', '\x1b[B', 'legacy', 'down'],
  ['right', '\x1b[C', 'legacy', 'right'],
  ['left', '\x1b[D', 'legacy', 'left'],
  ['tab', '\t', 'legacy', 'tab'],
  ['shift+tab', '\x1b[Z', 'legacy', 'shift+tab'],
  ['carriage return', '\r', 'legacy', 'enter'],
  ['line feed', '\n', 'legacy', 'enter'],
  ['backspace', '\x7f', 'legacy', 'backspace'],
  ['delete', '\x1b[3~', 'legacy', 'delete'],
  ['pageup', '\x1b[5~', 'legacy', 'pageup'],
  ['pagedown', '\x1b[6~', 'legacy', 'pagedown'],
  // Chords — legacy wire. These are the C0 control bytes.
  ['ctrl+c (quit)', '\x03', 'legacy', 'ctrl+c'],
  ['ctrl+s (submit)', '\x13', 'legacy', 'ctrl+s'],
  ['ctrl+d (done)', '\x04', 'legacy', 'ctrl+d'],
  // Printable characters keep themselves.
  ['space', ' ', 'legacy', ' '],
  ['printable ascii', 'a', 'legacy', 'a'],
  ['printable multibyte', 'ä', 'legacy', 'ä'],
  ['quit key', 'q', 'legacy', 'q'],
  ['vi down', 'j', 'legacy', 'j'],
  ['vi up', 'k', 'legacy', 'k'],
  ['search', '/', 'legacy', '/'],
  ['reload — a SHIFTED letter keeps its case', 'R', 'legacy', 'R'],
  ['bottom — a SHIFTED letter keeps its case', 'G', 'legacy', 'G'],
  ['unshifted r is NOT the reload key', 'r', 'legacy', 'r'],
  ['unshifted g is NOT the bottom key', 'g', 'legacy', 'g'],

  // The same keys on the CSI-u wire land on the SAME canonical names.
  ['escape via CSI-u — the reported defect', '\x1b[27u', 'csi-u', 'escape'],
  ['return via CSI-u', '\x1b[13u', 'csi-u', 'enter'],
  ['tab via CSI-u', '\x1b[9u', 'csi-u', 'tab'],
  ['shift+tab via CSI-u', '\x1b[9;2u', 'csi-u', 'shift+tab'],
  ['backspace via CSI-u', '\x1b[127u', 'csi-u', 'backspace'],
  ['space via CSI-u', '\x1b[32u', 'csi-u', ' '],
  ['printable ascii via CSI-u', '\x1b[97u', 'csi-u', 'a'],
  ['printable multibyte via CSI-u', '\x1b[228u', 'csi-u', 'ä'],
  ['ctrl+c via CSI-u — the second defect', '\x1b[99;5u', 'csi-u', 'ctrl+c'],
  ['ctrl+s via CSI-u', '\x1b[115;5u', 'csi-u', 'ctrl+s'],
  ['ctrl+d via CSI-u', '\x1b[100;5u', 'csi-u', 'ctrl+d'],
  ['shifted letter via CSI-u', '\x1b[114;2u', 'csi-u', 'R'],
  ['pageup via CSI-u', '\x1b[57354u', 'csi-u', 'pageup'],
  ['pagedown via CSI-u', '\x1b[57355u', 'csi-u', 'pagedown'],
];

describe('the canonical key vocabulary', () => {
  for (const [label, bytes, wire, want] of VOCABULARY) {
    test(`${label} (${wire}) -> ${JSON.stringify(want)}`, () => {
      expect(keysFor(bytes, wire)).toEqual([want]);
    });
  }
});

/**
 * The finding that decided the design, pinned so it cannot rot: the parser's
 * `sequence` is not uniform across CSI-u, so an adapter reading it cannot
 * recover a chord. If a future OpenTUI makes it uniform this test fails loudly
 * and the comment above stops being true — which is the point.
 */
describe('why `sequence` cannot be the source of truth', () => {
  test('ctrl+c via CSI-u arrives with `sequence` normalised to a bare `c`', () => {
    const event = eventFor('\x1b[99;5u', 'csi-u');
    expect(event.sequence).toBe('c');
    expect(event.ctrl).toBe(true);
    expect(event.name).toBe('c');
  });

  test('escape via CSI-u keeps the full CSI-u bytes in `sequence`', () => {
    const event = eventFor('\x1b[27u', 'csi-u');
    expect(event.sequence).toBe('\x1b[27u');
    expect(event.name).toBe('escape');
  });

  test('a bare `c` and Ctrl+C are indistinguishable by `sequence` alone', () => {
    expect(eventFor('\x1b[99;5u', 'csi-u').sequence).toBe(
      eventFor('c', 'legacy').sequence,
    );
    // ...and perfectly distinguishable by the vocabulary.
    expect(keysFor('\x1b[99;5u', 'csi-u')).toEqual(['ctrl+c']);
    expect(keysFor('c', 'legacy')).toEqual(['c']);
  });
});

/**
 * BB-326 — the unmerge, still load-bearing after the vocabulary swap.
 *
 * A coalescing link (mosh on the operator's phone) delivers Escape glued to
 * whatever follows, and the parser reports the pair as one ALT chord. Comparing
 * `name` does not fix that on its own: `\x1bj` is named `j` with `meta: true`,
 * so the Escape is still lost, and `\x1b\x1b[B` is named `down` with the Escape
 * folded away entirely.
 *
 * So the seam peels a leading Escape that is not introducing a CSI or SS3
 * sequence and RE-PARSES the remainder. Re-parsing is what clears the spurious
 * `meta` — a genuine Alt chord (`\x1b[1;3A`) peels nothing and keeps it.
 */
const UNMERGE: Array<[label: string, bytes: string, want: string[]]> = [
  ['lone escape', '\x1b', ['escape']],
  ['two escapes glued', '\x1b\x1b', ['escape', 'escape']],
  ['three escapes glued', '\x1b\x1b\x1b', ['escape', 'escape', 'escape']],
  ['escape then vi-down', '\x1bj', ['escape', 'j']],
  ['escape then return', '\x1b\r', ['escape', 'enter']],
  ['escape then quit', '\x1bq', ['escape', 'q']],
  ['escape then arrow-down', '\x1b\x1b[B', ['escape', 'down']],
  ['escape then shift+tab', '\x1b\x1b[Z', ['escape', 'shift+tab']],
  [
    'two escapes then delete',
    '\x1b\x1b\x1b[3~',
    ['escape', 'escape', 'delete'],
  ],
  // The CSI/SS3 vocabulary: index 1 is `[` or `O`, so the loop never runs.
  ['arrow up', '\x1b[A', ['up']],
  ['arrow down', '\x1b[B', ['down']],
  ['shift+tab', '\x1b[Z', ['shift+tab']],
  ['delete', '\x1b[3~', ['delete']],
  ['SS3 F1', '\x1bOP', ['f1']],
  // Keys carrying no Escape at all come through as one key.
  ['plain letter', 'a', ['a']],
  ['backspace', '\x7f', ['backspace']],
  ['ctrl+c', '\x03', ['ctrl+c']],
];

describe('keyEventToKeys unmerges a coalesced Escape', () => {
  for (const [label, bytes, want] of UNMERGE) {
    test(`${label}: ${JSON.stringify(bytes)} -> ${JSON.stringify(want)}`, () => {
      expect(keysFor(bytes, 'legacy')).toEqual(want);
    });
  }

  test('a genuine Alt chord peels nothing and stays a chord', () => {
    // `\x1b[1;3A` is Alt+Up: index 1 is `[`, so it is not a coalesced Escape.
    expect(keysFor('\x1b[1;3A', 'legacy')).toEqual(['alt+up']);
  });

  test('falls back to `raw` when the parser set no sequence', () => {
    const event = { name: '', sequence: '', raw: '\x1bj' } as never;
    expect(keyEventToKeys(event)).toEqual(['escape', 'j']);
  });
});

/**
 * BB-326 D5 — a modifier the cockpit binds nothing to must be INERT, not
 * silently dropped to the bare character. Cmd+C arrives named `c` with
 * `super: true`; dropping the modifier would type a `c` into whatever field has
 * focus, when the operator asked their terminal to copy.
 */
describe('unbound modifiers stay unbound', () => {
  test('cmd+c is inert rather than typing a `c`', () => {
    expect(keysFor('\x1b[99;9u', 'csi-u')).toEqual(['super+c']);
  });

  test('a layout that maps Alt+C to a real character types that character', () => {
    // The operator's layout emits `ç` for Alt+C — a plain printable key by the
    // time it reaches us, and correctly typed as one.
    expect(keysFor('ç', 'legacy')).toEqual(['ç']);
  });
});

/**
 * BB-326 D4 — the two halves of the vocabulary cannot collide, and that is a
 * structural fact rather than a lucky choice of names: a named form is always
 * two or more characters, a printable form is always exactly one code point.
 *
 * This is not pedantry. `Form/keys.ts` decides "is this key text?" and inserts
 * it if so; under a vocabulary where a name could be one character, Escape or
 * Tab could be typed into a ticket title.
 */
describe('named keys and printable keys cannot collide', () => {
  const NAMED = [
    'escape',
    'up',
    'down',
    'left',
    'right',
    'tab',
    'shift+tab',
    'enter',
    'backspace',
    'delete',
    'pageup',
    'pagedown',
    'ctrl+c',
    'ctrl+s',
    'ctrl+d',
    'super+c',
    'alt+up',
  ];

  test('every named form is at least two code points long', () => {
    for (const name of NAMED) expect([...name].length).toBeGreaterThan(1);
  });

  test('every printable form is exactly one code point', () => {
    for (const bytes of [' ', 'a', 'ä', 'q', 'j', 'k', '/', 'R', 'G'])
      expect([...(keysFor(bytes, 'legacy')[0] ?? '')].length).toBe(1);
  });

  test('no printable key can ever equal a named key', () => {
    const printable = new Set(
      [' ', 'a', 'ä', 'q', 'j', 'k', '/', 'R', 'G', 'r', 'g'].map(
        (b) => keysFor(b, 'legacy')[0],
      ),
    );
    for (const name of NAMED) expect(printable.has(name)).toBe(false);
  });
});

/**
 * The end-to-end half: the same table, but delivered by a real renderer under a
 * real key press rather than by calling the parser ourselves. This is what
 * proves the seam is wired into the renderer's event and not merely correct in
 * isolation.
 */
const LADDER: Array<[label: string, send: string, want: string]> = [
  ['up', '\x1b[A', 'up'],
  ['down', '\x1b[B', 'down'],
  ['right', '\x1b[C', 'right'],
  ['left', '\x1b[D', 'left'],
  ['tab', '\t', 'tab'],
  ['shift+tab', '\x1b[Z', 'shift+tab'],
  ['return', '\r', 'enter'],
  ['linefeed', '\n', 'enter'],
  ['escape', '\x1b', 'escape'],
  ['ctrl+s submit', '\x13', 'ctrl+s'],
  ['ctrl+c', '\x03', 'ctrl+c'],
  ['ctrl+d', '\x04', 'ctrl+d'],
  ['delete', '\x1b[3~', 'delete'],
  ['pageup', '\x1b[5~', 'pageup'],
  ['pagedown', '\x1b[6~', 'pagedown'],
  ['backspace', '\x7f', 'backspace'],
  ['space toggle', ' ', ' '],
  ['printable ascii', 'a', 'a'],
  ['printable multibyte', 'ä', 'ä'],
  ['quit', 'q', 'q'],
  ['vi down', 'j', 'j'],
  ['vi up', 'k', 'k'],
  ['reload (shifted)', 'R', 'R'],
  ['bottom (shifted)', 'G', 'G'],
  ['search', '/', '/'],
];

/**
 * Every key but one is delivered synchronously from `mockInput.pressKey`. A LONE
 * Escape is not: it is the prefix of `\x1b[A` and every other CSI sequence, so
 * the parser holds it for a disambiguation window (~25 ms observed) before
 * deciding it stands alone. So the probe polls for the first event instead of
 * reading `seen` straight after the press — asserting synchronously would have
 * reported "Escape is lost", which is false.
 */
const DELIVERY_TIMEOUT_MS = 1000;

async function firstDelivered(seen: string[]): Promise<string[]> {
  const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
  while (seen.length === 0 && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 5));
  }
  return seen;
}

describe('keyEventToKeys through a real renderer', () => {
  for (const [label, send, want] of LADDER) {
    test(`${label} reaches a screen as ${JSON.stringify(want)}`, async () => {
      const { renderer, mockInput } = await createTestRenderer({
        width: 80,
        height: 24,
      });
      const seen: string[] = [];
      renderer.keyInput.on('keypress', (event) => {
        seen.push(...keyEventToKeys(event));
      });
      mockInput.pressKey(send);
      expect(await firstDelivered(seen)).toEqual([want]);
      renderer.destroy();
    });
  }
});
