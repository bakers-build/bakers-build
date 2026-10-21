import { expect, it } from 'vitest';
import type { Option } from '../../src/Form/field.js';
import { cycleValue, declareForm, filterOptions } from '../../src/Form/form.js';

// BB-236 AC-1/AC-2/AC-5 — the ONE reducer, one case per kind × intent.
//
// `NoReserved` (spec Risk R4) is a COMPILE-time constraint on `declareForm`'s
// `Values`: a form declaring `active` or `cursor` fails to build. It cannot be
// asserted here — this package's tsconfig only includes `src/**/*.ts`, so the
// test tree is transpiled and never type-checked. Its proof is that the two real
// call sites (`Service/create-form.ts`, `Service/edit-form.ts`) compile.

interface Values {
  description: string;
  assignee: string | null;
  conductor: string | null;
  labels: ReadonlySet<string>;
  /** A NON-field value: carried verbatim, never transitioned (the edit form's
   *  `ticketId`). */
  carried: string;
}

interface Options {
  users: Option[];
  conductors: Option[];
  tags: Option[];
  empty: Option[];
}

interface Out {
  text: string;
  who: Option | null;
  tags: Option[];
}

const opts: Options = {
  users: [
    { id: 'u1', label: 'cw' },
    { id: 'u2', label: 'tm' },
    { id: 'u3', label: 'zz' },
  ],
  conductors: [{ id: 'c1', label: 'cw-framework' }],
  tags: [
    { id: 't1', label: 'bug' },
    { id: 't2', label: 'ui' },
  ],
  empty: [],
};

const form = declareForm<Values, Options, Out>({
  fields: (f) => [
    f.text('description', 'Description'),
    f.select('assignee', 'Assignee', { from: 'users' }),
    // `clearable`, so `null` is a real ring position (BB-233's edit form).
    f.select('conductor', 'Conductor', { from: 'conductors', clearable: true }),
    f.multi('labels', 'Labels', { from: 'tags' }),
    f.action('Go'),
  ],
  toObject: (v, o) => ({
    text: v.description,
    who: o.users.find((u) => u.id === v.assignee) ?? null,
    tags: o.tags.filter((t) => v.labels.has(t.id)),
  }),
});

const start = () => form.initial(opts, { carried: 'ticket-1' });

// ---- initialisation + prefill -----------------------------------------------

it('initialises each declared field by kind and adds active/cursor', () => {
  const s = start();
  expect(s.description).toBe('');
  expect(s.assignee).toBe('u1'); // first option of its bag list
  expect(s.conductor).toBe('c1');
  expect(s.labels.size).toBe(0);
  expect(s.active).toBe(0);
  expect(s.cursor).toBe(0);
});

it('a select whose option list is empty starts null', () => {
  const empty = declareForm<{ pick: string | null }, Options, null>({
    fields: (f) => [f.select('pick', 'Pick', { from: 'empty' })],
    toObject: () => null,
  });
  expect(empty.initial(opts).pick).toBeNull();
});

it('carries a NON-field value verbatim and never transitions it', () => {
  let s = start();
  expect(s.carried).toBe('ticket-1');
  s = form.apply(s, opts, { kind: 'insert', text: 'x' });
  s = form.move(s, 1);
  s = form.apply(s, opts, { kind: 'cycle', dir: 1 });
  expect(s.carried).toBe('ticket-1');
});

it('prefill wins over the default, and an EXPLICIT null sticks', () => {
  // `Object.hasOwn`, not truthiness: prefilling `null` is the edit form's whole
  // point — an unassigned ticket must not silently fall back to `options[0]`.
  const s = form.initial(opts, { assignee: null, conductor: 'c1' });
  expect(s.assignee).toBeNull();
  expect(s.conductor).toBe('c1');
  const other = form.initial(opts, { assignee: 'u2' });
  expect(other.assignee).toBe('u2');
});

// ---- move --------------------------------------------------------------------

it('move walks the field list and clamps at both ends', () => {
  const s = start();
  expect(form.activeField(s).id).toBe('description');
  expect(form.activeField(form.move(s, 1)).id).toBe('assignee');
  expect(form.move(s, -1).active).toBe(0);
  expect(form.move(s, 99).active).toBe(form.fields.length - 1);
  expect(form.activeField(form.move(s, 99)).kind).toBe('action');
});

it('activeField falls back to the first field for an out-of-range index', () => {
  expect(form.activeField({ ...start(), active: 99 }).id).toBe('description');
});

// ---- text --------------------------------------------------------------------

it('text: insert appends, backspace drops the last char, newline appends \\n', () => {
  let s = start();
  s = form.apply(s, opts, { kind: 'insert', text: 'Hi' });
  s = form.apply(s, opts, { kind: 'insert', text: '!' });
  expect(s.description).toBe('Hi!');
  s = form.apply(s, opts, { kind: 'backspace' });
  expect(s.description).toBe('Hi');
  s = form.apply(s, opts, { kind: 'newline' });
  expect(s.description).toBe('Hi\n');
  // Backspacing an empty field is a no-op, not an error.
  expect(form.apply(start(), opts, { kind: 'backspace' }).description).toBe('');
});

it('text is inert to the select/multi intents', () => {
  const s = start();
  expect(form.apply(s, opts, { kind: 'cycle', dir: 1 })).toEqual(s);
  expect(form.apply(s, opts, { kind: 'clear' })).toEqual(s);
  expect(form.apply(s, opts, { kind: 'toggle' })).toEqual(s);
  expect(form.apply(s, opts, { kind: 'cursor', dir: 1 })).toEqual(s);
});

// ---- select ------------------------------------------------------------------

it('select: cycle runs forward, backward and wraps over real options only', () => {
  let s = form.move(start(), 1); // assignee, 3 options
  s = form.apply(s, opts, { kind: 'cycle', dir: 1 });
  expect(s.assignee).toBe('u2');
  s = form.apply(s, opts, { kind: 'cycle', dir: 1 });
  expect(s.assignee).toBe('u3');
  s = form.apply(s, opts, { kind: 'cycle', dir: 1 });
  expect(s.assignee).toBe('u1'); // wrapped, never null
  s = form.apply(s, opts, { kind: 'cycle', dir: -1 });
  expect(s.assignee).toBe('u3'); // wrapped the other way
});

it('select: cycling touches only the active field', () => {
  const s = form.apply(form.move(start(), 1), opts, { kind: 'cycle', dir: 1 });
  expect(s.assignee).toBe('u2');
  expect(s.conductor).toBe('c1');
  expect(s.description).toBe('');
});

it('select: an empty option list is a no-op for a NON-clearable field', () => {
  const bare = declareForm<{ pick: string | null }, Options, null>({
    fields: (f) => [f.select('pick', 'Pick', { from: 'empty' })],
    toObject: () => null,
  });
  const s = { ...bare.initial(opts), pick: 'kept' };
  expect(bare.apply(s, opts, { kind: 'cycle', dir: 1 }).pick).toBe('kept');
});

it('select: `clearable` reaches null symmetrically from both directions', () => {
  let s = form.move(form.move(start(), 1), 1); // conductor, 1 option, clearable
  expect(s.conductor).toBe('c1');
  s = form.apply(s, opts, { kind: 'cycle', dir: 1 });
  expect(s.conductor).toBeNull();
  s = form.apply(s, opts, { kind: 'cycle', dir: 1 });
  expect(s.conductor).toBe('c1'); // past null, back to the first option
  s = form.apply(s, opts, { kind: 'cycle', dir: -1 });
  expect(s.conductor).toBeNull();
});

it('select: clear sets null outright', () => {
  const s = form.move(form.move(start(), 1), 1);
  expect(form.apply(s, opts, { kind: 'clear' }).conductor).toBeNull();
  // …and leaves the other select alone.
  expect(form.apply(s, opts, { kind: 'clear' }).assignee).toBe('u1');
});

it('select is inert to the text/multi intents', () => {
  const s = form.move(start(), 1);
  expect(form.apply(s, opts, { kind: 'insert', text: 'x' })).toEqual(s);
  expect(form.apply(s, opts, { kind: 'backspace' })).toEqual(s);
  expect(form.apply(s, opts, { kind: 'newline' })).toEqual(s);
  expect(form.apply(s, opts, { kind: 'toggle' })).toEqual(s);
});

// ---- multiselect -------------------------------------------------------------

it('multi: the cursor moves and clamps against its own option list', () => {
  let s = form.move(start(), 3); // labels, 2 options
  expect(s.cursor).toBe(0);
  s = form.apply(s, opts, { kind: 'cursor', dir: 1 });
  expect(s.cursor).toBe(1);
  s = form.apply(s, opts, { kind: 'cursor', dir: 1 });
  expect(s.cursor).toBe(1); // clamped at the last option
  s = form.apply(s, opts, { kind: 'cursor', dir: -1 });
  expect(s.cursor).toBe(0);
  s = form.apply(s, opts, { kind: 'cursor', dir: -1 });
  expect(s.cursor).toBe(0); // clamped at the first
});

it('multi: toggle checks and unchecks the option under the cursor', () => {
  let s = form.move(start(), 3);
  s = form.apply(s, opts, { kind: 'toggle' });
  expect([...s.labels]).toEqual(['t1']);
  s = form.apply(s, opts, { kind: 'cursor', dir: 1 });
  s = form.apply(s, opts, { kind: 'toggle' });
  expect([...s.labels].sort()).toEqual(['t1', 't2']);
  s = form.apply(s, opts, { kind: 'toggle' });
  expect([...s.labels]).toEqual(['t1']);
});

it('multi: toggling with no option under the cursor is a no-op', () => {
  const bare = declareForm<{ picks: ReadonlySet<string> }, Options, null>({
    fields: (f) => [f.multi('picks', 'Picks', { from: 'empty' })],
    toObject: () => null,
  });
  const s = bare.initial(opts);
  expect(bare.apply(s, opts, { kind: 'toggle' })).toEqual(s);
  expect(bare.apply(s, opts, { kind: 'cursor', dir: 1 }).cursor).toBe(0);
});

it('multi is inert to the text/select intents', () => {
  const s = form.move(start(), 3);
  expect(form.apply(s, opts, { kind: 'insert', text: 'x' })).toEqual(s);
  expect(form.apply(s, opts, { kind: 'cycle', dir: 1 })).toEqual(s);
  expect(form.apply(s, opts, { kind: 'clear' })).toEqual(s);
});

// ---- action ------------------------------------------------------------------

it('action is inert to EVERY value intent — submit is the caller`s business', () => {
  const s = form.move(start(), 99);
  expect(form.activeField(s).kind).toBe('action');
  for (const intent of [
    { kind: 'insert', text: 'x' },
    { kind: 'backspace' },
    { kind: 'newline' },
    { kind: 'cycle', dir: 1 },
    { kind: 'clear' },
    { kind: 'cursor', dir: 1 },
    { kind: 'toggle' },
    { kind: 'submit' },
    { kind: 'cancel' },
  ] as const) {
    expect(form.apply(s, opts, intent)).toEqual(s);
  }
});

// ---- toObject ----------------------------------------------------------------

it('toObject returns the CALLER`s declared shape — the kernel has none of its own', () => {
  let s = start();
  s = form.apply(s, opts, { kind: 'insert', text: 'A bug' });
  s = form.move(s, 3);
  s = form.apply(s, opts, { kind: 'toggle' });
  expect(form.toObject(s, opts)).toEqual({
    text: 'A bug',
    who: { id: 'u1', label: 'cw' },
    tags: [{ id: 't1', label: 'bug' }],
  });
  // Nothing kernel-ish leaks into the object: no `active`, no `cursor`.
  expect(Object.keys(form.toObject(s, opts)).sort()).toEqual([
    'tags',
    'text',
    'who',
  ]);
});

// ---- BB-257 D5: autocomplete ----------------------------------------------
//
// APPENDED ONLY: `autocomplete` is a NEW kind and a NEW `apply` branch, and R1
// forbids touching an existing one — every case above keeps its outcome, and
// the form declared above is left exactly as it was. This block declares its
// own form, which is also how it proves the new kind needs no company.

interface PickValues {
  parent: string | null;
  parentQuery: string;
}

interface PickOptions {
  parents: Option[];
  empty: Option[];
}

// `BB-2` deliberately matches exactly TWO of the three, so a cursor clamped
// against the raw bag (3) is distinguishable from one clamped against the
// filtered list (2) — with three matching rows the two are indistinguishable
// and the whole point of the case would be lost.
const parents: Option[] = [
  { id: 'p1', label: 'BB-137 · multiple conductors per repo' },
  { id: 'p2', label: 'BB-236 · a declared form kernel' },
  { id: 'p3', label: 'BB-257 · the New-ticket popup' },
];

const pickOpts: PickOptions = { parents, empty: [] };

const picker = declareForm<PickValues, PickOptions, PickValues>({
  fields: (f) => [
    f.autocomplete('parent', 'Parent', {
      from: 'parents',
      query: 'parentQuery',
    }),
  ],
  toObject: (v) => v,
});

const typed = (text: string) => {
  let s = picker.initial(pickOpts);
  for (const char of text) {
    s = picker.apply(s, pickOpts, { kind: 'insert', text: char });
  }
  return s;
};

it('autocomplete: initial sets the id null and the query empty', () => {
  const s = picker.initial(pickOpts);
  expect(s.parent).toBeNull();
  expect(s.parentQuery).toBe('');
  expect(s.cursor).toBe(0);
});

it('autocomplete: insert/backspace edit the QUERY, never the id', () => {
  let s = typed('BB-2');
  expect(s.parentQuery).toBe('BB-2');
  expect(s.parent).toBeNull();
  s = picker.apply(s, pickOpts, { kind: 'backspace' });
  expect(s.parentQuery).toBe('bakers.build-');
  // Backspacing an empty query is a no-op, not an error.
  expect(
    picker.apply(picker.initial(pickOpts), pickOpts, { kind: 'backspace' })
      .parentQuery,
  ).toBe('');
});

it('autocomplete: an empty query offers the whole bag', () => {
  const s = { ...picker.initial(pickOpts), cursor: 2 };
  expect(picker.apply(s, pickOpts, { kind: 'pick' }).parent).toBe('p3');
  expect(filterOptions(parents, '')).toEqual(parents);
});

it('filterOptions is EXPORTED, because the renderer shows the same list', () => {
  // The reducer clamps its cursor against the filtered list; if the renderer
  // filtered by a rule of its own, the `›` marker would point at a different
  // row than `pick` takes (D7's "always apply the local filter").
  expect(filterOptions(parents, 'BB-2').map((o) => o.id)).toEqual([
    'p2',
    'p3',
  ]);
  expect(filterOptions(parents, 'POPUP').map((o) => o.id)).toEqual(['p3']);
  expect(filterOptions(parents, 'nope')).toEqual([]);
  expect(filterOptions([], 'anything')).toEqual([]);
  // A space is part of the needle, not a separator: `Option.label` holds
  // spaces and a query must be able to match across them.
  expect(filterOptions(parents, 'conductors per').map((o) => o.id)).toEqual([
    'p1',
  ]);
});

it('autocomplete: filtering is case-insensitive substring over the LABEL', () => {
  // Lower case, and matching the TITLE half of the label rather than the
  // identifier half — one substring rule, both halves (D5).
  const s = picker.apply(typed('form kernel'), pickOpts, { kind: 'pick' });
  expect(s.parent).toBe('p2');
  const upper = picker.apply(typed('bb-257'), pickOpts, { kind: 'pick' });
  expect(upper.parent).toBe('p3');
});

it('autocomplete: the cursor clamps against the FILTERED list, not the bag', () => {
  // `BB-2` matches two of the three rows, so the cursor may reach 1 and no
  // further — clamping against the raw bag would let it sit on a row that is
  // not being offered.
  let s = typed('BB-2');
  s = picker.apply(s, pickOpts, { kind: 'cursor', dir: 1 });
  expect(s.cursor).toBe(1);
  s = picker.apply(s, pickOpts, { kind: 'cursor', dir: 1 });
  expect(s.cursor).toBe(1);
  expect(picker.apply(s, pickOpts, { kind: 'pick' }).parent).toBe('p3');
  s = picker.apply(s, pickOpts, { kind: 'cursor', dir: -1 });
  expect(s.cursor).toBe(0);
  s = picker.apply(s, pickOpts, { kind: 'cursor', dir: -1 });
  expect(s.cursor).toBe(0);
});

it('autocomplete: pick writes the filtered match UNDER THE CURSOR', () => {
  let s = typed('BB-2');
  s = picker.apply(s, pickOpts, { kind: 'cursor', dir: 1 });
  s = picker.apply(s, pickOpts, { kind: 'pick' });
  // The UUID, not the label (D5): two tickets may share a title.
  expect(s.parent).toBe('p3');
  expect(s.parentQuery).toBe('BB-2'); // picking does not rewrite the query
});

it('autocomplete: a query matching nothing offers none and pick is inert', () => {
  const s = typed('nothing matches this');
  expect(picker.apply(s, pickOpts, { kind: 'pick' }).parent).toBeNull();
  // …and so is the cursor, which has nothing to move over.
  expect(picker.apply(s, pickOpts, { kind: 'cursor', dir: 1 }).cursor).toBe(0);
});

it('autocomplete: editing after a pick CLEARS it, and resets the cursor', () => {
  // How AC-7 stays reachable after a mis-pick (D6): backspacing the query to
  // empty leaves no parent selected.
  let s = typed('BB-2');
  s = picker.apply(s, pickOpts, { kind: 'cursor', dir: 1 });
  s = picker.apply(s, pickOpts, { kind: 'pick' });
  expect(s.parent).toBe('p3');
  s = picker.apply(s, pickOpts, { kind: 'backspace' });
  expect(s.parent).toBeNull();
  expect(s.cursor).toBe(0);
  s = picker.apply(s, pickOpts, { kind: 'insert', text: 'x' });
  expect(s.parent).toBeNull();
  expect(s.cursor).toBe(0);
});

it('autocomplete: an EMPTY bag offers nothing and pick is inert', () => {
  const bare = declareForm<PickValues, PickOptions, null>({
    fields: (f) => [
      f.autocomplete('parent', 'Parent', {
        from: 'empty',
        query: 'parentQuery',
      }),
    ],
    toObject: () => null,
  });
  const s = bare.initial(pickOpts);
  expect(bare.apply(s, pickOpts, { kind: 'pick' }).parent).toBeNull();
  expect(bare.apply(s, pickOpts, { kind: 'cursor', dir: 1 }).cursor).toBe(0);
});

it('BB-300 D2 — clear on an autocomplete drops the pick and empties the query', () => {
  let s = typed('BB-2');
  s = picker.apply(s, pickOpts, { kind: 'cursor', dir: 1 });
  s = picker.apply(s, pickOpts, { kind: 'pick' });
  expect(s.parent).toBe('p3');
  s = picker.apply(s, pickOpts, { kind: 'clear' });
  expect(s.parent).toBeNull();
  expect(s.parentQuery).toBe('');
  expect(s.cursor).toBe(0);
});

it('autocomplete is inert to the select/multi intents', () => {
  const s = typed('bakers.build');
  expect(picker.apply(s, pickOpts, { kind: 'cycle', dir: 1 })).toEqual(s);
  expect(picker.apply(s, pickOpts, { kind: 'toggle' })).toEqual(s);
  expect(picker.apply(s, pickOpts, { kind: 'newline' })).toEqual(s);
});

it('R1: `pick` is inert on every PRE-EXISTING kind', () => {
  // The new intent must not reach the shared branches — the mechanical form of
  // "no existing branch is touched".
  for (const active of [0, 1, 2, 3, 4]) {
    const s = form.move(start(), active);
    expect(form.apply(s, opts, { kind: 'pick' })).toEqual(s);
  }
});

// ---- cycleValue, the one shared primitive -----------------------------------

it('cycleValue keeps its pre-BB-233 contract when not clearable', () => {
  const list = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ];
  expect(cycleValue(list, 'b', 1)).toBe('a');
  expect(cycleValue(list, 'a', -1)).toBe('b');
  expect(cycleValue(list, 'gone', 1)).toBe('a');
  expect(cycleValue([], 'a', 1)).toBe('a');
  // Clearable: an empty list means "cleared" is the only position there is.
  expect(cycleValue([], 'a', 1, true)).toBeNull();
});
