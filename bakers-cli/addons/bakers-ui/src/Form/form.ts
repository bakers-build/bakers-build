// BB-236 kernel — the ONE reducer (spec Decisions 1–4). Four kinds, ten intents, no
// knowledge of tickets, conductors, JSON:API or agents; the caller's `toObject` alone
// decides what the form YIELDS (AC-5). State is FLAT: `s.description` (Decision 3).
// `initial` fills only DECLARED fields — `prefill` wins per `Object.hasOwn`, so an
// explicit `null` sticks and a non-field value rides along, never transitioned.
import type { FieldDecl, FieldFactory, Option } from './field.js';
import { fieldFactory } from './field.js';

export type FormState<V> = V & { active: number; cursor: number };
/** `active`/`cursor` are the kernel's own, so a `Values` declaring either must FAIL TO
 *  COMPILE (R4). A bound on `V` would make `FormState<V>` `never` inside the body. */
export type NoReserved<V> =
  Extract<keyof V, 'active' | 'cursor'> extends never
    ? unknown
    : { readonly __valuesMustNotDeclareActiveOrCursor: never };

// What a key MEANT: `Form/keys.ts` decides it, `apply` performs it.
// BB-257 D5 adds `pick` — take the suggestion under the cursor. It is its own
// intent rather than a re-use of `toggle` because it is not a toggle: picking
// twice picks the same row twice, and the key that means it is Enter, not Space.
// BB-283 adds `delete` — forward-delete at the text field's insertion point.
type Bare =
  | 'clear'
  | 'toggle'
  | 'pick'
  | 'backspace'
  | 'delete'
  | 'newline'
  | 'submit'
  | 'cancel';
export type Intent =
  | { kind: 'move'; delta: number }
  | { kind: 'cycle' | 'cursor'; dir: 1 | -1 }
  | { kind: 'insert'; text: string }
  | { kind: Bare };

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(v, hi));
const listOf = (o: object, f: FieldDecl): Option[] =>
  ((o as Record<string, Option[]>)[f.from ?? ''] ?? []) as Option[];
/** The length of a text field's value in `s` — where its insertion point
 *  sits on entry (BB-283). */
const textLength = (s: object, f: FieldDecl): number => {
  const v = (s as Record<string, unknown>)[f.id];
  return typeof v === 'string' ? v.length : 0;
};

/** Rotate a select by `dir`. `clearable` puts a real `null` in the ring, so ← and →
 *  reach "cleared" symmetrically; without it the pre-BB-233 behaviour, byte for
 *  byte: an empty list keeps the value, and the cycle only lands on a real option. */
export function cycleValue(
  list: Option[],
  cur: string | null,
  dir: 1 | -1,
  clearable = false,
): string | null {
  if (list.length === 0) return clearable ? null : cur;
  const ids = list.map((o) => o.id);
  const ring: (string | null)[] = clearable ? [null, ...ids] : ids;
  const at = ring.indexOf(cur);
  // An unknown current lands on the first option — except in a clearable ring,
  // where `null` is index 0 and `dir` decides which way we step off it.
  const from = at < 0 ? (clearable ? dir : 0) : at + dir;
  const next = ring[(from + ring.length) % ring.length];
  return next === undefined ? cur : next;
}

/**
 * The suggestions an `autocomplete` field offers for `query`.
 *
 * A case-insensitive substring of `Option.label`, and nothing more — the kernel
 * has no idea what a label is made of (BB-257 D5). The query is NOT trimmed:
 * a label holds spaces, so a space is part of the needle rather than a
 * separator, which is also why Space had to stay a typeable character (D6).
 *
 * EXPORTED because the renderer must draw exactly the list `apply` clamps its
 * cursor against and `pick` reads from; a second filtering rule would let the
 * `›` marker point at a row other than the one Enter takes (D7).
 */
export function filterOptions(list: Option[], query: string): Option[] {
  const needle = query.toLowerCase();
  if (needle === '') return list;
  return list.filter((o) => o.label.toLowerCase().includes(needle));
}

/** A field list plus the one function that says what the form yields. */
export function declareForm<V extends object, O extends object, Out>(
  decl: {
    fields: (f: FieldFactory<V, O>) => FieldDecl[];
    toObject: (values: V, options: O) => Out;
  } & NoReserved<V>,
) {
  const fields = decl.fields(fieldFactory<V, O>());
  const at = (s: FormState<V>) => (fields[s.active] ?? fields[0]) as FieldDecl;
  const set = (s: FormState<V>, f: FieldDecl, v: unknown) =>
    ({ ...s, [f.id]: v }) as FormState<V>;
  const move = (s: FormState<V>, d: number): FormState<V> => {
    const active = clamp(s.active + d, 0, fields.length - 1);
    const next = { ...s, active } as FormState<V>;
    // BB-283: the cursor belongs to the field being ENTERED. A text field
    // starts its insertion point at the end of the value, so type-to-append
    // behaves exactly as it did before the field had a cursor; every other
    // kind starts its row cursor at the top, where a fresh form put it.
    const f = fields[active] ?? fields[0];
    if (f === undefined) return next;
    return { ...next, cursor: f.kind === 'text' ? textLength(next, f) : 0 };
  };
  return {
    fields,
    activeField: at,
    move,
    initial(options: O, prefill: Partial<V> = {}): FormState<V> {
      const values: Record<string, unknown> = { ...prefill };
      for (const f of fields) {
        // An `autocomplete` field owns TWO keys, so its query default is filled
        // independently of its id — the per-key `hasOwn` rule below applies to
        // each of them separately (BB-257 D5).
        if (
          f.kind === 'autocomplete' &&
          f.query !== undefined &&
          !Object.hasOwn(values, f.query)
        ) {
          values[f.query] = '';
        }
        if (Object.hasOwn(values, f.id)) continue;
        if (f.kind === 'text') values[f.id] = '';
        else if (f.kind === 'select')
          values[f.id] = listOf(options, f)[0]?.id ?? null;
        else if (f.kind === 'multiselect') values[f.id] = new Set<string>();
        // Nothing is picked until something is picked: `null` is a real state
        // and the one AC-7 (the parent is optional) rests on.
        else if (f.kind === 'autocomplete') values[f.id] = null;
      }
      const state = { ...values, active: 0, cursor: 0 } as FormState<V>;
      // BB-283: a form that OPENS on a text field starts with the insertion
      // point at the end of its (pre-filled) value — `move`'s entry rule,
      // applied to the field the form starts on.
      const first = fields[0];
      return first !== undefined && first.kind === 'text'
        ? { ...state, cursor: textLength(state, first) }
        : state;
    },
    apply(s: FormState<V>, options: O, intent: Intent): FormState<V> {
      const f = at(s);
      const list = listOf(options, f);
      const v = (s as Record<string, unknown>)[f.id];
      if (intent.kind === 'move') return move(s, intent.delta);
      if (f.kind === 'text') {
        const t = typeof v === 'string' ? v : '';
        // BB-283: on a text field `cursor` is a CHARACTER OFFSET into the
        // value, re-clamped on every intent, and every edit splices AT it
        // rather than at the end — that offset is what the widget draws as
        // the caret.
        const point = clamp(s.cursor, 0, t.length);
        if (intent.kind === 'cursor')
          return { ...s, cursor: clamp(point + intent.dir, 0, t.length) };
        if (intent.kind === 'insert')
          return {
            ...set(s, f, t.slice(0, point) + intent.text + t.slice(point)),
            cursor: point + intent.text.length,
          };
        if (intent.kind === 'backspace') {
          if (point === 0) return s;
          return {
            ...set(s, f, t.slice(0, point - 1) + t.slice(point)),
            cursor: point - 1,
          };
        }
        if (intent.kind === 'delete') {
          // Forward-delete: the character AT the point goes, the point stays.
          if (point === t.length) return s;
          return set(s, f, t.slice(0, point) + t.slice(point + 1));
        }
        return intent.kind === 'newline'
          ? {
              ...set(s, f, `${t.slice(0, point)}\n${t.slice(point)}`),
              cursor: point + 1,
            }
          : s;
      }
      if (f.kind === 'select') {
        const cur = v as string | null;
        if (intent.kind === 'cycle')
          return set(s, f, cycleValue(list, cur, intent.dir, f.clearable));
        return intent.kind === 'clear' ? set(s, f, null) : s;
      }
      if (f.kind === 'multiselect') {
        const hi = list.length - 1;
        if (intent.kind === 'cursor')
          return { ...s, cursor: clamp(s.cursor + intent.dir, 0, hi) };
        const option = list[s.cursor];
        if (intent.kind !== 'toggle' || !option) return s;
        const next = new Set(v as Iterable<string>);
        if (next.has(option.id)) next.delete(option.id);
        else next.add(option.id);
        return set(s, f, next);
      }
      if (f.kind === 'autocomplete') {
        // The typed query lives under its own key; the id under `f.id`. Every
        // list this branch reasons about is the FILTERED one, so the cursor can
        // never sit on a row that is not being offered.
        const queryKey = f.query ?? '';
        const raw = (s as Record<string, unknown>)[queryKey];
        const query = typeof raw === 'string' ? raw : '';
        const edited = (next: string): FormState<V> =>
          ({ ...s, [queryKey]: next, [f.id]: null, cursor: 0 }) as FormState<V>;
        // Editing drops the pick — which is how AC-7 stays reachable after a
        // mis-pick — and rewinds the cursor, since the offered list changed.
        // BB-300 D2 — a clear drops the pick AND the typed query, rewinding
        // the cursor like an edit does.
        if (intent.kind === 'clear') return edited('');
        if (intent.kind === 'insert') return edited(query + intent.text);
        if (intent.kind === 'backspace') return edited(query.slice(0, -1));
        const matches = filterOptions(list, query);
        if (intent.kind === 'cursor') {
          return {
            ...s,
            cursor: clamp(s.cursor + intent.dir, 0, matches.length - 1),
          };
        }
        if (intent.kind !== 'pick') return s;
        const match = matches[s.cursor];
        // The UUID, never the label: two tickets may share a title (D5).
        return match ? set(s, f, match.id) : s;
      }
      // The action row: `submit`/`cancel` are the CALLER's business, not ours.
      return s;
    },
    toObject: (s: FormState<V>, options: O): Out =>
      decl.toObject(s as unknown as V, options),
  };
}
