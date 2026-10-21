import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPrintableKey as formCopy } from '../src/Form/keys.js';
import { isPrintableKey } from '../src/lib/key-vocabulary.js';

const packageDir = join(import.meta.dirname, '..');
const testsDir = join(packageDir, 'tests');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * BB-326 — the cockpit's keys are OpenTUI's PARSED names, not bytes. This file
 * is the guard that a conversion cannot be half-done in silence.
 *
 * THE FAILURE MODE THIS EXISTS FOR
 * --------------------------------
 * A test and its subject can move together and stay green for the wrong reason.
 * A Node test calls `handleInput` with a raw Escape byte; after the swap that string
 * is no longer Escape, it is an unbound three-byte string. The screen ignores
 * it — and a test whose assertion is "the popup did not close" or "the cursor
 * did not move" PASSES, while the key it claims to cover is dead in production.
 * That is exactly the class of defect this ticket exists to end, so it is
 * checked mechanically rather than by review.
 *
 * The rule: no Node test may hand a raw control character to a function that
 * takes the vocabulary. There is no legitimate reason to, because after this
 * change no such string is a key.
 *
 * WHY `tests-bun/` AND `tests/pty/` ARE DELIBERATELY NOT COVERED
 * --------------------------------------------------------------
 * They are the independent half of the proof and MUST keep their byte literals.
 * `tests-bun/` presses bytes into a real renderer through `mockInput.pressKey`,
 * so the real parser and this package's adapter both run; `tests/pty/*.mjs`
 * writes bytes into a real pty. Neither can be fooled by the vocabulary
 * changing, because neither states the vocabulary — they state what a terminal
 * sends and what the operator sees. Converting them would have destroyed the
 * only checks that survive a mistake in the conversion itself.
 */
describe('the canonical key vocabulary has no stragglers (BB-326)', () => {
  // Biome rejects a control character written into a regex LITERAL, so the
  // class is built from an escaped constant through `new RegExp`.
  const CONTROL_CLASS = '[\\u0000-\\u001f\\u007f]';
  const VOCABULARY_CALLS = [
    'handleInput',
    'keyToIntent',
    'actionForInput',
    'handle', // Cursor.handle(input, length)
  ];

  it('has test files to guard (the guard cannot pass by finding nothing)', () => {
    expect(tsFiles(testsDir).length).toBeGreaterThan(50);
  });

  it('no Node test passes a raw control character to a vocabulary function', () => {
    // A string literal whose content contains a control char, as the FIRST
    // argument of one of the calls above.
    const pattern = new RegExp(
      `\\b(?:${VOCABULARY_CALLS.join('|')})\\(\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)")`,
      'g',
    );
    const escaped = new RegExp(
      `\\\\x[01][0-9a-fA-F]|\\\\[rnt]|\\\\u00[01][0-9a-fA-F]|\\\\x7[fF]|${CONTROL_CLASS}`,
    );
    const offenders: string[] = [];
    for (const file of tsFiles(testsDir)) {
      if (file.includes(`${sep}pty${sep}`)) continue;
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(pattern)) {
        const literal = match[1] ?? match[2] ?? '';
        if (escaped.test(literal))
          offenders.push(
            `${relative(packageDir, file)} → ${JSON.stringify(literal)}`,
          );
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * BB-326 — the form kernel carries its OWN copy of `isPrintableKey`, because
 * `tests/boundary.test.ts` forbids `src/Form/` importing anything outside
 * `Form/` (BB-236 AC-1 / Decision 7). Purity is worth four duplicated lines;
 * a copy that can drift in silence is not. This pins them behaviourally.
 */
describe('the two copies of isPrintableKey agree', () => {
  const CORPUS = [
    // printable: exactly one code point, not a control
    ' ',
    'a',
    'R',
    'ä',
    'ç',
    '/',
    '0',
    '~',
    // named keys: two or more characters
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
    'ctrl+c',
    'ctrl+s',
    'ctrl+d',
    'super+c',
    'alt+up',
    // controls and the empty string
    '\x1b',
    '\r',
    '\n',
    '\t',
    '\x7f',
    '\x03',
    '',
    // multi-code-point strings that are not names
    'ab',
    '\x1b[A',
    '👍a',
  ];

  it('returns the same answer for every key in the corpus', () => {
    for (const key of CORPUS) expect(formCopy(key)).toBe(isPrintableKey(key));
  });

  it('accepts single printable code points and nothing else', () => {
    expect(isPrintableKey('R')).toBe(true);
    expect(isPrintableKey(' ')).toBe(true);
    expect(isPrintableKey('👍')).toBe(true); // one code point, two UTF-16 units
    expect(isPrintableKey('escape')).toBe(false);
    expect(isPrintableKey('\x1b')).toBe(false);
    expect(isPrintableKey('')).toBe(false);
  });
});
