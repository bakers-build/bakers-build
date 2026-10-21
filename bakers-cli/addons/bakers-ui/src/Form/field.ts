// BB-236 kernel — FIELDS (spec Decisions 1 + 2). A field is plain DATA: `kind`
// names the behaviour the one reducer switches on, `from` names the caller's option
// list BY KEY. No function on a field; no import from outside `Form/` (AC-1).
export interface Option {
  id: string;
  label: string;
}
export type FieldKind =
  | 'text'
  | 'select'
  | 'multiselect'
  // BB-257 D5 — a select you TYPE into: the bag is filtered by a
  // case-insensitive substring of `Option.label` and one match is picked. The
  // kernel knows nothing of what a label means; composing one so that a single
  // substring rule covers two searchable properties is the adapter's job.
  | 'autocomplete'
  | 'action';

/** A declared field. `clearable`: a select whose cycle includes a real `null`, so
 *  the value can be REMOVED, not merely changed (BB-233) — or an autocomplete
 *  whose pick can be removed in place (BB-300 D2). `from`: the bag key. */
export interface FieldDecl {
  id: string;
  label: string;
  kind: FieldKind;
  clearable?: boolean;
  from?: string;
  /**
   * `autocomplete` only: the key of the state value holding the TYPED QUERY.
   *
   * The kind needs two keys — the picked id and the query — and both are named
   * by key for the same reason `from` is: a field stays plain data, so the
   * declaration remains printable and walkable by a renderer (BB-236 D1).
   * Storing the id rather than the query is what makes a pick survive a later
   * edit and two same-titled tickets distinguishable (BB-257 D5).
   */
  query?: string;
  /**
   * What to say when the option bag is ABSENT rather than empty.
   *
   * Only a bag typed `OptionalOptionKey` can be absent, so in practice this is
   * an `autocomplete`'s. Absent means "nothing can be offered" (the Parent
   * field with no project in scope); an empty ARRAY means "searched, nothing
   * matched". The two need different words, and the words are DOMAIN text — the
   * per-kind widget that draws them is entity-agnostic and cannot invent them.
   *
   * A plain string, deliberately: a widget must not hang a function off a field
   * (BB-257 re-entry AC-15), because a declaration that carries behaviour is a
   * declaration the kernel can no longer be pure about. Text is data; a callback
   * would be a service edge.
   */
  absentNote?: string;
  /**
   * The server page size the bag is filled from, when it is filled by a paged
   * read.
   *
   * A bag whose length has reached this number may be a truncated answer, and
   * saying so is the whole of R3's mitigation. The renderer cannot infer it: a
   * full page and a project with exactly that many tickets look identical from
   * here, and the number belongs to the read, not to the popup.
   */
  pageSize?: number;
}

// The typed key sets, written once HERE so no call site carries a generic: `f.text`
// takes a `string` key, `f.select` a `string | null` one, `f.multi` a `ReadonlySet`.
type Keys<V, C> = { [K in keyof V]-?: V[K] extends C ? K : never }[keyof V];
type Nullable<V> = { [K in keyof V]-?: null extends V[K] ? K : never }[keyof V];
export type TextKey<V> = Exclude<Keys<V, string>, Nullable<V>>;
export type SelectKey<V> = Nullable<V> & Keys<V, string | null>;
export type MultiKey<V> = Keys<V, ReadonlySet<string>>;
export type OptionKey<O> = Keys<O, Option[]>;
/**
 * An option bag key that is allowed to be ABSENT (BB-257 D8).
 *
 * `Keys` reads `O[K]`, which for an optional property still carries `undefined`
 * — so `OptionKey` accepts only a REQUIRED bag, and a `select`/`multi` is right
 * to demand one: a ring with no list is a field with nothing to cycle. An
 * `autocomplete` bag is different in kind. Its absence is a state the field
 * RENDERS ("no project context — nothing can be offered"), distinct from an
 * empty array ("searched, nothing matched"), so the type has to permit it.
 * Additive: no existing key set changes.
 */
export type OptionalOptionKey<O> = {
  [K in keyof O]-?: NonNullable<O[K]> extends Option[] ? K : never;
}[keyof O];
// A select may read an ABSENT bag too (the project's templates, with no
// project in scope) — `listOf` already treats absent as empty.
type SelectOpts<O> = { from: OptionalOptionKey<O>; clearable?: boolean };
/** The autocomplete field's two keys: the bag it filters, the query it holds —
 *  plus the two plain strings/numbers its widget cannot invent for itself. */
type AutocompleteOpts<V, O> = {
  from: OptionalOptionKey<O>;
  query: TextKey<V>;
  clearable?: boolean;
  absentNote?: string;
  pageSize?: number;
};

/** The field constructors, PRE-BOUND to `Values`/`Options` by `declareForm`. */
export interface FieldFactory<V, O> {
  text(id: TextKey<V>, label: string): FieldDecl;
  select(id: SelectKey<V>, label: string, o: SelectOpts<O>): FieldDecl;
  multi(id: MultiKey<V>, label: string, o: { from: OptionKey<O> }): FieldDecl;
  /** `id` holds the PICKED option's id (nullable — nothing picked is a real
   *  state); `o.query` names the plain string key the typing goes into. */
  autocomplete(
    id: SelectKey<V>,
    label: string,
    o: AutocompleteOpts<V, O>,
  ): FieldDecl;
  action(label: string, id?: string): FieldDecl;
}
type Bag = Record<string, never>;

// `clearable: false` and "no clearable" are the same thing, so the key stays ABSENT
// unless asked for — the create form must declare it nowhere.
const FACTORY: FieldFactory<Bag, Bag> = {
  text: (id, label) => ({ id, label, kind: 'text' }),
  select: (id, label, o) => ({
    id,
    label,
    kind: 'select',
    from: o.from,
    ...(o.clearable === true ? { clearable: true } : {}),
  }),
  multi: (id, label, o) => ({ id, label, kind: 'multiselect', from: o.from }),
  // The two optional strings stay ABSENT unless asked for, so a declaration that
  // wants neither prints exactly as it did before they existed.
  autocomplete: (id, label, o) => ({
    id,
    label,
    kind: 'autocomplete',
    from: o.from,
    query: o.query,
    ...(o.clearable === true ? { clearable: true } : {}),
    ...(o.absentNote === undefined ? {} : { absentNote: o.absentNote }),
    ...(o.pageSize === undefined ? {} : { pageSize: o.pageSize }),
  }),
  action: (label, id = 'submit') => ({ id, label, kind: 'action' }),
};

// Stateless: the one implementation is re-typed per form, never rebuilt.
export const fieldFactory = <V, O>(): FieldFactory<V, O> =>
  FACTORY as unknown as FieldFactory<V, O>;
