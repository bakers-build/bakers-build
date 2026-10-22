import { expect, it } from 'vitest';
import type { FieldDecl } from '../../src/Form/index.js';
import { displayWidth } from '../../src/lib/width.js';
import { renderDeclaredFieldsTree } from '../../src/Widget/index.js';
import { nodeById, renderTree } from '../render-tree.js';

// BB-257 (re-entry) AC-10 — one renderer per field kind, exercised through the
// one entry point a popup uses. Asserting the KINDS here rather than in each
// popup's own test is the point of the layer: a change to how a kind looks is
// made once and is visible in every popup that declares it.
//
// BB-340 Task 9 — that entry point is `renderDeclaredFieldsTree`, and the rows
// are the text its nodes carry (`renderTree`). One exception, called out where it
// happens: an FOREGROUND_ACTIVE `text`/`autocomplete` field's value block is a
// `FieldTextarea` node, so its characters are the widget's `value` and are
// deliberately NOT in the text surface — emitting them twice would paint the same
// cells under a live cursor.

const decl = (over: Partial<FieldDecl> & { id: string }): FieldDecl => ({
  label: over.id,
  kind: 'text',
  ...over,
});

/** The rows a declaration draws: the text its tree carries, in tree order. */
const rowsOf = (
  ...args: Parameters<typeof renderDeclaredFieldsTree>
): string[] => renderTree(renderDeclaredFieldsTree(...args));

const render = (
  field: FieldDecl,
  values: Record<string, unknown>,
  options: Record<string, unknown> = {},
  chrome: { width?: number; error?: string; trusted?: boolean } = {},
): string[] =>
  rowsOf([field], { active: -1, cursor: 0, ...values }, options, {
    width: chrome.width ?? 58,
    ...(chrome.error === undefined
      ? {}
      : { errorFor: () => chrome.error as string }),
    ...(chrome.trusted === undefined ? {} : { trusted: chrome.trusted }),
  });

/** The rendered rows with the two-column active/idle marker stripped off row 0. */
const body = (rows: string[]): string[] => [
  (rows[0] ?? '').slice(2),
  ...rows.slice(1),
];

// ---- text -------------------------------------------------------------------

it('text: an empty value renders the `<empty>` placeholder under its label', () => {
  expect(
    body(render(decl({ id: 'd', label: 'Description' }), { d: '' })),
  ).toEqual(['Description:', '    <empty>']);
});

it('text: prose soft-wraps to the budget and keeps the body indent', () => {
  const typed = 'x'.repeat(120);
  const rows = body(
    render(decl({ id: 'd', label: 'Description' }), { d: typed }),
  );
  expect(rows[0]).toBe('Description:');
  for (const row of rows.slice(1)) expect(row.startsWith('    ')).toBe(true);
  expect(
    rows
      .slice(1)
      .map((r) => r.slice(4))
      .join(''),
  ).toBe(typed);
});

// ---- select -----------------------------------------------------------------

it('select: renders the current option between the ring markers', () => {
  const rows = render(
    decl({ id: 'a', label: 'Assignee', kind: 'select', from: 'users' }),
    { a: 'u1' },
    { users: [{ id: 'u1', label: 'cw' }] },
  );
  expect(body(rows)).toEqual(['Assignee: < cw >']);
});

it('select: an unknown id renders `—`; a CLEARABLE null renders `— none —`', () => {
  // The distinction is the kind's own, and it is why the edit popup could not
  // simply reuse the create popup's label lookup: only a clearable select has a
  // real "removed" state to name (BB-233 AC-4).
  const plain = decl({ id: 'a', label: 'Assignee', kind: 'select', from: 'u' });
  expect(body(render(plain, { a: 'gone' }, { u: [] }))).toEqual([
    'Assignee: < — >',
  ]);
  expect(body(render(plain, { a: null }, { u: [] }))).toEqual([
    'Assignee: < — >',
  ]);
  const clearable = { ...plain, clearable: true };
  expect(body(render(clearable, { a: null }, { u: [] }))).toEqual([
    'Assignee: < — none — >',
  ]);
  expect(body(render(clearable, { a: 'gone' }, { u: [] }))).toEqual([
    'Assignee: < — >',
  ]);
});

// ---- multiselect ------------------------------------------------------------

const labels = decl({
  id: 'l',
  label: 'Labels',
  kind: 'multiselect',
  from: 'labels',
});
const LABEL_BAG = {
  labels: [
    { id: 'l1', label: 'bug' },
    { id: 'l2', label: 'ui' },
  ],
};

it('multiselect: draws a checkbox per option and the cursor only while active', () => {
  const idle = render(labels, { l: new Set(['l2']) }, LABEL_BAG);
  expect(body(idle)).toEqual(['Labels:', '    [ ] bug', '    [x] ui']);
  const active = rowsOf(
    [labels],
    { active: 0, cursor: 1, l: new Set<string>() },
    LABEL_BAG,
    { width: 58 },
  );
  expect(active).toEqual(['▸ Labels:', '    [ ] bug', '   ›[ ] ui']);
});

it('multiselect: an empty bag says so, unless the whole load is untrusted', () => {
  expect(body(render(labels, { l: new Set() }, { labels: [] }))).toEqual([
    'Labels:',
    '    (none available)',
  ]);
  // A form-level failure withdraws the claim: no read succeeded, so "empty" is
  // not something the popup knows.
  expect(
    body(render(labels, { l: new Set() }, { labels: [] }, { trusted: false })),
  ).toEqual(['Labels:']);
});

it('multiselect: it draws its OWN bag failure, in place of the empty note', () => {
  expect(
    body(
      render(
        labels,
        { l: new Set() },
        { labels: [] },
        { error: 'Labels boom' },
      ),
    ),
  ).toEqual(['Labels:', '    ⚠ Labels boom']);
});

// ---- autocomplete -----------------------------------------------------------

const parent = decl({
  id: 'p',
  label: 'Parent',
  kind: 'autocomplete',
  from: 'parents',
  query: 'pq',
  pageSize: 50,
  absentNote: '(no project context — open a project to pick a parent)',
});

const candidates = (count: number, from = 0) =>
  Array.from({ length: count }, (_, i) => ({
    id: `k${from + i}`,
    label: `BB-${100 + from + i} · candidate ${from + i}`,
  }));

it('autocomplete: idle it shows the picked label, or `—` when nothing is picked', () => {
  const bag = { parents: candidates(3) };
  expect(body(render(parent, { p: 'k1', pq: '' }, bag))).toEqual([
    'Parent: BB-101 · candidate 1',
  ]);
  expect(body(render(parent, { p: null, pq: '' }, bag))).toEqual(['Parent: —']);
});

it('autocomplete: an ABSENT bag renders the declaration`s own note', () => {
  // Absent means "nothing can be offered"; an empty ARRAY means "searched and
  // nothing matched". The wording is domain text, so it rides on the field
  // declaration as plain data rather than being hardcoded in a shared widget.
  expect(body(render(parent, { p: null, pq: '' }, {}))).toEqual([
    'Parent: —',
    '    (no project context — open a project to pick a parent)',
  ]);
});

it('autocomplete: active it draws the search box and the `›` cursor', () => {
  const tree = renderDeclaredFieldsTree(
    [parent],
    { active: 0, cursor: 1, p: null, pq: 'BB-10' },
    { parents: candidates(3) },
    { width: 58 },
  );
  const rows = renderTree(tree);
  expect(rows[0]).toBe('▸ Parent: —');
  // BB-326 (widget-fit F2): no `▌` — the insertion point is a terminal cursor.
  // BB-340 Task 9: it is the widget that OWNS the query row, so the search box
  // is that widget's value rather than a row of text.
  // `tests/Widget/autocomplete-caret.test.ts` owns the rest of the claim.
  expect(
    (nodeById(tree, 'field-p-input')?.props as { value?: string })?.value,
  ).toBe('search: BB-10');
  expect(rows).not.toContain('    search: BB-10');
  expect(rows.filter((r) => r.includes('›'))).toHaveLength(1);
  expect(rows.some((r) => r.startsWith('   ›BB-101'))).toBe(true);
});

it('AC-17: at the page cap the incompleteness note SURVIVES a narrowing filter', () => {
  // The observation the review carried in: with the bag at the server page cap
  // and the local filter narrowing it below the render window, `+N more` went to
  // zero and the popup silently implied the list was complete — for up to one
  // debounce interval, and permanently whenever the re-query lands another capped
  // page. The cap is a property of the LOADED BAG, so the disclosure is too.
  const capped = { parents: candidates(50) };
  const rows = rowsOf(
    [parent],
    { active: 0, cursor: 0, p: null, pq: 'BB-149' },
    capped,
    { width: 58 },
  );
  // The filter leaves one match, so the render window hides nothing…
  expect(rows.filter((r) => /^ {3}[›\s]BB-/.test(r))).toHaveLength(1);
  expect(rows.some((r) => /\+\d+ more/.test(r))).toBe(false);
  // …and the popup still says the bag it filtered may be incomplete.
  expect(
    rows.some((r) => r.includes('more may exist — narrow the search')),
  ).toBe(true);
});

it('AC-17: below the page cap a fully-shown list claims nothing', () => {
  const rows = rowsOf(
    [parent],
    { active: 0, cursor: 0, p: null, pq: '' },
    { parents: candidates(3) },
    { width: 58 },
  );
  expect(rows.some((r) => r.includes('narrow the search'))).toBe(false);
});

it('autocomplete: every row is clipped to the budget in display columns', () => {
  const wide = [{ id: 'k9', label: `BB-999 · ${'⚡ '.repeat(60)}` }];
  const tree = renderDeclaredFieldsTree(
    [parent],
    { active: 0, cursor: 0, p: 'k9', pq: 'x'.repeat(120) },
    { parents: wide },
    { width: 58 },
  );
  for (const row of renderTree(tree)) {
    expect(displayWidth(row)).toBeLessThanOrEqual(58);
  }
  // BB-340 Task 9 — the query row left the text surface for the widget, so the
  // over-long query is asserted where it now lives: every row of the block's own
  // wrapped value fits the same budget, and the block reserves one column more
  // than the widest of them for the cursor that sits past the last character.
  const input = nodeById(tree, 'field-p-input')?.props as {
    value?: string;
    width?: number;
  };
  const wrapped = (input?.value ?? '').split('\n');
  for (const row of wrapped) {
    expect(displayWidth(row)).toBeLessThanOrEqual(58 - 4);
  }
  expect(input?.width).toBe(58 - 4 + 1);
});

// ---- action -----------------------------------------------------------------

it('action: renders its label between the button brackets', () => {
  expect(
    body(render(decl({ id: 's', label: 'Create ticket', kind: 'action' }), {})),
  ).toEqual(['[ Create ticket ]']);
});
