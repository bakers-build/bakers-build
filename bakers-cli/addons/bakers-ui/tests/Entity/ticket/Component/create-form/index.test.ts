import { expect, it } from 'vitest';
import { createFormTree } from '../../../../../src/Entity/ticket/Component/create-form/index.js';
import {
  type CreateFormOptions,
  FIELDS,
  initialForm,
  toggleLabel,
} from '../../../../../src/Entity/ticket/Form/create.js';
import { displayWidth } from '../../../../../src/lib/width.js';
import { FieldTextarea } from '../../../../../src/Widget/textarea.js';
import { nodeById, renderTree } from '../../../../render-tree.js';

// BB-340 Task 9 — the SAME claims, one layer down.
//
// The popup hands over a renderable TREE, so what used to be an array of
// composed rows is the text its nodes carry, read back in tree order by
// `renderTree`. Every assertion below is the one that was here before; only the
// surface it reads changed — with the one exception the conversion really does
// change, which is called out where it happens: the FOREGROUND_ACTIVE `text`/`autocomplete`
// field's value block is a `FieldTextarea` NODE, so its characters are the
// widget's `value` rather than a row of text.

/** The popup's rows: the text its tree carries, in the order it is drawn.
 *  Fixed to the project-in-scope field list (`FIELDS`) — every case below
 *  exercises the form unchanged by BB-664 AC-8's Project field. */
const rowsOf = (
  ...args: Parameters<typeof createFormTree> extends [unknown, ...infer Rest]
    ? Rest
    : never
): string[] => renderTree(createFormTree(FIELDS, ...args));

const opts: CreateFormOptions = {
  users: [{ id: 'u1', label: 'cw' }],
  reviewers: [{ id: 'u1', label: 'cw' }],
  conductors: [{ id: 'c1', label: 'cw-framework' }],
  labels: [
    { id: 'l1', label: 'bug' },
    { id: 'l2', label: 'ui' },
  ],
  workflows: [{ id: 'bb_feature', label: 'feature' }],
};

it('renders every field with the active marker and current values', () => {
  const lines = rowsOf(initialForm(opts), opts).join('\n');
  expect(lines).toMatch(/▸ Title:/); // field 0 active (BB-309 D1)
  expect(lines).toMatch(/Description:/);
  expect(lines).toMatch(/<empty>/);
  expect(lines).toMatch(/Assignee:\s+< cw >/);
  expect(lines).toMatch(/Reviewers:/);
  expect(lines).toMatch(/Conductor:\s+< cw-framework >/);
  expect(lines).toMatch(/Workflow:\s+< feature >/);
  expect(lines).toMatch(/\[ Create with agent \]/);
  expect(lines).toMatch(/\[ Create directly \]/);
  expect(lines).toMatch(/\[ \] bug/);
  expect(lines).toMatch(/\[ \] ui/);
});

it('shows checked labels and the label cursor when labels field active', () => {
  let s = initialForm(opts);
  // Named, not counted: BB-257 inserted `parent` above Labels (spec F5/D2).
  s = { ...s, active: FIELDS.findIndex((f) => f.id === 'labels'), cursor: 1 };
  s = toggleLabel(s, opts); // toggles the cursor label (l2 / ui)
  const lines = rowsOf(s, opts);
  expect(lines.join('\n')).toMatch(/\[x\] ui/);
  expect(lines.some((l) => l.includes('›') && l.includes('ui'))).toBe(true);
});

it('renders an empty-labels note', () => {
  const lines = rowsOf(initialForm({ ...opts, labels: [] }), {
    ...opts,
    labels: [],
  });
  expect(lines.join('\n')).toMatch(/\(none available\)/);
});

// ---- BB-257 AC-1 / AC-8 (D1, D2) -----------------------------------------
//
// APPENDED ONLY: this file is one of the three AC-8 contract files, so nothing
// above may change its outcome.
//
// The modal box clips a row that does not fit its inner width. So "the
// description runs past the frame" is really "the description is clipped at the
// frame" (spec F1) — same defect for the writer.
//
// BB-340 Task 12: the assertions below used to be stated against `fitLine`'s
// own behaviour (`fitLine(line, 58)` emits `…` exactly when it dropped a tail),
// because the box was composed text. The box's frame is the renderer's now and
// `fitLine` is deleted with `lib/ansi.ts`, so each of those pairs collapses onto
// the property it was a proxy for and which the file already asserts beside it:
// the row fits the box's inner width in DISPLAY columns. That is spec R5's
// mitigation intact — the budget is still not a hand-counted column.

/**
 * The description body rows: everything between its header and the next field.
 *
 * The next field is `Parent:` since BB-257 inserted it there — a boundary
 * marker, not a claim: every assertion these rows carry is unchanged.
 */
const bodyRows = (lines: string[]): string[] => {
  const start = lines.findIndex((l) => l.includes('Description:')) + 1;
  const end = lines.findIndex((l) => l.includes('Parent:'));
  return lines.slice(start, end);
};

/**
 * The row without the BB-283 caret's inverse-video SGR. The caret is drawn
 * AROUND a character of the active field — presentation, never text — so the
 * AC-1 assertions below, which pin that every typed character survives the
 * wrap, strip it before comparing strings.
 */
const uncaret = (row: string): string =>
  row.replaceAll('\x1b[7m', '').replaceAll('\x1b[27m', '');

it('AC-1: soft-wraps a long description so no row is clipped by the frame', () => {
  const typed = 'x'.repeat(200);
  const lines = rowsOf({ ...initialForm(opts), description: typed }, opts, {
    width: 58,
  });
  for (const line of lines) {
    // The row fits, so the box has nothing to clip — see the note above on why
    // this is one assertion where it used to be two.
    expect(displayWidth(line)).toBeLessThanOrEqual(58);
  }
  // AC-1's "no character is clipped": every typed character is still on a row.
  expect(
    bodyRows(lines)
      .map((l) => uncaret(l.slice(4)))
      .join(''),
  ).toBe(typed);
  expect(bodyRows(lines).length).toBeGreaterThan(1);
});

it('AC-1: wraps prose on word boundaries and keeps the body indent', () => {
  const typed =
    'The New ticket popup must let the writer read back the whole sentence they just typed, not only the first sixty columns of it.';
  const lines = rowsOf({ ...initialForm(opts), description: typed }, opts, {
    width: 58,
  });
  for (const line of lines) {
    // One assertion where it used to be two: `fitLine(line, 58)` carried no `…`
    // exactly when the row fitted, and the row fitting is what is asserted on
    // the line above (see the note at the head of this section).
    expect(displayWidth(line)).toBeLessThanOrEqual(58);
  }
  const body = bodyRows(lines);
  for (const row of body) expect(row.startsWith('    ')).toBe(true);
  expect(body.map((l) => uncaret(l.slice(4))).join(' ')).toBe(typed);
});

it('AC-1: measures the wrap in display columns, like the frame does', () => {
  // R5: a `String.length` wrap would emit rows of 54 code units = 108 columns
  // here, and the box would clip every one of them.
  const typed = '⚡'.repeat(100);
  const lines = rowsOf({ ...initialForm(opts), description: typed }, opts, {
    width: 58,
  });
  for (const line of lines) {
    // One assertion where it used to be two: `fitLine(line, 58)` carried no `…`
    // exactly when the row fitted, and the row fitting is what is asserted on
    // the line above (see the note at the head of this section).
    expect(displayWidth(line)).toBeLessThanOrEqual(58);
  }
  expect(
    bodyRows(lines)
      .map((l) => uncaret(l.slice(4)))
      .join(''),
  ).toBe(typed);
});

it('AC-1: a wrapped indented description keeps its indent inside the frame', () => {
  // A bakers.build description is Markdown (`bb_rich`), so an indented list item and a
  // deliberate double space are content, not spacing to be tidied away. Showing
  // the writer a de-indented, single-spaced version of what they typed is the
  // same defect AC-1 removes — only inside the wrap instead of at the frame.
  const typed =
    '  - a nested  bullet that is long enough to be wrapped by the popup and must keep its two-space indent';
  const lines = rowsOf({ ...initialForm(opts), description: typed }, opts, {
    width: 58,
  });
  for (const line of lines) {
    // One assertion where it used to be two: `fitLine(line, 58)` carried no `…`
    // exactly when the row fitted, and the row fitting is what is asserted on
    // the line above (see the note at the head of this section).
    expect(displayWidth(line)).toBeLessThanOrEqual(58);
  }
  const body = bodyRows(lines).map(uncaret);
  expect(body.length).toBeGreaterThan(1);
  for (const row of body) expect(row.startsWith('    ')).toBe(true);
  // The body indent (4) plus the writer's own indent (2) — NOT the body indent
  // alone, which is what a whitespace-collapsing wrap would leave.
  expect(body[0]?.startsWith('      - a')).toBe(true);
  expect(body[0]).not.toMatch(/^ {4}- /);
  expect(body[0]).toContain('nested  bullet');
  // Only the break points lost a space.
  expect(body.map((l) => l.slice(4)).join(' ')).toBe(typed);
});

it('AC-1: an explicit newline still starts a new body row', () => {
  const lines = rowsOf(
    { ...initialForm(opts), description: 'first\nsecond' },
    opts,
    { width: 58 },
  );
  expect(bodyRows(lines).map(uncaret)).toEqual(['    first', '    second']);
});

// ---- BB-257 AC-4 (D4) -----------------------------------------------------
//
// APPENDED ONLY. `(none available)` is the honest answer to "the query succeeded
// and the vocabulary is empty" — the test above pins that string and must stay
// green unmodified. What it must NOT be is the answer to "the query failed",
// which is what a 404 rendered as before (F2). The two cases are told apart by
// the `errors` bag riding along with the options it describes.

it('AC-4: a labels error replaces the empty note and names the reason', () => {
  const lines = rowsOf(
    initialForm({ ...opts, labels: [] }),
    { ...opts, labels: [], errors: { labels: 'boom' } },
    { width: 58 },
  ).join('\n');
  expect(lines).toContain('⚠ Labels could not be loaded: boom');
  // The whole point: an empty vocabulary is no longer claimed.
  expect(lines).not.toContain('(none available)');
});

it('AC-4: any OTHER bag`s failure becomes one form-level warning row', () => {
  const lines = rowsOf(
    initialForm(opts),
    { ...opts, errors: { users: 'HTTP 403', form: 'everything failed' } },
    { width: 58 },
  );
  // ONE note, not one per bag — it may wrap onto continuation rows, but only a
  // single row opens with the sigil.
  expect(lines.filter((l) => l.includes('⚠'))).toHaveLength(1);
  const note = lines.join('\n');
  expect(note).toContain('HTTP 403');
  expect(note).toContain('everything failed');
  // A form-level failure must not cost the writer the popup (D4's rejected
  // alternative): every field is still rendered — both action rows included
  // since BB-309 D3.
  expect(lines.join('\n')).toContain('[ Create with agent ]');
  expect(lines.join('\n')).toContain('[ Create directly ]');
});

it('AC-4: a long failure message wraps instead of being clipped by the frame', () => {
  // The same defect as F1, one row over: the box clips, so an unwrapped
  // 145-column server message would say `⚠ Labels could not be loaded: HTTP …`.
  const message = `HTTP 403 ${'x'.repeat(200)}`;
  const lines = rowsOf(
    initialForm({ ...opts, labels: [] }),
    { ...opts, labels: [], errors: { labels: message } },
    { width: 58 },
  );
  for (const line of lines) {
    // One assertion where it used to be two: `fitLine(line, 58)` carried no `…`
    // exactly when the row fitted, and the row fitting is what is asserted on
    // the line above (see the note at the head of this section).
    expect(displayWidth(line)).toBeLessThanOrEqual(58);
  }
  expect(lines.filter((l) => l.includes('⚠'))).toHaveLength(1);
});

it('AC-4: a form-level failure suppresses the empty note too', () => {
  // `(none available)` asserts a SUCCESSFUL empty read. When the whole load
  // failed (F2a) no read succeeded, so the Labels block must not make that claim
  // either — the form-level note is the only honest thing on screen.
  const lines = rowsOf(
    initialForm({ ...opts, labels: [] }),
    { ...opts, labels: [], errors: { form: 'connection refused' } },
    { width: 58 },
  ).join('\n');
  expect(lines).toContain('connection refused');
  expect(lines).not.toContain('(none available)');
});

it('AC-4: no `errors` key renders exactly what it rendered before', () => {
  // The regression guard for every existing caller: the key is optional and its
  // absence must change nothing at all.
  expect(rowsOf(initialForm(opts), opts)).toEqual(
    rowsOf(initialForm(opts), { ...opts, errors: {} }),
  );
  expect(rowsOf(initialForm(opts), opts).some((l) => l.includes('⚠'))).toBe(
    false,
  );
});

// ---- BB-257 AC-5 (D5–D8): the Parent block --------------------------------
//
// APPENDED ONLY. The renderer shows exactly the list the reducer clamps its
// cursor against and `pick` reads from — it filters through the kernel's own
// exported `filterOptions`, never a rule of its own (D7).

/** 60 candidates, so the page cap and the display window are both reachable. */
const manyParents = Array.from({ length: 60 }, (_, i) => ({
  id: `k${i}`,
  identifier: `BB-${100 + i}`,
  title: `candidate number ${i}`,
  label: `BB-${100 + i} · candidate number ${i}`,
}));

const someParents = manyParents.slice(0, 3);
const idx = (id: string): number => FIELDS.findIndex((f) => f.id === id);

/** The rows of the Parent block: its header up to the Assignee row. */
const parentRows = (lines: string[]): string[] => {
  const start = lines.findIndex((l) => l.includes('Parent:')) + 1;
  const end = lines.findIndex((l) => l.includes('Assignee:'));
  return lines.slice(start, end);
};

it('AC-5: the active Parent field carries its query as the insertion point', () => {
  // BB-326 (widget-fit F2) made the query row's `▌` a real TERMINAL cursor;
  // BB-340 Task 9 made the cursor a NODE. So the row's characters live on the
  // `FieldTextarea` the widget put in the tree, and the text surface must not
  // carry them a second time — painting them twice, once under a live cursor,
  // is the double paint the row surface needed and this one does not.
  const s = {
    ...initialForm({ ...opts, parents: someParents }),
    active: idx('parent'),
    parentQuery: 'BB-10',
  };
  const tree = createFormTree(
    FIELDS,
    s,
    { ...opts, parents: someParents },
    {
      width: 58,
    },
  );
  const input = nodeById(tree, 'field-parent-input');
  expect(input?.type).toBe(FieldTextarea);
  const props = input?.props as { value?: string; caretOffset?: number };
  expect(props.value).toBe('search: BB-10');
  expect(props.caretOffset).toBe('search: BB-10'.length);
  // The four columns the row used to spell as spaces, as the block's own Yoga
  // budget — this is what the caret's `column` used to say.
  expect(
    (
      nodeById(tree, 'field-parent-input-row')?.props as {
        paddingLeft?: number;
      }
    )?.paddingLeft,
  ).toBe(4);

  const lines = renderTree(tree);
  expect(lines).not.toContain('    search: BB-10');
  expect(lines.join('\n')).not.toContain('▌');
});

it('AC-5: the suggestions are the FILTERED list, marked with `›` at the cursor', () => {
  const withParents = { ...opts, parents: someParents };
  const s = {
    ...initialForm(withParents),
    active: idx('parent'),
    parentQuery: 'BB-10',
    cursor: 1,
  };
  const rows = parentRows(rowsOf(s, withParents, { width: 58 }));
  // `BB-10` matches BB-100, BB-101 and BB-102 — but not the rows the
  // bag would offer for an empty query, which is the point of filtering here.
  const suggestions = rows.filter((r) => r.includes('BB-10'));
  expect(suggestions.length).toBeGreaterThanOrEqual(3);
  expect(rows.some((r) => r.includes('›') && r.includes('BB-101'))).toBe(true);
  expect(rows.filter((r) => r.includes('›'))).toHaveLength(1);
});

it('AC-5: a query matching nothing offers no suggestion rows', () => {
  const withParents = { ...opts, parents: someParents };
  const s = {
    ...initialForm(withParents),
    active: idx('parent'),
    parentQuery: 'zzzz',
  };
  const rows = parentRows(rowsOf(s, withParents, { width: 58 }));
  expect(rows.some((r) => r.includes('BB-'))).toBe(false);
});

it('R3: at the page cap the list SAYS it is incomplete', () => {
  // Drupal's `OffsetPage::SIZE_MAX` caps a page at 50 rows (verified against the
  // control plane), and a popup cannot draw 50 anyway. Implying completeness is
  // the thing R3 forbids; the note is the mitigation.
  const withParents = { ...opts, parents: manyParents };
  const s = { ...initialForm(withParents), active: idx('parent') };
  const rows = parentRows(rowsOf(s, withParents, { width: 58 }));
  const note = rows.find((r) => r.includes('more — narrow the search'));
  expect(note).toBeDefined();
  expect(note).toMatch(/\+\d+ more — narrow the search/);
  // …and the drawn suggestions really are fewer than the matches.
  expect(rows.filter((r) => r.includes('BB-')).length).toBeLessThan(60);
});

it('R3: a list that fits carries no `+N more` note', () => {
  const withParents = { ...opts, parents: someParents };
  const s = { ...initialForm(withParents), active: idx('parent') };
  const rows = parentRows(rowsOf(s, withParents, { width: 58 }));
  expect(rows.some((r) => r.includes('more — narrow the search'))).toBe(false);
});

it('D8: an ABSENT candidate bag says there is no project context', () => {
  const s = { ...initialForm(opts), active: idx('parent') };
  const lines = rowsOf(s, opts, { width: 58 }).join('\n');
  expect(lines).toContain(
    '(no project context — open a project to pick a parent)',
  );
  // …and it offers nothing, rather than an empty search box. Named by the row's
  // own prefix since BB-326: the `▌` this used to look for is gone from every
  // query row, so asking for its absence would pass vacuously.
  expect(lines).not.toContain('search:');
});

it('D4: a failing candidate read names the reason, and is NOT the no-project note', () => {
  const failed: CreateFormOptions = {
    ...opts,
    parents: [],
    errors: { parents: 'HTTP 403' },
  };
  const s = { ...initialForm(failed), active: idx('parent') };
  const lines = rowsOf(s, failed, { width: 58 }).join('\n');
  expect(lines).toContain('⚠ Parent options could not be loaded: HTTP 403');
  expect(lines).not.toContain('(no project context');
});

it('AC-6: a picked parent is shown on the field row, active or not', () => {
  const withParents = { ...opts, parents: someParents };
  const base = { ...initialForm(withParents), parent: 'k2' };
  for (const active of [idx('parent'), idx('workflow')]) {
    const lines = rowsOf({ ...base, active }, withParents, {
      width: 58,
    });
    const header = lines.find((l) => l.includes('Parent:'));
    expect(header).toContain('BB-102 · candidate number 2');
  }
});

it('AC-5: nothing picked and inactive renders the same `—` the selects use', () => {
  const withParents = { ...opts, parents: someParents };
  const lines = rowsOf(
    { ...initialForm(withParents), active: idx('workflow') },
    withParents,
    { width: 58 },
  );
  expect(lines.find((l) => l.includes('Parent:'))).toMatch(/Parent:\s+—/);
});

it('AC-1/R5: every Parent row fits the frame in display columns', () => {
  // The same guard the description carries: the box clips, so a candidate
  // label longer than the popup must be cut HERE, where the cut is deliberate.
  const long = [
    {
      id: 'k9',
      identifier: 'BB-999',
      title: '⚡ '.repeat(60),
      label: `BB-999 · ${'⚡ '.repeat(60)}`,
    },
  ];
  const withParents = { ...opts, parents: long };
  const s = {
    ...initialForm(withParents),
    active: idx('parent'),
    parent: 'k9',
    parentQuery: 'x'.repeat(120),
  };
  for (const line of rowsOf(s, withParents, { width: 58 })) {
    // The FRAME had to cut nothing. A suggestion row may carry an ellipsis of
    // its own (a title does not fit a 58-column popup and a cursor list must
    // stay one-row-per-entry), but that cut is deliberate and made here, not
    // silently at the border.
    expect(displayWidth(line)).toBeLessThanOrEqual(58);
  }
});

it('AC-8 (D2): the active marker and label cursor follow FIELDS, not literals', () => {
  // The row indices were hardcoded `0…5` / `s.active === 3` (spec F5). Derived
  // from the declaration, they cannot misalign when a field is inserted.
  const idx = (id: string): number => FIELDS.findIndex((f) => f.id === id);
  for (const id of ['description', 'assignee', 'conductor', 'workflow']) {
    const lines = rowsOf({ ...initialForm(opts), active: idx(id) }, opts);
    const marked = lines.filter((l) => l.startsWith('▸ '));
    expect(marked).toHaveLength(1);
    const field = FIELDS[idx(id)];
    expect(marked[0]).toContain(field?.label ?? '');
  }
  // The multiselect cursor is drawn only while the Labels field is active.
  const onLabels = rowsOf(
    { ...initialForm(opts), active: idx('labels'), cursor: 1 },
    opts,
  );
  expect(onLabels.some((l) => l.includes('›') && l.includes('ui'))).toBe(true);
  const elsewhere = rowsOf(
    { ...initialForm(opts), active: idx('workflow'), cursor: 1 },
    opts,
  );
  expect(elsewhere.some((l) => l.includes('›'))).toBe(false);
});
// ---- BB-257 (re-entry) AC-17 ----------------------------------------------
//
// APPENDED ONLY. The review's second observation: with the loaded bag AT the
// server page cap and the local filter narrowing it below the render window,
// `+N more` goes to zero and the popup implies the list is complete — briefly
// while a re-query is pending, and for good whenever the re-query brings back
// another capped page. The cap is a property of the loaded bag, so the
// disclosure is drawn from the bag rather than from a pending-request flag.

/** Exactly one server page of candidates (`OffsetPage::SIZE_MAX`). */
const cappedParents = Array.from({ length: 50 }, (_, i) => ({
  id: `c${i}`,
  identifier: `BB-${100 + i}`,
  title: `candidate number ${i}`,
  label: `BB-${100 + i} · candidate number ${i}`,
}));

it('AC-17: a capped bag still says it may be incomplete once the filter narrows it', () => {
  const withParents = { ...opts, parents: cappedParents };
  const s = {
    ...initialForm(withParents),
    active: idx('parent'),
    parentQuery: 'BB-149',
  };
  const rows = parentRows(rowsOf(s, withParents, { width: 58 }));
  // One match, so the render window hides nothing and `+N more` cannot fire…
  expect(rows.filter((r) => /^ {3}[›\s]BB-/.test(r))).toHaveLength(1);
  expect(rows.some((r) => /\+\d+ more/.test(r))).toBe(false);
  // …and the incompleteness is still disclosed.
  expect(
    rows.some((r) => r.includes('more may exist — narrow the search')),
  ).toBe(true);
});

it('AC-17: a bag below the cap that is fully shown discloses nothing', () => {
  const withParents = { ...opts, parents: someParents };
  const s = { ...initialForm(withParents), active: idx('parent') };
  const rows = parentRows(rowsOf(s, withParents, { width: 58 }));
  expect(rows.some((r) => r.includes('narrow the search'))).toBe(false);
});

// ---- BB-340 Task 9 — the tree's own claims ---------------------------------

it('every node the popup emits carries ONE physical row', () => {
  // What the screen's `flatMap((line) => line.split('\n'))` used to guarantee.
  // A `TextRenderable` declared `height: 1` does not grow for an embedded
  // newline — it clips — so the invariant has to hold at the source now.
  const lines = rowsOf(
    initialForm({ ...opts, labels: [] }),
    { ...opts, labels: [], errors: { form: 'a\nb', labels: 'c\nd' } },
    { width: 58, message: 'refused\nby the server' },
  );
  for (const line of lines) expect(line.includes('\n')).toBe(false);
});

it('D4: every id in the popup`s tree is declared exactly once', () => {
  // `mountTree`/`patchTree` THROW on a repeated id, so a duplicate is a popup
  // that cannot be drawn at all. Asserted over the widest tree it has: a
  // form-level note, a refusal message and every field, with the autocomplete
  // active so its query block and suggestions are in the tree too.
  const withParents = { ...opts, parents: someParents };
  const tree = createFormTree(
    FIELDS,
    { ...initialForm(withParents), active: idx('parent') },
    { ...withParents, errors: { users: 'HTTP 403' } },
    { width: 58, message: 'refused' },
  );
  const seen = new Set<string>();
  const walk = (node: {
    props?: { id?: string };
    children?: unknown[];
  }): void => {
    const id = node.props?.id;
    if (id !== undefined) {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    for (const child of (node.children ?? []).flat(
      Number.POSITIVE_INFINITY,
    ) as (typeof node)[]) {
      if (child && typeof child === 'object') walk(child);
    }
  };
  walk(tree as never);
  expect(seen.size).toBeGreaterThan(20);
});
