import { expect, it } from 'vitest';
import {
  WHO_FILTER_FORM,
  type WhoFilterOptions,
  type WhoFilterState,
} from '../../../../src/Entity/ticket/Form/who-filter.js';

// BB-299 D5 — the who-filter picker as a declaration: exactly ONE
// autocomplete field over the `who` bag, and a payload that yields the picked
// user's `{ id, label }` — the shape `TicketCriteria.who` carries (D3), so the
// summary can name the user without a lookup.

const CANDIDATES = [
  { id: 'u1', label: 'cw' },
  { id: 'u2', label: 'tm' },
];

const opts: WhoFilterOptions = { who: CANDIDATES };

const initial = (): WhoFilterState => WHO_FILTER_FORM.initial(opts);

it('declares exactly the one autocomplete field, over the who bag', () => {
  const fields = WHO_FILTER_FORM.fields;
  expect(fields.map((f) => f.id)).toEqual(['who']);
  const who = fields[0];
  expect(who?.kind).toBe('autocomplete');
  expect(who?.label).toBe('Who');
  expect(who?.from).toBe('who');
  expect(who?.query).toBe('whoQuery');
});

it('starts with nothing picked and an empty query', () => {
  const s = initial();
  expect(s.who).toBeNull();
  expect(s.whoQuery).toBe('');
  expect(WHO_FILTER_FORM.toObject(s, opts)).toBeNull();
});

it('typing narrows via the kernel filter over the label', () => {
  let s = initial();
  s = WHO_FILTER_FORM.apply(s, opts, { kind: 'insert', text: 'c' });
  expect(s.whoQuery).toBe('c');
  s = WHO_FILTER_FORM.apply(s, opts, { kind: 'cursor', dir: 1 });
  expect(s.cursor).toBe(0); // clamped at the one match
});

it('a pick makes the payload the candidate`s id and label (D3)', () => {
  let s = initial();
  s = WHO_FILTER_FORM.apply(s, opts, { kind: 'insert', text: 't' });
  s = WHO_FILTER_FORM.apply(s, opts, { kind: 'cursor', dir: 1 });
  s = WHO_FILTER_FORM.apply(s, opts, { kind: 'pick' });
  expect(s.who).toBe('u2');
  expect(WHO_FILTER_FORM.toObject(s, opts)).toEqual({ id: 'u2', label: 'tm' });
});

it('a pick no longer in the bag yields null, not a phantom id', () => {
  // The bag is swapped on every debounced re-query, so a pick can outlive the
  // row it came from (the parent filter's D6 rule, applied).
  const stale: WhoFilterState = { ...initial(), who: 'gone' };
  expect(WHO_FILTER_FORM.toObject(stale, opts)).toBeNull();
});

it('editing after a pick drops it', () => {
  let s = initial();
  s = WHO_FILTER_FORM.apply(s, opts, { kind: 'pick' });
  expect(s.who).toBe('u1');
  s = WHO_FILTER_FORM.apply(s, opts, { kind: 'backspace' });
  expect(s.who).toBeNull();
});

it('an absent bag is a legal state — the payload is null', () => {
  const s = WHO_FILTER_FORM.initial({});
  expect(s.who).toBeNull();
  expect(WHO_FILTER_FORM.toObject(s, {})).toBeNull();
});
