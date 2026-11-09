import { expect, it } from 'vitest';
import {
  PARENT_FILTER_FORM,
  type ParentFilterOptions,
  type ParentFilterState,
} from '../../../../src/Entity/ticket/Form/parent-filter.js';

// BB-284 D4 — the parent-filter picker as a declaration: exactly ONE
// autocomplete field over the `parents` bag, and a payload that yields the
// picked parent's `{ id, identifier }` — the shape `TicketCriteria.parent`
// carries (D1), so the summary can name the identifier without a lookup (AC-2).

const PARENTS = [
  {
    id: 'k1',
    label: 'BB-236 · a declared form kernel',
    identifier: 'BB-236',
    title: 'a declared form kernel',
  },
  {
    id: 'k2',
    label: 'BB-257 · the New-ticket popup',
    identifier: 'BB-257',
    title: 'the New-ticket popup',
  },
];

const opts: ParentFilterOptions = { parents: PARENTS };

const initial = (): ParentFilterState => PARENT_FILTER_FORM.initial(opts);

it('declares exactly the one autocomplete field, over the parents bag', () => {
  const fields = PARENT_FILTER_FORM.fields;
  expect(fields.map((f) => f.id)).toEqual(['parent']);
  const parent = fields[0];
  expect(parent?.kind).toBe('autocomplete');
  expect(parent?.label).toBe('Parent');
  expect(parent?.from).toBe('parents');
  expect(parent?.query).toBe('parentQuery');
});

it('starts with nothing picked and an empty query', () => {
  const s = initial();
  expect(s.parent).toBeNull();
  expect(s.parentQuery).toBe('');
  expect(PARENT_FILTER_FORM.toObject(s, opts)).toBeNull();
});

it('typing narrows via the kernel filter over the label', () => {
  let s = initial();
  s = PARENT_FILTER_FORM.apply(s, opts, { kind: 'insert', text: 'BB-2' });
  expect(s.parentQuery).toBe('BB-2');
  // Both candidates match on the identifier half of the label (D5); the cursor
  // clamps against the FILTERED list, so ←/→ can only land on a match.
  s = PARENT_FILTER_FORM.apply(s, opts, { kind: 'cursor', dir: 1 });
  expect(s.cursor).toBe(1);
  s = PARENT_FILTER_FORM.apply(s, opts, { kind: 'cursor', dir: 1 });
  expect(s.cursor).toBe(1); // clamped at the last match
});

it('a pick makes the payload the candidate`s id and identifier — no title (AC-2)', () => {
  let s = initial();
  s = PARENT_FILTER_FORM.apply(s, opts, { kind: 'insert', text: 'BB-2' });
  s = PARENT_FILTER_FORM.apply(s, opts, { kind: 'cursor', dir: 1 });
  s = PARENT_FILTER_FORM.apply(s, opts, { kind: 'pick' });
  expect(s.parent).toBe('k2');
  expect(PARENT_FILTER_FORM.toObject(s, opts)).toEqual({
    id: 'k2',
    identifier: 'BB-257',
  });
});

it('a pick no longer in the bag yields null, not a phantom id', () => {
  // The bag is swapped on every debounced re-query (BB-257 D7), so a pick can
  // outlive the row it came from.
  const stale: ParentFilterState = { ...initial(), parent: 'gone' };
  expect(PARENT_FILTER_FORM.toObject(stale, opts)).toBeNull();
});

it('editing after a pick drops it (AC-7 stays reachable)', () => {
  let s = initial();
  s = PARENT_FILTER_FORM.apply(s, opts, { kind: 'pick' });
  expect(s.parent).toBe('k1');
  s = PARENT_FILTER_FORM.apply(s, opts, { kind: 'backspace' });
  expect(s.parent).toBeNull();
});

it('an absent bag is a legal state — the payload is null', () => {
  const s = PARENT_FILTER_FORM.initial({});
  expect(s.parent).toBeNull();
  expect(PARENT_FILTER_FORM.toObject(s, {})).toBeNull();
});
