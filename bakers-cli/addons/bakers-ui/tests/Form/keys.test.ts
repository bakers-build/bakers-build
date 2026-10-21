import { expect, it } from 'vitest';
import type { FieldDecl } from '../../src/Form/field.js';
import { keyToIntent } from '../../src/Form/keys.js';

// BB-236 AC-2 / spec Decision 5 — the key→`Intent` table, per kind. This is the
// ladder `Kernel/tui-kernel.ts` wrote twice (Finding 3); the behaviour it encodes
// is pinned end-to-end by `tests/Kernel/create-form-keys.test.ts` (create) and
// `tests/Kernel/edit-form.test.ts` (edit).

const text: FieldDecl = { id: 'body', label: 'Body', kind: 'text' };
const select: FieldDecl = { id: 'who', label: 'Who', kind: 'select' };
const clearable: FieldDecl = { ...select, clearable: true };
const multi: FieldDecl = { id: 'tags', label: 'Tags', kind: 'multiselect' };
const action: FieldDecl = { id: 'submit', label: 'Go', kind: 'action' };
/** BB-257 D6 — the fifth kind. Appended to `ALL`, so the two rules that hold
 *  for EVERY kind (Esc/Ctrl+S, ↑/↓/Tab) are asserted for it too. */
const auto: FieldDecl = {
  id: 'parent',
  label: 'Parent',
  kind: 'autocomplete',
  from: 'parents',
  query: 'parentQuery',
};

const ALL = [text, select, clearable, multi, action, auto];

it('Esc cancels and Ctrl+S submits from EVERY kind', () => {
  for (const field of ALL) {
    expect(keyToIntent('escape', field)).toEqual({ kind: 'cancel' });
    expect(keyToIntent('ctrl+s', field)).toEqual({ kind: 'submit' });
  }
});

it('↑ / Shift+Tab move back and ↓ / Tab move forward from EVERY kind', () => {
  for (const field of ALL) {
    expect(keyToIntent('up', field)).toEqual({ kind: 'move', delta: -1 });
    expect(keyToIntent('down', field)).toEqual({ kind: 'move', delta: 1 });
    expect(keyToIntent('tab', field)).toEqual({ kind: 'move', delta: 1 });
    // Tab's inverse. Without it Tab is a one-way street: it walks the form
    // forward and the key every operator reaches for to walk it back does
    // nothing at all, because a form screen swallows the keys it has no intent
    // for and the kernel never sees them either.
    expect(keyToIntent('shift+tab', field)).toEqual({
      kind: 'move',
      delta: -1,
    });
  }
});

it('text: printable keys insert, \\x7f backspaces, Enter newlines', () => {
  expect(keyToIntent('a', text)).toEqual({ kind: 'insert', text: 'a' });
  expect(keyToIntent(' ', text)).toEqual({ kind: 'insert', text: ' ' });
  expect(keyToIntent('ü', text)).toEqual({ kind: 'insert', text: 'ü' });
  expect(keyToIntent('backspace', text)).toEqual({ kind: 'backspace' });
  expect(keyToIntent('enter', text)).toEqual({ kind: 'newline' });
  expect(keyToIntent('enter', text)).toEqual({ kind: 'newline' });
});

it('text: → / ← move the insertion point (BB-283)', () => {
  expect(keyToIntent('right', text)).toEqual({ kind: 'cursor', dir: 1 });
  expect(keyToIntent('left', text)).toEqual({ kind: 'cursor', dir: -1 });
});

it('text: Delete forward-deletes at the insertion point (BB-283)', () => {
  expect(keyToIntent('delete', text)).toEqual({ kind: 'delete' });
});

it('text: other escape sequences and sub-space control chars mean NOTHING', () => {
  expect(keyToIntent('pageup', text)).toBeNull();
  expect(keyToIntent('ctrl+a', text)).toBeNull();
});

it('select: → / ← cycle, Enter advances, everything else is inert', () => {
  expect(keyToIntent('right', select)).toEqual({ kind: 'cycle', dir: 1 });
  expect(keyToIntent('left', select)).toEqual({ kind: 'cycle', dir: -1 });
  expect(keyToIntent('enter', select)).toEqual({ kind: 'move', delta: 1 });
  expect(keyToIntent('enter', select)).toEqual({ kind: 'move', delta: 1 });
  expect(keyToIntent(' ', select)).toBeNull();
  expect(keyToIntent('z', select)).toBeNull();
});

it('select: Del/Backspace clear ONLY a clearable field', () => {
  // BB-233's edit form declares both selects clearable; the create form
  // declares none, and there `\x7f` must stay inert — which is also why it never
  // collides with the text field's backspace: different `kind`.
  expect(keyToIntent('delete', clearable)).toEqual({ kind: 'clear' });
  expect(keyToIntent('backspace', clearable)).toEqual({ kind: 'clear' });
  expect(keyToIntent('delete', select)).toBeNull();
  expect(keyToIntent('backspace', select)).toBeNull();
  // Clearing does not shadow cycling on a clearable field.
  expect(keyToIntent('right', clearable)).toEqual({ kind: 'cycle', dir: 1 });
});

it('multiselect: → / ← move the cursor, Space toggles, Enter advances', () => {
  expect(keyToIntent('right', multi)).toEqual({ kind: 'cursor', dir: 1 });
  expect(keyToIntent('left', multi)).toEqual({ kind: 'cursor', dir: -1 });
  expect(keyToIntent(' ', multi)).toEqual({ kind: 'toggle' });
  expect(keyToIntent('enter', multi)).toEqual({ kind: 'move', delta: 1 });
  expect(keyToIntent('x', multi)).toBeNull();
  expect(keyToIntent('backspace', multi)).toBeNull();
  expect(keyToIntent('delete', multi)).toBeNull();
});

// ---- BB-257 D6: autocomplete ----------------------------------------------
//
// APPENDED ONLY (spec R1): a new `keyToIntent` branch, no existing one touched.
// Type to filter, ←/→ to browse, Enter to pick.

it('autocomplete: printable keys insert into the query, \\x7f backspaces', () => {
  expect(keyToIntent('a', auto)).toEqual({ kind: 'insert', text: 'a' });
  expect(keyToIntent('2', auto)).toEqual({ kind: 'insert', text: '2' });
  expect(keyToIntent('ü', auto)).toEqual({ kind: 'insert', text: 'ü' });
  expect(keyToIntent('backspace', auto)).toEqual({ kind: 'backspace' });
});

it('autocomplete: SPACE is an insert, never a toggle', () => {
  // D6's reason for choosing Enter over Space as the pick key: a title fragment
  // is words, so a space has to be typeable inside the query.
  expect(keyToIntent(' ', auto)).toEqual({ kind: 'insert', text: ' ' });
});

it('autocomplete: → / ← move the suggestion cursor', () => {
  expect(keyToIntent('right', auto)).toEqual({ kind: 'cursor', dir: 1 });
  expect(keyToIntent('left', auto)).toEqual({ kind: 'cursor', dir: -1 });
});

it('autocomplete: Enter PICKS — it does not advance the field', () => {
  expect(keyToIntent('enter', auto)).toEqual({ kind: 'pick' });
  expect(keyToIntent('enter', auto)).toEqual({ kind: 'pick' });
});

it('autocomplete: escape sequences and sub-space control chars mean NOTHING', () => {
  expect(keyToIntent('delete', auto)).toBeNull();
  expect(keyToIntent('ctrl+a', auto)).toBeNull();
});

// ---- BB-300 D2/D3: clearable autocomplete + field-count-aware ↑/↓ ---------

const clearableAuto: FieldDecl = { ...auto, clearable: true };

it('BB-300 D2 — Del clears a clearable autocomplete; Backspace clears only an empty query', () => {
  expect(keyToIntent('delete', clearableAuto, { query: '' })).toEqual({
    kind: 'clear',
  });
  expect(keyToIntent('delete', clearableAuto, { query: 'bakers.build' })).toEqual({
    kind: 'clear',
  });
  expect(keyToIntent('backspace', clearableAuto, { query: '' })).toEqual({
    kind: 'clear',
  });
  expect(keyToIntent('backspace', clearableAuto, { query: 'bakers.build' })).toEqual({
    kind: 'backspace',
  });
});

it('BB-300 D2 — a non-clearable autocomplete keeps today’s bindings', () => {
  expect(keyToIntent('delete', auto, { query: '' })).toBeNull();
  expect(keyToIntent('backspace', auto, { query: '' })).toEqual({
    kind: 'backspace',
  });
});

it('BB-300 D3 — ↑/↓ are cursor moves in a single-field form’s autocomplete', () => {
  expect(keyToIntent('up', auto, { fieldCount: 1 })).toEqual({
    kind: 'cursor',
    dir: -1,
  });
  expect(keyToIntent('down', auto, { fieldCount: 1 })).toEqual({
    kind: 'cursor',
    dir: 1,
  });
});

it('BB-309 — Tab/Shift+Tab are cursor moves on the SAME branch ↑/↓ are (F5)', () => {
  // The branch is `singleAutocomplete`, and `\t`/`\x1b[Z` ride it with `\x1b[B`
  // and `\x1b[A` (`keys.ts:35-42`). Only ↑/↓ were pinned here, so nothing in the
  // suite said which pickers the two tab keys really walk — and three documents
  // ended up claiming the walk for a picker that never asked for the branch.
  expect(keyToIntent('shift+tab', auto, { fieldCount: 1 })).toEqual({
    kind: 'cursor',
    dir: -1,
  });
  expect(keyToIntent('tab', auto, { fieldCount: 1 })).toEqual({
    kind: 'cursor',
    dir: 1,
  });
});

it('BB-309 — a one-field form of ANY other kind keeps Shift+Tab as a field move', () => {
  // The branch is `fieldCount === 1 && kind === 'autocomplete'`, not the field
  // count alone: a single-field text form still yields `move`, which its form
  // then clamps to nothing. This is exactly the Who picker's case, reached the
  // other way round — that screen passes NO context at all.
  expect(keyToIntent('shift+tab', text, { fieldCount: 1 })).toEqual({
    kind: 'move',
    delta: -1,
  });
  expect(keyToIntent('tab', select, { fieldCount: 1 })).toEqual({
    kind: 'move',
    delta: 1,
  });
  // …and an autocomplete whose form never told the key module its field count
  // (`who-filter-form.ts:117`) is on the same side of the branch.
  expect(keyToIntent('shift+tab', auto)).toEqual({ kind: 'move', delta: -1 });
});

it('BB-300 D3 — ↑/↓ stay field moves in multi-field forms and for other kinds', () => {
  expect(keyToIntent('up', auto, { fieldCount: 2 })).toEqual({
    kind: 'move',
    delta: -1,
  });
  expect(keyToIntent('down', auto)).toEqual({ kind: 'move', delta: 1 });
  expect(keyToIntent('up', text, { fieldCount: 1 })).toEqual({
    kind: 'move',
    delta: -1,
  });
});

it('action: Enter submits, nothing else does anything', () => {
  expect(keyToIntent('enter', action)).toEqual({ kind: 'submit' });
  expect(keyToIntent('enter', action)).toEqual({ kind: 'submit' });
  expect(keyToIntent(' ', action)).toBeNull();
  expect(keyToIntent('right', action)).toBeNull();
  expect(keyToIntent('x', action)).toBeNull();
});
