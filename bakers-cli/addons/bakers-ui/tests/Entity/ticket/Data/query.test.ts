import { expect, it } from 'vitest';
import {
  buildTicketQueryParams,
  CLOSED_FILTER_VALUES,
  cycleValue,
  describeCriteria,
  hasActiveCriteria,
  STATE_FILTER_VALUES,
} from '../../../../src/Entity/ticket/Data/query.js';

const PARENT = { id: 'uuid-parent', identifier: 'BB-273' };

const qs = (projectId, criteria, options) =>
  decodeURIComponent(
    buildTicketQueryParams(projectId, criteria, options).getQueryString(),
  );

const NONE = {
  query: '',
  state: null,
  closed: false,
  parent: null,
};

// BB-292 — the sparse fieldset and the explicit page.
it('requests only the rendered fields, relationships included (AC-1, AC-5)', () => {
  const s = qs('P1', NONE);
  expect(s).toMatch(
    /fields\[bb_ticket--bb_ticket\]=identifier,title,state,priority,assignee_initials,owner_initials,derived_status,stall_reason,workflow,closed,frozen,labels,parent_id,conductor_id,assignee_user_id/,
  );
  expect(s).toMatch(/fields\[bb_conductor--bb_conductor\]=label/);
  // The whole point: description and the other 18 attributes are not asked for.
  expect(s).not.toMatch(/description/);
});

it('pages 20 rows and offsets by the page index (AC-3)', () => {
  // 20 since the operator's live review; the default comes from the single
  // `LIST_PAGE_SIZE`, so this asserts the shipped cap and not a literal.
  expect(qs('P1', NONE)).toMatch(/page\[limit\]=20/);
  // Page one carries no offset, so its query stays minimal.
  expect(qs('P1', NONE)).not.toMatch(/page\[offset\]/);
  expect(qs('P1', NONE, { page: { size: 20, index: 1 } })).toMatch(
    /page\[offset\]=20/,
  );
  expect(qs('P1', NONE, { page: { size: 20, index: 3 } })).toMatch(
    /page\[offset\]=60/,
  );
});

it('keeps every criterion on every page (AC-4)', () => {
  const criteria = {
    query: 'bakers.build',
    state: 'working',
    closed: true,
    parent: PARENT,
  };
  for (const index of [0, 1, 7]) {
    const s = qs('P1', criteria, { page: { size: 15, index } });
    expect(s).toMatch(/project_id\.id/);
    expect(s).toMatch(
      /filter\[state\]\[value\]=working|filter\[state\]=working/,
    );
    expect(s).toMatch(/filter\[closed\]=1/);
    expect(s).toMatch(/parent_id\.id/);
    expect(s).toMatch(/filter\[search\]=bakers.build/);
    expect(s).toContain('sort=-changed,-drupal_internal__id');
  }
});

it('honours a caller page size and can drop the includes (D8)', () => {
  const s = qs('P1', NONE, { page: { size: 50, index: 0 }, includes: false });
  expect(s).toMatch(/page\[limit\]=50/);
  expect(s).not.toMatch(/include=/);
});

it('default criteria: project + closed=0 filter, sort + page, no search/state', () => {
  const s = qs('P1', {
    query: '',
    state: null,
    closed: false,
    parent: null,
    who: null,
  });
  expect(s).toMatch(/project_id\.id/);
  expect(s).toMatch(/filter\[closed\]=0/);
  expect(s).not.toMatch(/CONTAINS/);
  // The FILTER, narrowed from a bare /workflow/ by BB-292: `workflow` is now a
  // member of the sparse fieldset (it feeds the client-side type predicate), so
  // the unqualified match would fire on the fieldset rather than on a filter.
  expect(s).not.toMatch(/filter\[workflow\]/);
});

it('sideloads parent_id + conductor_id for empty and active criteria (AC-5)', () => {
  expect(
    qs('P1', {
      query: '',
      state: null,
      closed: false,
      parent: null,
      who: null,
    }),
  ).toMatch(/include=parent_id,conductor_id/);
  expect(
    qs('P1', {
      query: 'x',
      state: 'working',
      closed: false,
      parent: null,
      who: null,
    }),
  ).toMatch(/include=parent_id,conductor_id/);
});

it('search-only: the typed line goes to the server verbatim as filter[search]', () => {
  const s = qs('P1', {
    query: 'bakers#19',
    state: null,
    closed: false,
    parent: null,
    who: null,
  });
  expect(s).toMatch(/filter\[search\]=bakers#19/);
  // The grammar is the server's: no client-side identifier/title group.
  expect(s).not.toMatch(/CONTAINS/);
  expect(s).not.toMatch(/filter\[identifier\]/);
  expect(s).not.toMatch(/filter\[title\]/);
});

it('state-only: equality filter on state, no CONTAINS', () => {
  const s = qs('P1', {
    query: '',
    state: 'working',
    closed: false,
    parent: null,
    who: null,
  });
  expect(s).toMatch(/state/);
  expect(s).toMatch(/working/);
  expect(s).not.toMatch(/CONTAINS/);
});

// BB-299 D2 — the `t type` filter is gone: no criteria value may build a
// `filter[workflow]` param (the workflow attribute itself stays, spec F4).
it('no criteria combination builds a workflow filter (BB-299 AC-3)', () => {
  const s = qs('P1', {
    query: 'bar',
    state: 'review',
    closed: false,
    parent: PARENT,
    who: null,
  });
  expect(s).toMatch(/filter\[search\]=bar/);
  expect(s).toMatch(/review/);
  expect(s).toMatch(/filter\[parent_id\.id\]=uuid-parent/);
  // Narrowed from a bare /workflow/: the attribute stays in the BB-292
  // sparse fieldset (it feeds `TicketRow.type`), so only the FILTER may not.
  expect(s).not.toMatch(/filter\[workflow\]/);
});

it('closed-only: filter[closed]=1', () => {
  expect(
    qs('P1', {
      query: '',
      state: null,
      closed: true,
      parent: null,
      who: null,
    }),
  ).toMatch(/filter\[closed\]=1/);
});

it('closed null: no closed filter at all', () => {
  const s = qs('P1', {
    query: '',
    state: null,
    closed: null,
    parent: null,
    who: null,
  });
  expect(s).not.toMatch(/filter\[closed\]/);
});

it('closed filter never serializes as a boolean literal (spec fact 7)', () => {
  for (const closed of [false, true] as const) {
    const s = qs('P1', {
      query: '',
      state: null,
      closed,
      parent: null,
      who: null,
    });
    expect(s).not.toMatch(/filter\[closed\]=(true|false)/);
  }
});

it('closed is a top-level AND filter beside the search (AC-5)', () => {
  const s = qs('P1', {
    query: 'bar',
    state: null,
    closed: false,
    parent: null,
    who: null,
  });
  expect(s).toMatch(/filter\[closed\]=0/);
  expect(s).toMatch(/filter\[search\]=bar/);
});

it('parent-only: top-level parent_id.id filter, no CONTAINS group (AC-1)', () => {
  const s = qs('P1', {
    query: '',
    state: null,
    closed: null,
    parent: PARENT,
    who: null,
  });
  expect(s).toMatch(/filter\[parent_id\.id\]=uuid-parent/);
  expect(s).not.toMatch(/CONTAINS/);
});

it('all criteria: parent ANDs with state; the search OR group is unchanged (AC-5)', () => {
  const s = qs('P1', {
    query: 'foo',
    state: 'plan',
    closed: null,
    parent: PARENT,
    who: null,
  });
  // Top-level equality filters, ANDed with the project filter.
  expect(s).toMatch(/filter\[parent_id\.id\]=uuid-parent/);
  expect(s).toMatch(/filter\[state\]=plan/);
  // BB-299 AC-3 — no `type` criterion exists, so no workflow filter is built
  // (narrowed from a bare /workflow/: the attribute stays in the fieldset).
  expect(s).not.toMatch(/filter\[workflow\]/);
  // The free-text search is the typed line, which the server resolves.
  expect(s).toMatch(/filter\[search\]=foo/);
  expect(s).not.toMatch(/CONTAINS/);
  // The parent filter must not leak into the search group.
  expect(s).not.toMatch(/parent_id.*search/);
});

it('cycleValue: null -> first -> ... -> last -> null', () => {
  const v = ['a', 'b'];
  expect(cycleValue(v, null)).toBe('a');
  expect(cycleValue(v, 'a')).toBe('b');
  expect(cycleValue(v, 'b')).toBe(null);
});

it('cycleValue cycles CLOSED_FILTER_VALUES null -> false -> true -> null', () => {
  expect(cycleValue(CLOSED_FILTER_VALUES, null)).toBe(false);
  expect(cycleValue(CLOSED_FILTER_VALUES, false)).toBe(true);
  expect(cycleValue(CLOSED_FILTER_VALUES, true)).toBe(null);
});

it('hasActiveCriteria / describeCriteria', () => {
  expect(
    hasActiveCriteria({
      query: '',
      state: null,
      closed: null,
      parent: null,
      who: null,
    }),
  ).toBe(false);
  expect(
    hasActiveCriteria({
      query: 'x',
      state: null,
      closed: null,
      parent: null,
      who: null,
    }),
  ).toBe(true);
  expect(
    describeCriteria({
      query: '',
      state: null,
      closed: null,
      parent: null,
      who: null,
    }),
  ).toBe('');
  expect(
    describeCriteria({
      query: 'x',
      state: 'plan',
      closed: null,
      parent: null,
      who: null,
    }),
  ).toMatch(/search:"x".*status:plan/);
});

// BB-299 AC-3 — with the `type` criterion gone, `describeCriteria` cannot
// produce a `type:` segment from any criteria object.
it('describeCriteria cannot produce a type: segment (BB-299 AC-3)', () => {
  expect(
    describeCriteria({
      query: 'x',
      state: 'plan',
      closed: true,
      parent: PARENT,
      who: null,
    }),
  ).not.toMatch(/type:/);
});

it('hasActiveCriteria / describeCriteria with the closed criterion (D2)', () => {
  expect(
    hasActiveCriteria({
      query: '',
      state: null,
      closed: false,
      parent: null,
      who: null,
    }),
  ).toBe(true); // the default narrows the view, and says so
  expect(
    hasActiveCriteria({
      query: '',
      state: null,
      closed: null,
      parent: null,
      who: null,
    }),
  ).toBe(false);
  expect(
    describeCriteria({
      query: '',
      state: null,
      closed: false,
      parent: null,
      who: null,
    }),
  ).toBe('closed:hidden');
  expect(
    describeCriteria({
      query: '',
      state: null,
      closed: true,
      parent: null,
      who: null,
    }),
  ).toBe('closed:only');
  expect(
    describeCriteria({
      query: '',
      state: null,
      closed: null,
      parent: null,
      who: null,
    }),
  ).toBe('');
});

it('hasActiveCriteria / describeCriteria with a parent: identifier, never the uuid (AC-2)', () => {
  expect(
    hasActiveCriteria({
      query: '',
      state: null,
      closed: null,
      parent: PARENT,
      who: null,
    }),
  ).toBe(true);
  expect(
    describeCriteria({
      query: '',
      state: null,
      closed: null,
      parent: PARENT,
      who: null,
    }),
  ).toBe('parent:BB-273');
  expect(
    describeCriteria({
      query: 'x',
      state: 'plan',
      closed: null,
      parent: PARENT,
      who: null,
    }),
  ).toBe('search:"x" · status:plan · parent:BB-273');
});

it('constants are non-empty and include the known values', () => {
  expect(STATE_FILTER_VALUES).toContain('plan');
  expect(STATE_FILTER_VALUES).toContain('working');
  expect(STATE_FILTER_VALUES).not.toContain('coding');
});

const WHO = { id: 'u-1', label: 'cw' };

// BB-299 D3 — the Who criterion: `{ id, label }` where the uuid is what the
// query filters by and the label is what the summary names.
it('who-only: top-level assignee_user_id.id filter, no CONTAINS group (BB-299 AC-4)', () => {
  const s = qs('P1', {
    query: '',
    state: null,
    closed: null,
    parent: null,
    who: WHO,
  });
  expect(s).toMatch(/filter\[assignee_user_id\.id\]=u-1/);
  expect(s).not.toMatch(/CONTAINS/);
});

it('who ANDs top-level with state/closed/parent; the search OR group is unchanged (BB-299 AC-4)', () => {
  const s = qs('P1', {
    query: 'foo',
    state: 'plan',
    closed: null,
    parent: PARENT,
    who: WHO,
  });
  expect(s).toMatch(/filter\[assignee_user_id\.id\]=u-1/);
  expect(s).toMatch(/filter\[parent_id\.id\]=uuid-parent/);
  expect(s).toMatch(/filter\[state\]=plan/);
  // The free-text search is the typed line, which the server resolves.
  expect(s).toMatch(/filter\[search\]=foo/);
  expect(s).not.toMatch(/CONTAINS/);
  // The who filter must not leak into the search group.
  expect(s).not.toMatch(/assignee_user_id.*search/);
});

it('hasActiveCriteria / describeCriteria with a who: the label, never the uuid (BB-299 D3)', () => {
  // A who alone narrows the view, and says so.
  expect(
    hasActiveCriteria({
      query: '',
      state: null,
      closed: null,
      parent: null,
      who: WHO,
    }),
  ).toBe(true);
  expect(
    describeCriteria({
      query: '',
      state: null,
      closed: null,
      parent: null,
      who: WHO,
    }),
  ).toBe('who:cw');
  expect(
    describeCriteria({
      query: 'x',
      state: null,
      closed: null,
      parent: null,
      who: WHO,
    }),
  ).toBe('search:"x" · who:cw');
});

// The conductor-scoped assigned-tickets query.
import { buildConductorTicketQueryParams } from '../../../../src/Entity/ticket/Data/query.js';

const conductorTicketQs = (
  id: string,
  page?: { size: number; index: number },
) =>
  decodeURIComponent(
    buildConductorTicketQueryParams(id, page).getQueryString(),
  );

it('scopes assigned tickets to the conductor and hides closed ones', () => {
  const s = conductorTicketQs('C1');
  expect(s).toContain('filter[conductor_id.id]=C1');
  expect(s).toContain('filter[closed]=0');
  expect(s).toContain('sort=-changed,-drupal_internal__id');
  expect(s).toContain('page[limit]=20');
});

it('does not narrow by project: a conductor may serve more than one', () => {
  expect(conductorTicketQs('C1')).not.toContain('project_id.id');
});
