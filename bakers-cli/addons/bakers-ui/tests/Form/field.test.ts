import { expect, it } from 'vitest';
import { fieldFactory, type Option } from '../../src/Form/field.js';

// BB-236 AC-1/AC-2 (spec Decisions 1 + 2): a field is PLAIN DATA. `kind` names
// the behaviour and `from` names the option list by key — no closures, so the
// declaration stays printable, snapshot-testable and walkable by a renderer.

interface Values {
  description: string;
  assignee: string | null;
  labels: ReadonlySet<string>;
  /** BB-257 D5 — an autocomplete field's TWO keys: the picked id… */
  parent: string | null;
  /** …and the typed query, a plain non-nullable string. */
  parentQuery: string;
}

interface Options {
  users: Option[];
  labels: Option[];
  parents: Option[];
}

const f = fieldFactory<Values, Options>();

it('every produced field is plain data — no functions anywhere on it', () => {
  const declared = [
    f.text('description', 'Description'),
    f.select('assignee', 'Assignee', { from: 'users' }),
    f.multi('labels', 'Labels', { from: 'labels' }),
    f.autocomplete('parent', 'Parent', {
      from: 'parents',
      query: 'parentQuery',
    }),
    f.action('Create ticket'),
  ];
  for (const field of declared) {
    expect(Object.values(field).every((v) => typeof v !== 'function')).toBe(
      true,
    );
  }
});

it('text carries only id/label/kind', () => {
  expect(f.text('description', 'Description')).toEqual({
    id: 'description',
    label: 'Description',
    kind: 'text',
  });
});

it('select names its option list by BAG KEY, not by a projection function', () => {
  const field = f.select('assignee', 'Assignee', { from: 'users' });
  expect(field.kind).toBe('select');
  expect(field.from).toBe('users');
});

it('clearable is ABSENT unless asked for — the create form declares none', () => {
  const plain = f.select('assignee', 'Assignee', { from: 'users' });
  expect(Object.hasOwn(plain, 'clearable')).toBe(false);
  expect(plain.clearable).toBeUndefined();

  const clearable = f.select('assignee', 'Assignee', {
    from: 'users',
    clearable: true,
  });
  expect(clearable.clearable).toBe(true);

  // An explicit `false` is the default, so it stays absent too.
  const explicitFalse = f.select('assignee', 'Assignee', {
    from: 'users',
    clearable: false,
  });
  expect(Object.hasOwn(explicitFalse, 'clearable')).toBe(false);
});

it('multi is kind `multiselect` and also names its bag key', () => {
  expect(f.multi('labels', 'Labels', { from: 'labels' })).toEqual({
    id: 'labels',
    label: 'Labels',
    kind: 'multiselect',
    from: 'labels',
  });
});

// ---- BB-257 D5: the fifth kind ---------------------------------------------
//
// APPENDED ONLY — `autocomplete` is purely additive (spec R1), so every case
// above must keep its outcome. Two keys, both named BY KEY like `from` already
// is: the picked id and the typed query. The kernel stays domain-free; that a
// substring of the label matches "identifier OR title" is the ADAPTER's doing,
// which composes the label as `BB-nnn · <title>`.

it('autocomplete names both its option bag and its query key, by key', () => {
  expect(
    f.autocomplete('parent', 'Parent', {
      from: 'parents',
      query: 'parentQuery',
    }),
  ).toEqual({
    id: 'parent',
    label: 'Parent',
    kind: 'autocomplete',
    from: 'parents',
    query: 'parentQuery',
  });
});

it('autocomplete`s typed key sets reject a wrong-typed key', () => {
  // The same COMPILE-level guard the other kinds carry (`f.text` takes a
  // non-nullable string key, `f.select` a nullable one). Asserted the way they
  // are — this package's tsconfig includes only `src/**/*.ts`, so the test tree
  // is transpiled and never type-checked, and the proof is that the real call
  // site in `Entity/ticket/Form/create.ts` compiles. What IS checkable here is
  // that the two keys stay distinct and land in distinct slots, so a swap of
  // `from` and `query` cannot pass unnoticed.
  const field = f.autocomplete('parent', 'Parent', {
    from: 'parents',
    query: 'parentQuery',
  });
  expect(field.from).toBe('parents'); // an Options key, never a Values key
  expect(field.query).toBe('parentQuery'); // a Values TextKey, never the id
  expect(field.query).not.toBe(field.id);
});

it('`query` is ABSENT on every other kind', () => {
  for (const other of [
    f.text('description', 'Description'),
    f.select('assignee', 'Assignee', { from: 'users' }),
    f.multi('labels', 'Labels', { from: 'labels' }),
    f.action('Create ticket'),
  ]) {
    expect(Object.hasOwn(other, 'query')).toBe(false);
  }
});

it('action defaults its id to `submit` and names no option list', () => {
  expect(f.action('Create ticket')).toEqual({
    id: 'submit',
    label: 'Create ticket',
    kind: 'action',
  });
  // …and an explicit id is honoured, for a form with more than one action.
  expect(f.action('Save assignment', 'save').id).toBe('save');
});
