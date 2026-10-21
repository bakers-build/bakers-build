import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import type { FieldDecl } from '../../src/Form/index.js';
import { displayWidth } from '../../src/lib/width.js';
import actionWidget from '../../src/Widget/action.js';
import autocompleteWidget from '../../src/Widget/autocomplete.js';
import {
  renderDeclaredFieldsTree,
  WIDGETS,
  widgetFor,
} from '../../src/Widget/index.js';
import multiselectWidget from '../../src/Widget/multiselect.js';
import selectWidget from '../../src/Widget/select.js';
import textWidget from '../../src/Widget/text.js';
import { nodeById, renderTree } from '../render-tree.js';

// BB-257 (re-entry) AC-10 / AC-11 / AC-13 — the widget registry and the one
// iteration both popups render through.
//
// Before this change there was no widget layer at all: `createFormLines` carried
// prose wrap, the search box, the suggestion window, the checkbox list, the
// `< value >` ring and `[ … ]` inline, and `editFormLines` carried a second,
// smaller copy measured in a DIFFERENT unit. So every assertion in this file is
// RED on `41e0b74c` for the plainest possible reason — the module it imports does
// not exist.
//
// BB-340 Task 9 — that iteration is `renderDeclaredFieldsTree` and it returns a
// TREE, so the rows below are the text its nodes carry. The one thing that is not
// in the text is an FOREGROUND_ACTIVE `text`/`autocomplete` field's value block, which is a
// `FieldTextarea` node; where a case depends on that, it is asserted on the
// widget's own `value` instead of dropped.

/** The rows a declaration draws: the text its tree carries, in tree order. */
const renderRows = (
  ...args: Parameters<typeof renderDeclaredFieldsTree>
): string[] => renderTree(renderDeclaredFieldsTree(...args));

const decl = (over: Partial<FieldDecl> & { id: string }): FieldDecl => ({
  label: over.id,
  kind: 'text',
  ...over,
});

/** A state object shaped the way `FormState<V>` is: flat, plus the kernel's two. */
const state = (over: Record<string, unknown> = {}) => ({
  active: 0,
  cursor: 0,
  ...over,
});

it('AC-10: every field kind has exactly one widget, and it is that module`s default export', () => {
  // "Exactly one place that renders it" as a property of the tree, not of a
  // reader's diligence: the registry key IS the module name and the module
  // DEFAULT-exports the widget, so a second renderer for a kind has nowhere to
  // hide. Imported statically, one line per kind, because that is the form the
  // bundler can check — and because a list that has to be edited when a kind is
  // added is exactly the reminder AC-10 wants.
  const modules: Record<string, unknown> = {
    action: actionWidget,
    autocomplete: autocompleteWidget,
    multiselect: multiselectWidget,
    select: selectWidget,
    text: textWidget,
  };
  expect(Object.keys(WIDGETS).sort()).toEqual(Object.keys(modules).sort());
  for (const [kind, widget] of Object.entries(modules)) {
    expect(WIDGETS[kind as keyof typeof WIDGETS]).toBe(widget);
  }
  // …and the directory holds one file per kind, not a drawer of near-misses.
  const widgetDir = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'Widget',
  );
  for (const kind of Object.keys(modules)) {
    expect(existsSync(join(widgetDir, `${kind}.ts`))).toBe(true);
  }
});

it('AC-10: `widgetFor` resolves a declaration to its kind`s widget', () => {
  expect(widgetFor(decl({ id: 'a', kind: 'select' }))).toBe(WIDGETS.select);
  expect(widgetFor(decl({ id: 'b', kind: 'action' }))).toBe(WIDGETS.action);
});

it('AC-11: a popup renders by WALKING its declaration, in declaration order', () => {
  const fields = [
    decl({ id: 'title', label: 'Title', kind: 'text' }),
    decl({ id: 'owner', label: 'Owner', kind: 'select', from: 'people' }),
    decl({ id: 'go', label: 'Go', kind: 'action' }),
  ];
  const rows = renderRows(
    fields,
    state({ title: '', owner: 'p1', go: null }),
    { people: [{ id: 'p1', label: 'ada' }] },
    { width: 58 },
  );
  expect(rows[0]).toBe('▸ Title:');
  expect(rows).toContain('  Owner: < ada >');
  expect(rows).toContain('  [ Go ]');
});

it('AC-11: INSERTING a field into the declaration makes it appear, unaided', () => {
  // The criterion in one assertion: the renderer is given a longer declaration
  // and nothing else changes. Before the widget layer the row order was written
  // out by name in the component, so a new field appeared only after the
  // component was edited.
  const base = [
    decl({ id: 'title', label: 'Title', kind: 'text' }),
    decl({ id: 'go', label: 'Go', kind: 'action' }),
  ];
  const inserted = [
    base[0] as FieldDecl,
    decl({ id: 'owner', label: 'Owner', kind: 'select', from: 'people' }),
    base[1] as FieldDecl,
  ];
  const options = { people: [{ id: 'p1', label: 'ada' }] };
  const values = state({ title: '', owner: 'p1', go: null });
  const before = renderRows(base, values, options, { width: 58 });
  const after = renderRows(inserted, values, options, { width: 58 });
  expect(before).not.toContain('  Owner: < ada >');
  expect(after).toContain('  Owner: < ada >');
  // …and it lands BETWEEN its neighbours, not appended at the end.
  expect(after.indexOf('  Owner: < ada >')).toBeLessThan(
    after.indexOf('  [ Go ]'),
  );
});

it('AC-11: the active marker follows the declaration index, never a literal', () => {
  const fields = [
    decl({ id: 'title', label: 'Title', kind: 'text' }),
    decl({ id: 'owner', label: 'Owner', kind: 'select', from: 'people' }),
    decl({ id: 'go', label: 'Go', kind: 'action' }),
  ];
  for (let active = 0; active < fields.length; active++) {
    const rows = renderRows(
      fields,
      state({ title: '', owner: null, go: null, active }),
      { people: [] },
      { width: 58 },
    );
    const marked = rows.filter((r) => r.startsWith('▸ '));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain(fields[active]?.label ?? '');
  }
});

it('AC-13: the inline value column is shared by every field that has one', () => {
  // Both popups align `< value >` under one column. Derived from the fields that
  // actually carry an inline value, so the alignment is a property of the
  // declaration rather than a magic number copied into two components.
  const rows = renderRows(
    [
      decl({ id: 'a', label: 'Assignee', kind: 'select', from: 'people' }),
      decl({ id: 'c', label: 'Conductor', kind: 'select', from: 'people' }),
    ],
    state({ a: null, c: null }),
    { people: [] },
    { width: 58 },
  );
  expect(rows).toEqual(['▸ Assignee:  < — >', '  Conductor: < — >']);
});

it('AC-14: every row it emits fits the budget in DISPLAY columns', () => {
  const fields = [decl({ id: 'title', label: 'Title', kind: 'text' })];
  const value = '価'.repeat(200);
  const rows = renderRows(
    fields,
    state({ title: value, active: -1 }),
    {},
    {
      width: 40,
    },
  );
  // Not `row.length`: a CJK ideograph is one UTF-16 code unit and TWO columns,
  // and it is the columns the frame truncates against.
  for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(40);
  expect(rows.length).toBeGreaterThan(1);
  // BB-340 Task 9 — and with the field FOREGROUND_ACTIVE the same value is the widget's,
  // so the wrap is asserted where it now lives rather than dropped: the block's
  // rows carry the whole value and each of them fits the same budget.
  const active = renderDeclaredFieldsTree(
    fields,
    state({ title: value }),
    {},
    { width: 40 },
  );
  const wrapped = (
    (nodeById(active, 'field-title-input')?.props as { value?: string })
      ?.value ?? ''
  ).split('\n');
  expect(wrapped.length).toBeGreaterThan(1);
  expect(wrapped.join('')).toBe(value);
  for (const row of wrapped) {
    expect(displayWidth(row)).toBeLessThanOrEqual(40 - 4);
  }
});
