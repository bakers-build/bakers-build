import { expect, it } from 'vitest';
import { editFormTree } from '../../../../../src/Entity/ticket/Component/edit-form/index.js';
import {
  CANCEL_TICKET_ACTION_ID,
  EDIT_FIELDS,
  EDIT_FIELDS_TERMINAL,
  type EditFormOptions,
  type EditFormState,
} from '../../../../../src/Entity/ticket/Form/edit.js';
import { displayWidth } from '../../../../../src/lib/width.js';
import { renderDeclaredFieldsTree } from '../../../../../src/Widget/index.js';
import { renderTree } from '../../../../render-tree.js';

// BB-340 Task 9 — the SAME claims, one layer down.
//
// The popup hands over a renderable tree, so what used to be an array of
// composed rows is the text its nodes carry, read back in tree order by
// `renderTree`. Every assertion below is the one that was here before; only the
// surface it reads changed. That is deliberate: a conversion that had to drop an
// assertion would be a conversion that changed the popup.

const USER = 'aaaaaaaa-0000-0000-0000-000000000001';
const COND = 'bbbbbbbb-0000-0000-0000-000000000001';
const LABEL = 'eeeeeeee-0000-0000-0000-000000000001';

const opts: EditFormOptions = {
  users: [
    { id: USER, label: 'cw' },
    { id: 'u2', label: 'tm' },
  ],
  reviewers: [
    { id: USER, label: 'cw' },
    { id: 'u2', label: 'tm' },
  ],
  conductors: [
    { id: COND, label: 'cw-framework (online)' },
    { id: 'c2', label: 'tom (offline)' },
  ],
  labels: [{ id: LABEL, label: 'work:code' }],
  // Present (even empty) so the Parent field does not emit its long absentNote
  // on every frame — width assertions measure real field chrome, not that note.
  parents: [],
};

const state = (over: Partial<EditFormState> = {}): EditFormState => ({
  ticketId: 't1',
  reviewersLoaded: true,
  assignee: USER,
  reviewers: new Set(),
  conductor: COND,
  estimate: '',
  spent: '',
  parent: null,
  parentQuery: '',
  labels: new Set(),
  active: 0,
  ...over,
});

/**
 * The popup's rows: the text its tree carries, in the order it is drawn.
 *
 * The field list is the LAST parameter and defaults to `EDIT_FIELDS` (BB-313
 * D4 hands it in), so every assertion written before that change reads
 * unchanged and only the tests that care about the terminal list name one.
 */
const rowsOf = (
  s: EditFormState,
  o: EditFormOptions,
  chrome: Parameters<typeof editFormTree>[3] = {},
  fields: Parameters<typeof editFormTree>[0] = EDIT_FIELDS,
): string[] => renderTree(editFormTree(fields, s, o, chrome));

it('AC-1: renders the four rows with their prefilled labels', () => {
  const lines = rowsOf(state({ estimate: '4h', spent: '11h' }), opts);
  expect(lines.some((l) => /Assignee:\s+< cw >/.test(l))).toBe(true);
  expect(lines.some((l) => l.includes('Reviewers:'))).toBe(true);
  expect(
    lines.some((l) => /Conductor:\s+< cw-framework \(online\) >/.test(l)),
  ).toBe(true);
  // BB-308: the two durations render as TYPED — seconds only exist in the
  // payload, never on the screen. A text field renders as a label row followed
  // by its value row (the kernel's `text` kind), so both are asserted in order
  // rather than on one line.
  const text = lines.join('\n');
  expect(text).toMatch(/Estimate:\n\s+4h/);
  expect(text).toMatch(/Spent:\n\s+11h/);
  expect(lines.some((l) => l.includes('[ Save ]'))).toBe(true);
});

it('AC-1: the active row carries the cursor marker, and only it', () => {
  const onConductor = rowsOf(state({ active: 2 }), opts);
  const marked = onConductor.filter((l) => l.startsWith('▸'));
  expect(marked).toHaveLength(1);
  expect(marked[0]).toContain('Conductor:');
});

it('AC-4: a cleared field renders "— none —", not a bare dash', () => {
  const lines = rowsOf(state({ assignee: null, conductor: null }), opts).join(
    '\n',
  );
  expect(lines).toMatch(/Assignee:\s+< — none — >/);
  expect(lines).toMatch(/Conductor:\s+< — none — >/);
});

it('an id with no matching option still renders something legible', () => {
  const lines = rowsOf(state({ conductor: 'gone' }), opts).join('\n');
  expect(lines).toMatch(/Conductor:\s+< — >/);
});

// BB-391 (AC2) — the INVERSE of what this used to assert. The footer used to
// name the auth profile the write would really use, because there were two and
// the popup could be on the wrong one. There is one identity now, so the row said
// nothing an operator could act on; the server's own message is the only thing
// left worth the line, and it gets it unconditionally.
it('AC-5: the footer names NO write profile — there is only one identity', () => {
  const lines = rowsOf(state(), opts).join('\n');
  expect(lines).not.toContain('writes as:');
  expect(lines).not.toContain('the read client');
});

it('AC-5: a server message is shown in full', () => {
  const message =
    'The current user is not allowed to PATCH the selected field (conductor_id). Assigning a conductor requires the "assign bakers conductor" permission.';
  const lines = rowsOf(state(), opts, { message });
  // Wrapped across rows (the box is narrower than the sentence) but complete.
  expect(lines.join(' ').replace(/\s+/g, ' ')).toContain(message);
});

it('AC-8: the warning names the live conductor and BOTH consequences', () => {
  const lines = rowsOf(state(), opts, {
    activeRun: {
      identifier: 'BB-233',
      machine: 'cw-framework',
      runState: 'running',
    },
  }).join('\n');
  expect(lines).toContain('BB-233');
  expect(lines).toContain('cw-framework');
  expect(lines).toMatch(/running/);
  // Consequence 1: the live run keeps going.
  expect(lines).toMatch(/does not stop that run/i);
  // Consequence 2: clearing only affects the NEXT dispatch.
  expect(lines).toMatch(/next dispatch/i);
});

it('AC-8: no warning when nothing is running', () => {
  const lines = rowsOf(state(), opts, { activeRun: null }).join('\n');
  expect(lines).not.toMatch(/does not stop that run/i);
  expect(lines).not.toContain('⚠');
});

it('every emitted entry is a single physical line (the draw-loop invariant)', () => {
  const lines = rowsOf(state(), opts, {
    activeRun: {
      identifier: 'BB-233',
      machine: 'cw-framework',
      runState: 'running',
    },
    message: 'something\nwith a newline',
  });
  for (const line of lines) expect(line.includes('\n')).toBe(false);
});

it('AC-5: a message longer than the box is WRAPPED, never truncated', () => {
  // The measured 403 detail is ~145 chars and the popup is 60 wide. Clipping it
  // would end the sentence at "the selected field" and drop the half that says
  // which permission is missing — so every character must survive.
  const message =
    'The current user is not allowed to PATCH the selected field (conductor_id). Assigning a conductor requires the "assign bakers conductor" permission.';
  const lines = rowsOf(state(), opts, { message, width: 60 });
  for (const line of lines) expect(line.length).toBeLessThanOrEqual(60);
  // Re-joining the wrapped rows reproduces the message word for word.
  expect(lines.join(' ').replace(/\s+/g, ' ')).toContain(message);
});

it('AC-8: a long warning line is wrapped to the same width', () => {
  const lines = rowsOf(state(), opts, {
    width: 40,
    activeRun: {
      identifier: 'BB-233',
      machine: 'a-very-long-conductor-machine-name-here',
      runState: 'running',
    },
  });
  for (const line of lines) expect(line.length).toBeLessThanOrEqual(60);
  expect(lines.join(' ')).toContain('a-very-long-conductor-machine-name-here');
});

it('AC-8: with an empty claim_machine the warning names the ASSIGNED conductor', () => {
  // `claim_machine` is only populated while a machine actually holds the claim.
  // Measured live on BB-233 mid-run: `derived_status: running` but
  // `claim_machine: ''` — so the warning said "a conductor". The conductor's
  // own label is right there in the options list; use it.
  const lines = rowsOf(state(), opts, {
    activeRun: { identifier: 'BB-233', machine: '', runState: 'running' },
  }).join('\n');
  expect(lines).toContain('cw-framework (online)');
  expect(lines).not.toContain('by a conductor');
});

it('AC-8: with neither a machine nor a conductor it stays honest', () => {
  const lines = rowsOf(state({ conductor: null }), opts, {
    activeRun: { identifier: 'BB-233', machine: '', runState: 'claimed' },
  }).join('\n');
  expect(lines).toContain('a conductor');
  expect(lines).not.toContain('— none —)');
});
// ---- BB-257 (re-entry) AC-13 / AC-14 --------------------------------------
//
// APPENDED ONLY. The review overturned the earlier run's "deliberately not
// converted": this popup carried its own `wrap()` measuring in UTF-16 code
// units while every other measurement in the package is in DISPLAY COLUMNS. For
// ASCII the two agree exactly, which is why it went unnoticed — and why the
// cases below are stated with wide characters, the only input that tells them
// apart.

it('AC-14: a message with WIDE characters wraps in display columns, not code units', () => {
  // A Japanese 403 detail. Measured in code units a 60-unit row is 120 columns
  // wide, so the frame — which truncates in columns — would clip half of every
  // row it drew. The row count is not the point; the column count is.
  const message = `権限がありません。${'指定'.repeat(60)}`;
  const lines = rowsOf(state(), opts, { message, width: 60 });
  for (const line of lines) {
    expect(displayWidth(line)).toBeLessThanOrEqual(60);
  }
  // …and no character is lost on the way.
  expect(lines.join('').replace(/\s+/g, '')).toContain(
    message.replace(/\s+/g, ''),
  );
});

it('AC-14: the live-run warning is measured in display columns too', () => {
  const lines = rowsOf(state(), opts, {
    width: 40,
    activeRun: {
      identifier: 'BB-233',
      machine: '担当機械'.repeat(8),
      runState: 'running',
    },
  });
  for (const line of lines) {
    expect(displayWidth(line)).toBeLessThanOrEqual(40);
  }
});

it('AC-13: the field rows come from the SHARED per-kind renderer', () => {
  // Not "they happen to look alike": the rows this popup draws for its declared
  // fields are byte-identical to what the widget layer renders for the same
  // declaration, so a change to how a `select` looks reaches both popups.
  const s = state();
  const shared = renderTree(
    renderDeclaredFieldsTree(EDIT_FIELDS, s, opts, { width: 58 }),
  );
  const drawn = rowsOf(s, opts);
  for (const row of shared) expect(drawn).toContain(row);
});

it('AC-13: a kind this popup does not declare is still renderable by it', () => {
  // The structural half of AC-13: the edit popup could render neither a
  // multiselect nor an autocomplete, because it had no per-kind renderer at all.
  // Through the shared registry every kind is available to it — what it draws is
  // now purely a question of what it DECLARES.
  const rows = renderTree(
    renderDeclaredFieldsTree(
      [
        {
          id: 'tags',
          label: 'Tags',
          kind: 'multiselect',
          from: 'users',
        },
      ],
      { ...state(), tags: new Set([USER]) },
      opts,
      { width: 58 },
    ),
  );
  expect(rows).toEqual(['▸ Tags:', '    [x] cw', '    [ ] tm']);
});

// ---- BB-340 Task 9 — the tree's own claims ---------------------------------

it('D4: every id in the popup`s tree is declared exactly once', () => {
  // `mountTree`/`patchTree` THROW on a repeated id, so a duplicate is a popup
  // that cannot be drawn at all. Asserted over the widest tree the popup has:
  // the run warning, a wrapped server message and every field.
  const tree = editFormTree(EDIT_FIELDS, state(), opts, {
    width: 58,
    message:
      'The current user is not allowed to PATCH the selected field (conductor_id).',
    activeRun: {
      identifier: 'BB-233',
      machine: 'cw-framework',
      runState: 'running',
    },
  });
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
  expect(seen.size).toBeGreaterThan(10);
});

// ---- BB-360: Parent, Labels, Cancel ticket (no State select) --------------

it('BB-360: non-terminal field list draws Parent, Labels, Save and Cancel ticket', () => {
  const lines = rowsOf(state(), opts).join('\n');
  expect(lines).toMatch(/Parent:/);
  expect(lines).toMatch(/Labels:/);
  expect(lines).toContain('[ Save ]');
  expect(lines).toContain('[ Cancel ticket ]');
  expect(lines).not.toMatch(/State:/);
  expect(EDIT_FIELDS.map((f) => f.id)).toContain(CANCEL_TICKET_ACTION_ID);
});

it('BB-360: the terminal field list draws no Cancel ticket row', () => {
  const lines = rowsOf(state(), opts, {}, EDIT_FIELDS_TERMINAL).join('\n');
  expect(lines).toContain('[ Save ]');
  expect(lines).not.toContain('[ Cancel ticket ]');
  expect(lines).not.toMatch(/State:/);
  expect(lines).toMatch(/Parent:/);
  expect(lines).toMatch(/Labels:/);
});

it('BB-360: the legend names Parent and Labels structure fields', () => {
  const withRow = rowsOf(state(), opts).join(' ');
  expect(withRow).toMatch(/Parent/i);
  expect(withRow).toMatch(/Labels/i);
  expect(withRow).not.toMatch(/only lifecycle move/i);
  // Terminal still has the same structure legend (no State-only copy).
  const without = rowsOf(state(), opts, {}, EDIT_FIELDS_TERMINAL).join(' ');
  expect(without).toMatch(/Parent/i);
});

it('BB-360: the legend line is wrapped like every other row', () => {
  const lines = rowsOf(state(), opts, { width: 40 });
  for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(40);
});

it('a failed reviewer roster still shows the prefilled reviewers it would save', () => {
  const lines = rowsOf(state({ reviewers: new Set([USER]) }), {
    ...opts,
    reviewers: [{ id: USER, label: USER }],
    errors: { reviewers: 'roster down' },
  });
  const text = lines.join('\n');
  expect(text).toContain('Reviewers could not be loaded: roster down');
  expect(text).toContain(`[x] ${USER}`);
});
