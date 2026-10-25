import { beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_ACTION_ID,
  backspace,
  CREATE_FORM,
  type CreateFormOptions,
  type CreateFormState,
  cycle,
  cycleValue,
  DIRECT_ACTION_ID,
  FIELDS,
  type FieldDef,
  fieldAt,
  initialForm,
  moveField,
  moveLabelCursor,
  newline,
  nextActive,
  rememberedValues,
  serialize,
  toggleLabel,
  typeChar,
} from '../../../../src/Entity/ticket/Form/create.js';

const opts: CreateFormOptions = {
  users: [
    { id: 'u1', label: 'cw' },
    { id: 'u2', label: 'agent' },
  ],
  reviewers: [
    { id: 'u1', label: 'cw' },
    { id: 'u2', label: 'agent' },
  ],
  conductors: [{ id: 'c1', label: 'cw-framework' }],
  ticketTypes: [
    { id: 't1', label: 'feature' },
    { id: 't2', label: 'bug' },
  ],
  recipes: [{ id: 'r1', label: 'drupal-feature' }],
  labels: [
    { id: 'l1', label: 'bug' },
    { id: 'l2', label: 'ui' },
  ],
  workflows: [
    { id: 'bb_work', label: 'work' },
    { id: 'bb_deployment', label: 'deployment' },
  ],
};

let s: CreateFormState;
beforeEach(() => {
  s = initialForm(opts);
});

/**
 * The declared index of a field.
 *
 * BB-257 inserted `parent` between `description` and `assignee`, which shifts
 * every literal index below it — the same hand-count hazard spec F5/D2 removed
 * from the renderer, sitting here in the tests. The cases below therefore NAME
 * the field they mean instead of counting to it. Every assertion they make is
 * unchanged; only the way they reach the field is.
 */
const idx = (id: string): number => FIELDS.findIndex((f) => f.id === id);

it('initial defaults to first option per select, empty description/labels/reviewers', () => {
  expect(s.description).toBe('');
  expect(s.assignee).toBe('u1');
  expect(s.conductor).toBe('c1');
  expect(s.workflow).toBe('bb_work');
  expect(s.labels.size).toBe(0);
  expect(s.reviewers.size).toBe(0);
  expect(s.active).toBe(0);
});

it('moveField clamps to the field range', () => {
  expect(moveField(s, -1).active).toBe(0);
  expect(moveField(s, 99).active).toBe(FIELDS.length - 1);
});

it('text editing appends / backspaces / newlines the description', () => {
  // BB-309 D1 put Title first, so the popup no longer OPENS on the
  // description. Reaching it by name rather than by index is the same
  // hand-count hazard `idx` exists for; every assertion below is unchanged.
  s = moveField(s, idx('description'));
  s = typeChar(s, 'Hi');
  s = typeChar(s, '!');
  expect(s.description).toBe('Hi!');
  s = backspace(s);
  expect(s.description).toBe('Hi');
  s = newline(s);
  expect(s.description).toBe('Hi\n');
});

it('cycle rotates the active select value (wraps)', () => {
  s = { ...s, active: idx('assignee') };
  s = cycle(s, opts, 1);
  expect(s.assignee).toBe('u2');
  s = cycle(s, opts, 1);
  expect(s.assignee).toBe('u1'); // wrapped
  s = cycle(s, opts, -1);
  expect(s.assignee).toBe('u2');
});

it('cycle only touches the active field', () => {
  s = { ...s, active: idx('workflow') };
  s = cycle(s, opts, 1);
  expect(s.workflow).toBe('bb_deployment');
  expect(s.assignee).toBe('u1'); // untouched
});

it('labels: move cursor + toggle multi-select', () => {
  s = { ...s, active: idx('labels') };
  s = toggleLabel(s, opts); // toggles l1
  expect([...s.labels]).toEqual(['l1']);
  s = moveLabelCursor(s, opts, 1);
  s = toggleLabel(s, opts); // toggles l2
  expect([...s.labels].sort()).toEqual(['l1', 'l2']);
  s = toggleLabel(s, opts); // untoggle l2
  expect([...s.labels]).toEqual(['l1']);
  expect(moveLabelCursor(s, opts, 99).cursor).toBe(1); // clamped
});

it('serialize resolves ids to options', () => {
  s = moveField(s, idx('description')); // BB-309 D1: Title opens the popup
  s = typeChar(s, 'A bug');
  // BB-283: typing moved the TEXT cursor to the end of the description, so
  // teleporting to the labels must say where the row cursor starts — the dead
  // `labelCursor` key this line used to set never reached the kernel at all.
  s = { ...s, active: idx('labels'), cursor: 0 };
  s = toggleLabel(s, opts);
  const payload = serialize(s, opts);
  expect(payload.description).toBe('A bug');
  expect(payload.assignee).toEqual({ id: 'u1', label: 'cw' });
  expect(payload.conductor).toEqual({ id: 'c1', label: 'cw-framework' });
  expect(payload.workflow).toEqual({ id: 'bb_work', label: 'work' });
  expect(payload.labels).toEqual([{ id: 'l1', label: 'bug' }]);
  expect(payload.reviewers).toEqual([]);
  // BAKERS-17: the kernel preselects a select's first option; the SCREEN opens
  // type and recipe empty (asserted in `tests/Screen/form-screens.test.ts`).
  expect(payload.ticketType).toEqual({ id: 't1', label: 'feature' });
  expect(payload.recipe).toEqual({ id: 'r1', label: 'drupal-feature' });
});

it('BAKERS-17: type and recipe are clearable single selects over their own bags', () => {
  for (const [id, label, from] of [
    ['ticketType', 'Type', 'ticketTypes'],
    ['recipe', 'Recipe', 'recipes'],
  ]) {
    expect(FIELDS.find((f) => f.id === id)).toMatchObject({
      kind: 'select',
      label,
      from,
      clearable: true,
    });
  }
  s = { ...s, active: idx('ticketType') };
  s = cycle(s, opts, 1);
  expect(serialize(s, opts).ticketType).toEqual({ id: 't2', label: 'bug' });
  s = cycle(s, opts, 1);
  expect(serialize(s, opts).ticketType).toBeNull(); // the clearable null
});

// `shortName`'s two assertions moved with the function itself to
// `tests/Service/agent.test.ts` (BB-236 AC-8 / spec Decision 8).

it('empty option lists leave selects null and cycle is a no-op', () => {
  const empty = initialForm({
    users: [],
    reviewers: [],
    conductors: [],
    labels: [],
    workflows: [],
  });
  expect(empty.assignee).toBeNull();
  const cycled = cycle(
    { ...empty, active: idx('assignee') },
    { users: [], reviewers: [], conductors: [], labels: [], workflows: [] },
    1,
  );
  expect(cycled.assignee).toBeNull();
});

// ---- BB-233 AC-9: the extraction must leave the CREATE form untouched -----
//
// Phase 3 parameterises the field-navigation helpers by an explicit field list
// and teaches `cycleValue` a `null` position, so the edit form can reuse the
// state machine (spec Decision 3). Both changes are gated: the create form
// passes its own FIELDS and declares no `clearable` field. These cases pin that
// — a regression here means the New-ticket popup changed behaviour, which this
// ticket has no acceptance criterion for and no mandate to do.

it('AC-9: a non-clearable select never cycles to null, from either end', () => {
  const users = [
    { id: 'u1', label: 'cw' },
    { id: 'u2', label: 'agent' },
  ];
  // Forward off the last option, and backward off the first: both wrap to a
  // real option. Before Phase 3 there was no path to null at all; after it,
  // there still must not be one without `clearable`.
  expect(cycleValue(users, 'u2', 1)).toBe('u1');
  expect(cycleValue(users, 'u1', -1)).toBe('u2');
  // A whole lap in each direction never yields null.
  let v: string | null = 'u1';
  for (let i = 0; i < 6; i++) {
    v = cycleValue(users, v, 1);
    expect(v).not.toBeNull();
  }
  for (let i = 0; i < 6; i++) {
    v = cycleValue(users, v, -1);
    expect(v).not.toBeNull();
  }
  // And an id that is not in the list still lands on a real option.
  expect(cycleValue(users, 'gone', 1)).toBe('u1');
  // An empty list keeps the current value (the pre-Phase-3 contract).
  expect(cycleValue([], 'u1', 1)).toBe('u1');
});

it('AC-9: fieldAt/nextActive clamp against the PASSED field list', () => {
  const three: FieldDef[] = [
    { id: 'a', label: 'A', kind: 'select' },
    { id: 'b', label: 'B', kind: 'select' },
    { id: 'c', label: 'C', kind: 'action' },
  ];
  expect(nextActive(three, 0, -1)).toBe(0);
  expect(nextActive(three, 0, 99)).toBe(2);
  expect(fieldAt(three, 1).id).toBe('b');
  // Out of range falls back to the first entry, never undefined.
  expect(fieldAt(three, 99).id).toBe('a');
  // The create form's own helpers keep clamping against FIELDS, unchanged.
  expect(moveField(s, 99).active).toBe(FIELDS.length - 1);
  // Eleven fields plus two action rows (BB-309 Title + direct action, then
  // Reviewers after Assignee, Template, BAKERS-17 Type and Recipe).
  expect(FIELDS).toHaveLength(13);
  // The guard this line has always been — "no select became clearable by
  // accident" — with the ONE deliberate exception named. BB-309 D2 makes the
  // conductor clearable on purpose: a set conductor starts a run at the next
  // poll, so leaving it unset has to be expressible. Every other select still
  // cycles over real options only, which is what BB-233 AC-9 pinned.
  // The template is another one — "no template" is the default — and so are
  // BAKERS-17's type and recipe, which are chosen, never preselected.
  expect(FIELDS.filter((f) => f.clearable === true).map((f) => f.id)).toEqual([
    'conductor',
    'ticketType',
    'recipe',
    'template',
  ]);
});

// ---- BB-257 AC-2 ----------------------------------------------------------
//
// APPENDED ONLY: this file is one of the three AC-8 contract files (spec D11), so
// nothing above may change its outcome.
//
// D1 puts the soft wrap in the RENDERER. This case is the boundary that makes
// that a design rather than a hope: however many rows the popup draws, the state
// holds one logical line per Enter, and `serialize` hands the create agent
// exactly the characters that were typed. It is a guard, not a bug reproduction —
// it is green today and must stay green once `createFormLines` wraps, because a
// wrap that reached the state (inserting a break the writer never pressed) is
// precisely the AC-2 regression it exists to catch.

// ---- BB-257 AC-5 / AC-6 / AC-7: the parent field --------------------------
//
// APPENDED ONLY, like the AC-2 case above. The mechanics (filter, cursor, pick)
// belong to the kernel and are asserted in `tests/Form/form.test.ts`; what is
// this module's own are the DECLARATION (which field, where) and the PAYLOAD.

/** Two candidates, labelled the way the adapter composes them (D5). */
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

const withParents: CreateFormOptions = { ...opts, parents: PARENTS };

it('AC-5: `parent` is declared between the description and the assignee', () => {
  // A parent is chosen WITH the description, before assignment — and the
  // position is pinned because every row index the renderer draws is derived
  // from this list (D2), so moving it silently moves the popup.
  expect(FIELDS.map((f) => f.id)).toEqual([
    // BB-309 D1/D3: Title opens the popup and a second action row closes it.
    // The claim this case makes — `parent` sits between the description and the
    // assignee — is unchanged.
    'title',
    'description',
    'parent',
    'assignee',
    'reviewers',
    'conductor',
    'ticketType',
    'recipe',
    'labels',
    'workflow',
    'template',
    'submit',
    'direct',
  ]);
  const reviewers = FIELDS.find((f) => f.id === 'reviewers');
  expect(reviewers?.kind).toBe('multiselect');
  expect(reviewers?.label).toBe('Reviewers');
  expect(reviewers?.from).toBe('reviewers');
  const parent = FIELDS.find((f) => f.id === 'parent');
  expect(parent?.kind).toBe('autocomplete');
  expect(parent?.label).toBe('Parent');
  expect(parent?.from).toBe('parents');
  expect(parent?.query).toBe('parentQuery');
});

it('AC-7: nothing picked yields `parent: null`, and nothing else moves', () => {
  const payload = serialize(initialForm(withParents), withParents);
  expect(payload.parent).toBeNull();
  // Byte for byte the pre-BB-257 payload apart from the new key: the field is
  // optional, so an untouched Parent changes nothing about the submission.
  expect(payload).toEqual({
    title: '',
    description: '',
    workflow: { id: 'bb_work', label: 'work' },
    assignee: { id: 'u1', label: 'cw' },
    conductor: { id: 'c1', label: 'cw-framework' },
    ticketType: { id: 't1', label: 'feature' },
    recipe: { id: 'r1', label: 'drupal-feature' },
    labels: [],
    reviewers: [],
    parent: null,
  });
});

it('AC-6: a pick yields the parent`s id, identifier and title', () => {
  let picked = initialForm(withParents);
  // Named, not counted: BB-309 D1 inserted Title above it (spec F5/D2).
  picked = { ...picked, active: idx('parent'), cursor: 1 };
  picked = CREATE_FORM.apply(picked, withParents, { kind: 'pick' });
  expect(picked.parent).toBe('k2');
  expect(serialize(picked, withParents).parent).toEqual({
    id: 'k2',
    identifier: 'BB-257',
    title: 'the New-ticket popup',
  });
});

it('AC-7: an absent candidate bag is a legal state — `parent: null`', () => {
  // D8: opened from the dashboard there is no project scope, so no bag at all.
  const payload = serialize(initialForm(opts), opts);
  expect(payload.parent).toBeNull();
});

it('a picked id no longer in the bag serializes as null, not as a phantom', () => {
  // The bag is swapped on every debounced re-query (D7), so a pick can outlive
  // the row it came from. `parent_id` must then be omitted rather than sent as
  // an id the payload cannot describe.
  const stale = { ...initialForm(withParents), parent: 'gone' };
  expect(serialize(stale, withParents).parent).toBeNull();
});

it('AC-2: wrapping is presentation only — serialize keeps the typed characters', () => {
  const long = 'lorem ipsum dolor sit amet '.repeat(8).slice(0, 200);
  expect(long).toHaveLength(200); // far past the popup's ~54-column body budget
  const second = 'and a second line the writer really did break';

  s = moveField(s, idx('description')); // BB-309 D1: Title opens the popup
  s = typeChar(s, long);
  s = newline(s);
  s = typeChar(s, second);

  const description = serialize(s, opts).description;
  expect(description).toBe(`${long}\n${second}`);
  // A line break ONLY where `newline` was applied.
  expect([...description].filter((c) => c === '\n')).toHaveLength(1);
  expect(description.split('\n')).toEqual([long, second]);
  // Character-identical: no soft break, no collapsed run, no lost tail.
  expect(description).toHaveLength(long.length + 1 + second.length);
});

// ---- BB-309 D1 / D2 / D3 / D7 ---------------------------------------------
//
// APPENDED ONLY, like every block above it. The popup gains a Title, a clearable
// Conductor and a SECOND action row; what this module owns of that is the
// DECLARATION (which field, where, with what flag) and the PAYLOAD.

it('D1: Title is the first field and carries into the payload', () => {
  expect(FIELDS[0]?.id).toBe('title');
  expect(FIELDS[0]?.kind).toBe('text');
  let state = initialForm(opts);
  state = typeChar(state, 'Hi');
  expect(serialize(state, opts).title).toBe('Hi');
});

it('D2: the Conductor select is clearable and still preselects index 0', () => {
  const conductor = FIELDS.find((f) => f.id === 'conductor');
  expect(conductor?.clearable).toBe(true);
  // `initial()` fills a select from listOf(options)[0] regardless of
  // `clearable`, so the machine's own conductor stays preselected.
  expect(initialForm(opts).conductor).toBe(opts.conductors[0]?.id ?? null);
});

it('D3/D7: two action rows, agent first, with distinct ids', () => {
  const actions = FIELDS.filter((f) => f.kind === 'action');
  expect(actions.map((f) => f.id)).toEqual([AGENT_ACTION_ID, DIRECT_ACTION_ID]);
  expect(actions.map((f) => f.label)).toEqual([
    'Create with agent',
    'Create directly',
  ]);
});

it('an action id never collides with a state key', () => {
  const state = initialForm(opts) as unknown as Record<string, unknown>;
  expect(state).not.toHaveProperty(AGENT_ACTION_ID);
  expect(state).not.toHaveProperty(DIRECT_ACTION_ID);
});

// ---- BB-314: what survives an open, and what does not ---------------------
//
// The popup is one screen instance that is entered again and again (spec F1/F2),
// so "a fresh form" is not what `initialForm` gives by default — it is what
// `initialForm(options, rememberedValues(previous))` gives. These cases pin the
// split itself: the five routing keys ride along, the two content keys do not,
// and the workflow is re-derived rather than carried (D5).

const filled = (): CreateFormState => ({
  ...initialForm(opts),
  title: 'Fix it',
  description: 'and quickly',
  parent: 't1',
  parentQuery: 'BB-2',
  assignee: 'u2',
  conductor: null,
  labels: new Set(['l2']),
  workflow: 'bb_deployment',
});

it('BB-314 D2: rememberedValues carries the routing keys and no content key', () => {
  expect(rememberedValues(filled())).toEqual({
    parent: 't1',
    parentQuery: 'BB-2',
    assignee: 'u2',
    conductor: null,
    labels: new Set(['l2']),
  });
  expect(rememberedValues(filled())).not.toHaveProperty('reviewers');
});

it('BB-314 D1/D5: a prefilled form empties the content and re-defaults the workflow', () => {
  const next = initialForm(opts, rememberedValues(filled()));

  expect(next.title).toBe('');
  expect(next.description).toBe('');
  // NOT `bb_deployment`: a workflow is a per-ticket decision, so the field falls
  // back through the kernel's own select rule to the first option (D5).
  expect(next.workflow).toBe('bb_work');

  expect(next.assignee).toBe('u2');
  // An explicit `null` sticks (`Object.hasOwn`, F6): a conductor the operator
  // CLEARED must not be re-preselected by `ownFirst` on the next open.
  expect(next.conductor).toBeNull();
  expect(next.labels).toEqual(new Set(['l2']));
  expect(next.parent).toBe('t1');
  // Both of the autocomplete's keys ride together (D4): a pick without the
  // query that produced it is a state the reducer never builds.
  expect(next.parentQuery).toBe('BB-2');

  // The form opens where a fresh one opens: the first field, caret at 0.
  expect(next.active).toBe(0);
  expect(next.cursor).toBe(0);
});

it('BB-314 D6: the captured labels are a copy, not the state Set', () => {
  const labels = new Set(['l1']);
  const remembered = rememberedValues({ ...initialForm(opts), labels });
  labels.add('l2');
  expect(remembered.labels).toEqual(new Set(['l1']));
});

it('reviewers: empty, two and removal serialize independently of assignee', () => {
  let state = initialForm(opts);
  expect(serialize(state, opts).reviewers).toEqual([]);
  expect(serialize(state, opts).assignee).toEqual({ id: 'u1', label: 'cw' });

  state = { ...state, active: idx('reviewers'), cursor: 0 };
  state = toggleLabel(state, opts);
  state = moveLabelCursor(state, opts, 1);
  state = toggleLabel(state, opts);
  expect([...state.reviewers].sort()).toEqual(['u1', 'u2']);
  expect(serialize(state, opts).reviewers).toEqual([
    { id: 'u1', label: 'cw' },
    { id: 'u2', label: 'agent' },
  ]);
  expect(serialize(state, opts).assignee).toEqual({ id: 'u1', label: 'cw' });

  state = toggleLabel(state, opts);
  expect([...state.reviewers]).toEqual(['u1']);
  expect(serialize(state, opts).reviewers).toEqual([{ id: 'u1', label: 'cw' }]);
});

it('a remembered create starts reviewers empty even when the last ticket had some', () => {
  const previous = {
    ...filled(),
    reviewers: new Set(['u1', 'u2']),
  };
  const next = initialForm(opts, rememberedValues(previous));
  expect(next.reviewers.size).toBe(0);
  expect(serialize(next, opts).reviewers).toEqual([]);
});

it('agent-create launch input JSON carries the selected reviewers', () => {
  let state = { ...initialForm(opts), active: idx('reviewers'), cursor: 0 };
  state = toggleLabel(state, opts);
  const launchInput = JSON.parse(
    JSON.stringify({
      project: 'bakers',
      is_new: true,
      ...serialize(state, opts),
    }),
  ) as { reviewers: unknown; assignee: unknown };
  expect(launchInput.reviewers).toEqual([{ id: 'u1', label: 'cw' }]);
  expect(launchInput.assignee).toEqual({ id: 'u1', label: 'cw' });
});

// BB-664 AC-8 — a project in scope declares the ORDINARY form, unchanged;
// no project in scope declares a second one with an extra Project field ahead
// of everything else.
describe('CREATE_FORM vs CREATE_FORM_WITH_PROJECT (BB-664 AC-8)', () => {
  it('CREATE_FORM (a project already in scope) carries no `project` field', async () => {
    const { CREATE_FORM } = await import(
      '../../../../src/Entity/ticket/Form/create.js'
    );
    expect(CREATE_FORM.fields.some((f) => f.id === 'project')).toBe(false);
    expect(CREATE_FORM.fields[0]?.id).toBe('title');
  });

  it('CREATE_FORM_WITH_PROJECT (no project in scope) opens on the Project field', async () => {
    const { CREATE_FORM_WITH_PROJECT } = await import(
      '../../../../src/Entity/ticket/Form/create.js'
    );
    expect(CREATE_FORM_WITH_PROJECT.fields[0]).toMatchObject({
      id: 'project',
      kind: 'autocomplete',
      from: 'projects',
      query: 'projectQuery',
    });
    // Every other field is the same list, just one later (AC-8: "nothing else
    // about the form changes").
    expect(CREATE_FORM_WITH_PROJECT.fields.slice(1).map((f) => f.id)).toEqual(
      CREATE_FORM.fields.map((f) => f.id),
    );
  });
});

describe('template picker', () => {
  it('is a clearable select declared just before the two action rows', () => {
    const ids = FIELDS.map((f) => f.id);
    expect(ids.slice(-3)).toEqual(['template', 'submit', 'direct']);
    expect(FIELDS.find((f) => f.id === 'template')).toMatchObject({
      kind: 'select',
      from: 'templates',
      clearable: true,
    });
  });

  it('opens with no template picked even when templates exist', () => {
    const withTemplates = {
      ...opts,
      templates: [{ id: 'tp1', label: 'Weekly' }],
    };
    expect(
      CREATE_FORM.initial(withTemplates, { template: null }).template,
    ).toBeNull();
  });

  it('is not remembered from one open to the next', () => {
    expect(Object.keys(rememberedValues(initialForm(opts)))).not.toContain(
      'template',
    );
  });

  it('cycles from none to the first template and back', () => {
    const withTemplates = {
      ...opts,
      templates: [{ id: 'tp1', label: 'Weekly' }],
    };
    let state = CREATE_FORM.initial(withTemplates, { template: null });
    state = { ...state, active: FIELDS.findIndex((f) => f.id === 'template') };
    state = CREATE_FORM.apply(state, withTemplates, { kind: 'cycle', dir: 1 });
    expect(state.template).toBe('tp1');
    state = CREATE_FORM.apply(state, withTemplates, { kind: 'clear' });
    expect(state.template).toBeNull();
  });
});
