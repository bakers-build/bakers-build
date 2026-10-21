import { expect, it } from 'vitest';
import type { FieldDecl } from '../../src/Form/field.js';
import { declareForm } from '../../src/Form/form.js';
import { keyToIntent } from '../../src/Form/keys.js';

// BB-283 — the RED regression for the text field's missing cursor. The `text`
// kind is the one input kind with no `cursor` intent: ←/→ fall through to the
// printable check and mean NOTHING (keys.ts), and `insert`/`backspace` operate
// at the END of the value (form.ts). These tests pin the cursor contract the
// fix must satisfy; the widget half (the caret on the wrapped rows) lives in
// `tests/Widget/text-cursor.test.ts`.

const text: FieldDecl = { id: 'body', label: 'Body', kind: 'text' };

interface Values {
  body: string;
}

const form = declareForm<Values, Record<string, never>, string>({
  fields: (f) => [f.text('body', 'Body')],
  toObject: (v) => v.body,
});

const start = (prefill = '') => form.initial({}, { body: prefill });
const type = (s: ReturnType<typeof start>, keys: string[]) =>
  keys.reduce((state, key) => {
    const intent = keyToIntent(key, text);
    return intent === null ? state : form.apply(state, {}, intent);
  }, s);

// ---- keys: ←/→ become a cursor intent (AC-1) --------------------------------

it('text: ← / → move the insertion point', () => {
  expect(keyToIntent('left', text)).toEqual({ kind: 'cursor', dir: -1 });
  expect(keyToIntent('right', text)).toEqual({ kind: 'cursor', dir: 1 });
});

it('text: ↑ / ↓ stay FIELD moves — the AC-5 decision', () => {
  // Decided in BB-283: rebinding ↑/↓ inside a text field would cost the only
  // arrow-key way OUT of a multi-line body, so vertical movement between the
  // logical lines of a text value is deliberately NOT bound to the arrows.
  expect(keyToIntent('up', text)).toEqual({ kind: 'move', delta: -1 });
  expect(keyToIntent('down', text)).toEqual({ kind: 'move', delta: 1 });
});

// ---- reducer: the cursor is a bounded character offset (AC-1) ---------------

it('the insertion point starts at the END of the (pre-filled) value', () => {
  expect(start('').cursor).toBe(0);
  expect(start('hello').cursor).toBe(5);
});

it('the cursor moves one character per arrow and stays within the value', () => {
  let s = type(start('hello'), ['left', 'left']);
  expect(s.cursor).toBe(3);
  // Clamped at both bounds: never before 0, never past the last character.
  s = type(s, ['left', 'left', 'left', 'left', 'left']);
  expect(s.cursor).toBe(0);
  s = type(s, Array(10).fill('right'));
  expect(s.cursor).toBe(5);
});

// ---- reducer: edits happen AT the cursor (AC-2, AC-3, AC-6) ------------------

it('a printable character is inserted AT the cursor, not appended (AC-2)', () => {
  const s = type(start('hello'), ['left', 'left', 'X']);
  expect(s.body).toBe('helXlo');
  // The cursor advances past the inserted character.
  expect(s.cursor).toBe(4);
});

it('backspace removes the character BEFORE the cursor (AC-3)', () => {
  const s = type(start('hello'), ['left', 'left', 'backspace']);
  expect(s.body).toBe('helo');
  expect(s.cursor).toBe(2);
});

it('backspace at the start of the value is a no-op', () => {
  const s = type(start('hi'), ['left', 'left', 'backspace']);
  expect(s.body).toBe('hi');
  expect(s.cursor).toBe(0);
});

it('Delete removes the character AT the cursor (AC-3)', () => {
  // BB-283 follow-up: the Delete key (`\x1b[3~`) was the same keymap gap as
  // the arrows — it fell through to the printable check and meant nothing.
  expect(keyToIntent('delete', text)).toEqual({ kind: 'delete' });
  const s = type(start('hello'), ['left', 'left', 'delete']);
  expect(s.body).toBe('helo');
  // Forward-delete: the cursor stays where it is.
  expect(s.cursor).toBe(3);
});

it('Delete at the end of the value is a no-op', () => {
  const s = type(start('hi'), ['delete']);
  expect(s.body).toBe('hi');
  expect(s.cursor).toBe(2);
});

it('Enter inserts the newline AT the cursor', () => {
  const s = type(start('ab'), ['left', 'enter']);
  expect(s.body).toBe('a\nb');
  expect(s.cursor).toBe(2);
});

it('submit yields exactly the characters typed, mid-string edits included (AC-6)', () => {
  const s = type(start('hello'), ['left', 'left', 'X', 'backspace', 'Y']);
  expect(s.body).toBe('helYlo');
  expect(form.toObject(s, {})).toBe('helYlo');
});

it('submit reflects a Delete edit exactly (AC-6)', () => {
  const s = type(start('hello world'), ['left', 'left', 'left', 'delete']);
  expect(s.body).toBe('hello wold');
  expect(form.toObject(s, {})).toBe('hello wold');
});
