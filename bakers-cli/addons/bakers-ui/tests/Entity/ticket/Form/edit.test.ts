import { beforeEach, describe, expect, it } from 'vitest';
import {
  activeEditField,
  CANCEL_TICKET_ACTION_ID,
  CANCELLED_STATE,
  cancelEditPayload,
  clearEditValue,
  cycleEdit,
  EDIT_FIELDS,
  EDIT_FIELDS_TERMINAL,
  type EditFormOptions,
  type EditFormState,
  editFormFor,
  initialEditForm,
  moveEditField,
  serializeEdit,
} from '../../../../src/Entity/ticket/Form/edit.js';
import { loadEditFormOptions } from '../../../../src/Entity/ticket/Form/edit-data.js';
import type { TicketDetailDocument } from '../../../../src/types.js';
import { fakeClient, toResource } from '../../../test-support.js';

const USER = 'aaaaaaaa-0000-0000-0000-000000000001';
const OTHER_USER = 'aaaaaaaa-0000-0000-0000-000000000002';
const COND = 'bbbbbbbb-0000-0000-0000-000000000001';
const OTHER_COND = 'bbbbbbbb-0000-0000-0000-000000000002';
const TICKET = 'cccccccc-0000-0000-0000-000000000001';
const PARENT = 'dddddddd-0000-0000-0000-000000000001';
const LABEL_A = 'eeeeeeee-0000-0000-0000-000000000001';
const LABEL_B = 'eeeeeeee-0000-0000-0000-000000000002';
const TYPE = 'eeeeeeee-0000-0000-0000-000000000003';
const RECIPE = 'eeeeeeee-0000-0000-0000-000000000004';

const opts: EditFormOptions = {
  users: [
    { id: USER, label: 'cw' },
    { id: OTHER_USER, label: 'tm' },
  ],
  reviewers: [
    { id: USER, label: 'cw' },
    { id: OTHER_USER, label: 'tm' },
  ],
  conductors: [
    { id: COND, label: 'cw-framework (online)' },
    { id: OTHER_COND, label: 'tom (offline)' },
  ],
  ticketTypes: [{ id: TYPE, label: 'feature' }],
  recipes: [{ id: RECIPE, label: 'drupal-feature' }],
  labels: [
    { id: LABEL_A, label: 'work:code' },
    { id: LABEL_B, label: 'work:docs' },
  ],
};

function doc(
  rel: {
    assignee?: string | null;
    conductor?: string | null;
    parent?: string | null;
    ticketType?: string | null;
    recipe?: string | null;
    labels?: string[];
    reviewers?: string[] | undefined;
  } = {},
  extra: {
    attributes?: Record<string, unknown>;
    runs?: string[];
    included?: TicketDetailDocument['included'];
  } = {},
): TicketDetailDocument {
  return {
    data: {
      id: TICKET,
      type: 'bb_ticket--bb_ticket',
      attributes: { identifier: 'BB-233', ...(extra.attributes ?? {}) },
      relationships: {
        assignee_user_id: {
          data: rel.assignee ? { id: rel.assignee } : null,
        },
        conductor_id: { data: rel.conductor ? { id: rel.conductor } : null },
        parent_id: {
          data: rel.parent ? { id: rel.parent } : null,
        },
        ticket_type: {
          data: rel.ticketType ? { id: rel.ticketType } : null,
        },
        recipe: { data: rel.recipe ? { id: rel.recipe } : null },
        labels: {
          data: (rel.labels ?? []).map((id) => ({ id })),
        },
        ...(rel.reviewers === undefined
          ? {}
          : {
              reviewers: {
                data: rel.reviewers.map((id) => ({
                  type: 'user--user',
                  id,
                })),
              },
            }),
        runs: { data: (extra.runs ?? []).map((id) => ({ id })) },
      },
    },
    included: extra.included ?? [],
  };
}

let s: EditFormState;
beforeEach(() => {
  s = initialEditForm(doc({ assignee: USER, conductor: COND }));
});

// ---- AC-1: prefill from the TICKET, not from opts[0] ------------------------

it('AC-1: prefills both fields from the ticket relationships', () => {
  expect(s.ticketId).toBe(TICKET);
  expect(s.assignee).toBe(USER);
  expect(s.conductor).toBe(COND);
  expect(s.active).toBe(0);
});

it('AC-1: prefills null for an unassigned ticket, and mixes', () => {
  expect(initialEditForm(doc()).assignee).toBeNull();
  expect(initialEditForm(doc()).conductor).toBeNull();

  const onlyUser = initialEditForm(doc({ assignee: USER }));
  expect(onlyUser.assignee).toBe(USER);
  expect(onlyUser.conductor).toBeNull();

  const onlyCond = initialEditForm(doc({ conductor: COND }));
  expect(onlyCond.assignee).toBeNull();
  expect(onlyCond.conductor).toBe(COND);
});

it('AC-1: the field list is assignee, reviewers, conductor, estimate, spent, parent, type, recipe, labels, save, cancelTicket', () => {
  // BB-360: State select is gone; Parent + Labels sit before the dual actions.
  // BAKERS-17: Type and Recipe sit between them.
  // Cancel ticket is a dedicated action id — never `cancel` (Esc owns that intent).
  expect(EDIT_FIELDS.map((f) => f.id)).toEqual([
    'assignee',
    'reviewers',
    'conductor',
    'estimate',
    'spent',
    'parent',
    'ticketType',
    'recipe',
    'labels',
    'submit',
    CANCEL_TICKET_ACTION_ID,
  ]);
  expect(CANCEL_TICKET_ACTION_ID).toBe('cancelTicket');
  expect(EDIT_FIELDS.map((f) => f.id)).not.toContain('stateTarget');
  expect(EDIT_FIELDS.map((f) => f.label)).not.toContain('State');
  expect(activeEditField(s).id).toBe('assignee');
  expect(activeEditField(moveEditField(s, 1)).id).toBe('reviewers');
  expect(activeEditField(moveEditField(s, 2)).id).toBe('conductor');
  expect(moveEditField(s, -1).active).toBe(0);
  expect(moveEditField(s, 99).active).toBe(10);
});

// ---- AC-4: clearable, from both ends, in both directions --------------------

it('AC-4: the cycle reaches null from the LAST option going forward', () => {
  let f = { ...s, assignee: OTHER_USER, active: 0 }; // last user
  f = cycleEdit(f, opts, 1);
  expect(f.assignee).toBeNull();
  f = cycleEdit(f, opts, 1);
  expect(f.assignee).toBe(USER);
});

it('AC-4: the cycle reaches null from the FIRST option going backward', () => {
  let f = { ...s, assignee: USER, active: 0 }; // first user
  f = cycleEdit(f, opts, -1);
  expect(f.assignee).toBeNull();
  f = cycleEdit(f, opts, -1);
  expect(f.assignee).toBe(OTHER_USER); // wraps to the last
});

it('AC-4: the conductor field clears the same way, both directions', () => {
  let f = { ...s, conductor: OTHER_COND, active: 2 };
  f = cycleEdit(f, opts, 1);
  expect(f.conductor).toBeNull();
  f = { ...s, conductor: COND, active: 2 };
  f = cycleEdit(f, opts, -1);
  expect(f.conductor).toBeNull();
});

it('AC-4: the clear shortcut sets null on the active select only', () => {
  const cleared = clearEditValue({ ...s, active: 2 });
  expect(cleared.conductor).toBeNull();
  expect(cleared.assignee).toBe(USER); // untouched
  const clearedUser = clearEditValue({ ...s, active: 0 });
  expect(clearedUser.assignee).toBeNull();
  expect(clearedUser.conductor).toBe(COND);
  // On the Save action row it is a no-op.
  expect(clearEditValue({ ...s, active: 9 })).toEqual({ ...s, active: 9 });
});

it('cycleEdit only touches the active field', () => {
  const f = cycleEdit({ ...s, active: 2 }, opts, 1);
  expect(f.assignee).toBe(USER);
  expect(f.conductor).toBe(OTHER_COND);
});

// ---- ordinary Save payload (no state; always labels + parent) ---------------

it('serializeEdit emits assignee, conductor, labels and parent linkages', () => {
  expect(serializeEdit(s)).toEqual({
    attributes: { time_estimate: null, time_spent: null },
    relationships: {
      assignee_user_id: { data: { type: 'user--user', id: USER } },
      conductor_id: {
        data: { type: 'bb_conductor--bb_conductor', id: COND },
      },
      ticket_type: { data: null },
      recipe: { data: null },
      labels: { data: [] },
      parent_id: { data: null },
    },
  });
});

it('BAKERS-17: type and recipe prefill from the ticket and PATCH as to-one terms', () => {
  const typed = initialEditForm(doc({ ticketType: TYPE, recipe: RECIPE }));
  expect(typed.ticketType).toBe(TYPE);
  expect(typed.recipe).toBe(RECIPE);
  const body = serializeEdit(typed);
  expect(body.relationships.ticket_type).toEqual({
    data: { type: 'bb_term--type', id: TYPE },
  });
  expect(body.relationships.recipe).toEqual({
    data: { type: 'bb_term--recipe', id: RECIPE },
  });
  // Clearable like the assignment selects: null is a real position.
  expect(
    serializeEdit({ ...typed, ticketType: null }).relationships.ticket_type,
  ).toEqual({ data: null });
  for (const id of ['ticketType', 'recipe']) {
    expect(EDIT_FIELDS.find((f) => f.id === id)).toMatchObject({
      kind: 'select',
      clearable: true,
    });
  }
});

it('serializeEdit emits data: null for a cleared assignment field', () => {
  expect(
    serializeEdit({ ...s, conductor: null }).relationships.conductor_id,
  ).toEqual({ data: null });
  expect(
    serializeEdit({ ...s, assignee: null }).relationships.assignee_user_id,
  ).toEqual({ data: null });
});

it('serializeEdit always includes labels (possibly empty) and never attributes.state', () => {
  const empty = serializeEdit(s);
  expect(empty.relationships.labels).toEqual({ data: [] });
  expect(empty.attributes).not.toHaveProperty('state');

  const withLabels = serializeEdit({
    ...s,
    labels: new Set([LABEL_A, LABEL_B]),
  });
  expect(withLabels.relationships.labels).toEqual({
    data: [
      { type: 'bb_term--label', id: LABEL_A },
      { type: 'bb_term--label', id: LABEL_B },
    ],
  });
  expect(withLabels.attributes).not.toHaveProperty('state');
});

it('serializeEdit always includes parent_id as linkage or data: null', () => {
  expect(serializeEdit(s).relationships.parent_id).toEqual({ data: null });
  expect(
    serializeEdit({ ...s, parent: PARENT }).relationships.parent_id,
  ).toEqual({
    data: { type: 'bb_ticket--bb_ticket', id: PARENT },
  });
});

it('an UNCHANGED form still emits every relationship key (explicit no-op PATCH)', () => {
  const untouched = initialEditForm(doc({ assignee: USER, conductor: COND }));
  expect(Object.keys(serializeEdit(untouched).relationships).sort()).toEqual([
    'assignee_user_id',
    'conductor_id',
    'labels',
    'parent_id',
    'recipe',
    'ticket_type',
  ]);
});

it('omits reviewers when the relationship was missing and the set is still empty', () => {
  const missing = initialEditForm(doc({ assignee: USER, conductor: COND }));
  expect(missing.reviewers.size).toBe(0);
  expect(serializeEdit(missing).relationships).not.toHaveProperty('reviewers');
});

it('writes an empty reviewers set when the relationship was present', () => {
  const loaded = initialEditForm(
    doc({ assignee: USER, conductor: COND, reviewers: [] }),
  );
  expect(serializeEdit(loaded).relationships.reviewers).toEqual({ data: [] });
});

it('serializes two reviewers independently of the option bag', () => {
  const state = initialEditForm(
    doc({ assignee: USER, conductor: COND, reviewers: [USER, OTHER_USER] }),
  );
  expect([...state.reviewers]).toEqual([USER, OTHER_USER]);
  expect(serializeEdit(state).relationships.reviewers).toEqual({
    data: [
      { type: 'user--user', id: USER },
      { type: 'user--user', id: OTHER_USER },
    ],
  });
  expect(serializeEdit(state).relationships.assignee_user_id).toEqual({
    data: { type: 'user--user', id: USER },
  });
});

it('keeps an unavailable prefilled reviewer visible in the set and writes it', () => {
  const gone = 'ffffffff-0000-0000-0000-000000000099';
  const state = initialEditForm(
    doc({ assignee: USER, conductor: COND, reviewers: [gone] }),
  );
  expect([...state.reviewers]).toEqual([gone]);
  expect(opts.reviewers.map((o) => o.id)).not.toContain(gone);
  expect(serializeEdit(state).relationships.reviewers).toEqual({
    data: [{ type: 'user--user', id: gone }],
  });
});

it('writes reviewers the operator added even when the relationship was missing', () => {
  const added = serializeEdit({
    ...initialEditForm(doc({ assignee: USER, conductor: COND })),
    reviewers: new Set([USER]),
  });
  expect(added.relationships.reviewers).toEqual({
    data: [{ type: 'user--user', id: USER }],
  });
});

// ---- BB-308: the two accounted time fields --------------------------------

describe('the two time fields', () => {
  it('declares both as text fields after assignee, reviewers and conductor', () => {
    const ids = EDIT_FIELDS.map((f) => f.id);
    expect(ids.slice(0, 5)).toEqual([
      'assignee',
      'reviewers',
      'conductor',
      'estimate',
      'spent',
    ]);
  });

  it('prefills them from the ticket as human durations', () => {
    const state = initialEditForm({
      data: {
        id: 't1',
        attributes: { time_estimate: 14_400, time_spent: 39_600 },
        relationships: {},
      },
    } as never);
    expect(state.estimate).toBe('4h');
    expect(state.spent).toBe('11h');
  });

  it('prefills an unset field as an empty string, never as 0m', () => {
    const state = initialEditForm({
      data: { id: 't1', attributes: {}, relationships: {} },
    } as never);
    expect(state.estimate).toBe('');
    expect(state.spent).toBe('');
  });

  it('serialises both as seconds in attributes', () => {
    const state = initialEditForm({
      data: {
        id: 't1',
        attributes: { time_estimate: 14_400, time_spent: 39_600 },
        relationships: {},
      },
    } as never);
    expect(serializeEdit(state).attributes).toEqual({
      time_estimate: 14_400,
      time_spent: 39_600,
    });
  });

  it('serialises a cleared field as null, so the value can be REMOVED', () => {
    let state = initialEditForm({
      data: {
        id: 't1',
        attributes: { time_estimate: 14_400 },
        relationships: {},
      },
    } as never);
    state = { ...state, estimate: '' };
    expect(serializeEdit(state).attributes.time_estimate).toBeNull();
  });

  it('omits an unparseable field from the payload rather than writing garbage', () => {
    let state = initialEditForm({
      data: {
        id: 't1',
        attributes: { time_estimate: 14_400 },
        relationships: {},
      },
    } as never);
    state = { ...state, estimate: 'soon' };
    expect(serializeEdit(state).attributes).not.toHaveProperty('time_estimate');
  });
});

// ---- BB-360: labels + parent prefill --------------------------------------

describe('BB-360 — labels and parent prefill', () => {
  it('prefills labels from the document relationship ids', () => {
    const state = initialEditForm(
      doc({ labels: [LABEL_A, LABEL_B], assignee: USER }),
    );
    expect([...state.labels].sort()).toEqual([LABEL_A, LABEL_B].sort());
  });

  it('prefills an empty labels set when the ticket has none', () => {
    const state = initialEditForm(doc());
    expect(state.labels).toEqual(new Set());
  });

  it('prefills parent id from parent_id and null when absent', () => {
    expect(initialEditForm(doc()).parent).toBeNull();
    expect(initialEditForm(doc({ parent: PARENT })).parent).toBe(PARENT);
  });

  it('prefills parentQuery from the included parent when present', () => {
    const state = initialEditForm(
      doc(
        { parent: PARENT },
        {
          included: [
            {
              id: PARENT,
              type: 'bb_ticket--bb_ticket',
              attributes: { identifier: 'BB-1', title: 'Root work' },
            },
          ],
        },
      ),
    );
    expect(state.parent).toBe(PARENT);
    expect(state.parentQuery).toBe('BB-1 · Root work');
  });

  it('leaves parentQuery empty when the include is missing (id still set)', () => {
    const state = initialEditForm(doc({ parent: PARENT }));
    expect(state.parent).toBe(PARENT);
    expect(state.parentQuery).toBe('');
  });
});

// ---- BB-360: Cancel ticket payload and field lists ------------------------

describe('BB-360 — Cancel ticket and terminal declaration', () => {
  const withState = (state: string): TicketDetailDocument =>
    doc({ assignee: USER, conductor: COND }, { attributes: { state } });

  it('non-terminal declaration has parent, labels, Save and Cancel ticket — no State', () => {
    for (const state of ['qualification', 'plan', 'working', 'review'])
      expect(editFormFor(withState(state)).fields.map((f) => f.id)).toEqual([
        'assignee',
        'reviewers',
        'conductor',
        'estimate',
        'spent',
        'parent',
        'ticketType',
        'recipe',
        'labels',
        'submit',
        CANCEL_TICKET_ACTION_ID,
      ]);
  });

  it('terminal declaration has parent + labels + Save only (no Cancel ticket)', () => {
    for (const state of ['done', 'cancelled'])
      expect(editFormFor(withState(state)).fields.map((f) => f.id)).toEqual([
        'assignee',
        'reviewers',
        'conductor',
        'estimate',
        'spent',
        'parent',
        'ticketType',
        'recipe',
        'labels',
        'submit',
      ]);
    expect(EDIT_FIELDS_TERMINAL.map((f) => f.id)).not.toContain(
      CANCEL_TICKET_ACTION_ID,
    );
    expect(EDIT_FIELDS_TERMINAL.map((f) => f.id)).not.toContain('stateTarget');
  });

  it('D13: an unknown state fails OPEN — Cancel ticket is offered', () => {
    expect(editFormFor(doc()).fields.map((f) => f.id)).toContain(
      CANCEL_TICKET_ACTION_ID,
    );
  });

  it('cancelEditPayload is lifecycle-only: state cancelled, no relationships', () => {
    expect(cancelEditPayload()).toEqual({
      attributes: { state: CANCELLED_STATE },
    });
    expect(cancelEditPayload()).not.toHaveProperty('relationships');
    expect(Object.keys(cancelEditPayload().attributes)).toEqual(['state']);
  });

  it('ordinary serializeEdit never emits state even if the form was edited', () => {
    const base = initialEditForm(withState('working'));
    expect(serializeEdit(base).attributes).not.toHaveProperty('state');
    expect(
      serializeEdit({
        ...base,
        labels: new Set([LABEL_A]),
        parent: PARENT,
      }).attributes,
    ).not.toHaveProperty('state');
  });

  it('CANCELLED_STATE is still the cancelled machine name', () => {
    expect(CANCELLED_STATE).toBe('cancelled');
  });
});

it('the edit popup offers my conductors first (AC-14)', async () => {
  const conductor = (id: string, owner: string | null) =>
    toResource({
      type: 'bb_conductor--bb_conductor',
      id,
      attributes: { label: id, status: 'online' },
      relationships: {
        owner_user_id: { data: owner === null ? null : { id: owner } },
        project_id: { data: { id: 'p1' } },
      },
    });
  const client = fakeClient({
    rows: {
      bb_conductor: [conductor('tom', 'user-tm'), conductor('mine', 'user-cw')],
    },
  });
  const options = await loadEditFormOptions(
    { read: client },
    { projectId: 'p1', ownerUserId: 'user-cw' },
  );
  expect(options.conductors.map((c) => c.id)).toEqual(['mine', 'tom']);
});

describe("a closed ticket's edit popup", () => {
  it('gets the read-only declaration: no Save, no Cancel ticket', () => {
    const closed = doc(
      { assignee: USER, conductor: COND },
      { attributes: { state: 'done', closed: true } },
    );
    expect(editFormFor(closed).fields.map((f) => f.id)).toEqual([
      'assignee',
      'reviewers',
      'conductor',
      'estimate',
      'spent',
      'parent',
      'ticketType',
      'recipe',
      'labels',
    ]);
  });
});

it('a reviewers relationship without data is not a loaded empty set', () => {
  const s = initialEditForm({
    data: {
      id: 't1',
      attributes: {},
      relationships: { reviewers: { links: { self: { href: 'x' } } } },
    },
  } as never);
  expect(s.reviewersLoaded).toBe(false);
  expect([...s.reviewers]).toEqual([]);
});
