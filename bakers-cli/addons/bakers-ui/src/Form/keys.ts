// BB-236 kernel — KEYS (spec Decision 5). A raw key plus the active field's
// `kind`/`clearable` become an `Intent`, which the caller applies: the ladder
// `tui-kernel` wrote once per form (Finding 3), written once. A key is not a domain
// concept, so AC-1's boundary holds. Null ⇒ the key means nothing on this field.
import type { FieldDecl } from './field.js';
import type { Intent } from './form.js';

// BB-300 — the caller's context a key's meaning can depend on: the field's
// TYPED query (Backspace on an empty query is a clear, not a deletion — D2) and
// the form's FIELD COUNT (↑/↓ browse suggestions only when there is no field
// to move to — D3). Optional: a caller that passes nothing gets the pre-BB-300
// behaviour byte-for-byte.
export interface KeyContext {
  query?: string | undefined;
  fieldCount?: number | undefined;
}

/**
 * BB-326 — "is this key TEXT?", under the canonical key vocabulary.
 *
 * A printable key is exactly one code point that is not a control character;
 * every named key (`escape`, `up`, `shift+tab`, `enter`, `ctrl+c`) is two or
 * more characters, so the two halves of the vocabulary cannot collide.
 *
 * This is a deliberate COPY of `lib/key-vocabulary.ts`. The form kernel may
 * import nothing outside `Form/` (AC-1 / Decision 7, asserted by
 * `tests/boundary.test.ts`), and purity is worth more than four shared lines.
 * The two are pinned to each other by an equivalence test in
 * `tests/Form/keys.test.ts`, so the copy cannot drift in silence.
 *
 * It replaced `!key.startsWith('\x1b') && key >= ' '`, which was correct for
 * bytes and actively wrong for names: `'escape' >= ' '` is true, so Escape
 * would have been inserted into the field as the word "escape".
 */
export function isPrintableKey(key: string): boolean {
  const points = [...key];
  if (points.length !== 1) return false;
  const code = points[0]?.codePointAt(0) ?? 0;
  return code >= 0x20 && code !== 0x7f;
}

export function keyToIntent(
  key: string,
  field: FieldDecl,
  context: KeyContext = {},
): Intent | null {
  if (key === 'escape') return { kind: 'cancel' };
  if (key === 'ctrl+s') return { kind: 'submit' };
  // BB-300 D3 — the global field-move binding yields to the autocomplete's
  // suggestion cursor when there is exactly one field: `move` is a no-op there,
  // so nothing is lost. Every other kind keeps the binding (BB-283's
  // multi-line escape hatch), and multi-field forms are untouched.
  const singleAutocomplete =
    context.fieldCount === 1 && field.kind === 'autocomplete';
  // BB-309 — Shift+Tab rides with ↑, exactly as Tab rides with ↓ below.
  // Without it Tab was a one-way street: a form screen returns `true` for a key
  // it has no intent for, so the kernel's own `shift+tab` branch never saw it
  // either and the key was silently inert on every form.
  if (key === 'up' || key === 'shift+tab')
    return singleAutocomplete
      ? { kind: 'cursor', dir: -1 }
      : { kind: 'move', delta: -1 };
  if (key === 'down' || key === 'tab')
    return singleAutocomplete
      ? { kind: 'cursor', dir: 1 }
      : { kind: 'move', delta: 1 };
  const enter = key === 'enter';
  if (field.kind === 'text') {
    if (enter) return { kind: 'newline' };
    if (key === 'backspace') return { kind: 'backspace' };
    // BB-283: ←/→ move the insertion point inside the value — the same
    // `cursor` intent the list kinds use, given a per-kind meaning (a character
    // offset) by the reducer. ↑/↓ deliberately keep their global meaning (field
    // moves): they are the only arrow-key way OUT of a multi-line body.
    if (key === 'right') return { kind: 'cursor', dir: 1 };
    if (key === 'left') return { kind: 'cursor', dir: -1 };
    // Delete (Entf) forward-deletes AT the insertion point — backspace's
    // twin on the other side of the cursor (BB-283 follow-up).
    if (key === 'delete') return { kind: 'delete' };
    return isPrintableKey(key) ? { kind: 'insert', text: key } : null;
  }
  if (field.kind === 'select') {
    if (key === 'right') return { kind: 'cycle', dir: 1 };
    if (key === 'left') return { kind: 'cycle', dir: -1 };
    // Del/Backspace clear only a CLEARABLE select; on a non-clearable one they are
    // inert — which is why `\x7f` never collides with the text field's backspace.
    if (key === 'delete' || key === 'backspace')
      return field.clearable === true ? { kind: 'clear' } : null;
    return enter ? { kind: 'move', delta: 1 } : null;
  }
  if (field.kind === 'multiselect') {
    if (key === 'right') return { kind: 'cursor', dir: 1 };
    if (key === 'left') return { kind: 'cursor', dir: -1 };
    if (key === ' ') return { kind: 'toggle' };
    return enter ? { kind: 'move', delta: 1 } : null;
  }
  if (field.kind === 'autocomplete') {
    // BB-257 D6. ←/→ browse the suggestions, the same keys the multiselect
    // already uses for its cursor; Enter PICKS rather than advancing, because a
    // field you type into needs a commit key of its own. Space is deliberately
    // NOT the pick key: it has to stay typeable inside a title fragment, which
    // is exactly why the multiselect's `toggle` binding is not reused here.
    if (key === 'right') return { kind: 'cursor', dir: 1 };
    if (key === 'left') return { kind: 'cursor', dir: -1 };
    if (enter) return { kind: 'pick' };
    // BB-300 D2 — the select kind's clearable vocabulary, applied to the
    // kind with a typed query: Del clears outright (it has no other meaning
    // here); Backspace clears only an EMPTY query, so typed text is never
    // eaten by the clear gesture.
    if (key === 'delete' && field.clearable === true) return { kind: 'clear' };
    if (key === 'backspace')
      return field.clearable === true && (context.query ?? '') === ''
        ? { kind: 'clear' }
        : { kind: 'backspace' };
    return isPrintableKey(key) ? { kind: 'insert', text: key } : null;
  }
  return enter ? { kind: 'submit' } : null; // the action row
}
