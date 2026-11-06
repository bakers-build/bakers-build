import type { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { expect, it } from 'vitest';
import {
  loadParentCandidates,
  PARENT_PAGE_SIZE,
} from '../../../../src/Entity/ticket/Data/parents.js';
import { fakeClient } from '../../../test-support.js';

// BB-257 D7 — the PARENT CANDIDATE read. A data module: it returns tickets and
// knows nothing about forms, options or popups (the boundary guard G2 keeps it
// on that side of the line — it may read `Entity/transport` and its own slice's
// `query.ts`, nothing else).
//
// The whole argument for this module is REUSE: the parent picker searches
// through the same `buildTicketQueryParams` the project screen's `/` search
// uses, so the two cannot drift. How WIDE the search matches is the caller's
// choice: the create form keeps the server-resolved identifier+title search (BB-257 S5),
// the parent FILTER picker matches by identifier only (BB-284, PM steer —
// the operator knows `BB-273`, not the title). The cases below assert the
// query that goes on the wire, not a re-spelled copy of the builder's own
// unit tests.

const PROJECT = 'pppppppp-0000-0000-0000-000000000001';
const PATH = 'bb_ticket/bb_ticket';

const ticket = (id: string, identifier: string, title: string) => ({
  type: 'bb_ticket--bb_ticket',
  id,
  attributes: { identifier, title },
});

const doc = {
  [PATH]: {
    data: [
      ticket('t1', 'BB-236', 'a declared form kernel'),
      ticket('t2', 'BB-257', 'the New-ticket popup'),
    ],
  },
};

/** The query string the fake was actually asked for, decoded for readability. */
const queryString = (params: unknown): string =>
  decodeURIComponent((params as DrupalJsonApiParams).getQueryString());

it('maps each row to id + identifier + title, and nothing else', async () => {
  const client = fakeClient({ documents: doc });
  const outcome = await loadParentCandidates(client, PROJECT, '');
  expect(outcome.rows).toEqual([
    { id: 't1', identifier: 'BB-236', title: 'a declared form kernel' },
    { id: 't2', identifier: 'BB-257', title: 'the New-ticket popup' },
  ]);
  expect(outcome.error).toBeUndefined();
});

it('requests the bb_ticket collection, scoped to the project', async () => {
  const client = fakeClient({ documents: doc });
  await loadParentCandidates(client, PROJECT, '');
  expect(client.requests.map((r) => r.path)).toEqual([PATH]);
  const s = queryString(client.requests[0]?.params);
  expect(s).toContain('project_id.id');
  expect(s).toContain(PROJECT);
});

it('a query becomes the server-resolved filter[search] (AC-5)', async () => {
  const client = fakeClient({ documents: doc });
  await loadParentCandidates(client, PROJECT, 'BB-2');
  const s = queryString(client.requests[0]?.params);
  expect(s).toContain('filter[search]=BB-2');
  // Still project-scoped: the search narrows WITHIN the project (D8).
  expect(s).toContain('project_id.id');
});

it("match 'identifier' narrows by identifier only — top-level CONTAINS, no title, no OR group (BB-284 PM steer)", async () => {
  // The parent FILTER picker matches by identifier alone: the operator
  // filtering a list knows `BB-273`, not the title. The create form keeps
  // the default server-resolved search above.
  const client = fakeClient({ documents: doc });
  await loadParentCandidates(client, PROJECT, 'BB-2', 'identifier');
  const s = queryString(client.requests[0]?.params);
  expect(s).toContain('filter[identifier][operator]=CONTAINS');
  expect(s).toContain('BB-2');
  expect(s).not.toContain('filter[title]');
  expect(s).not.toContain('filter[search][group]');
  // Still project-scoped: the search narrows WITHIN the project.
  expect(s).toContain('project_id.id');
});

it("match 'identifier' with an empty query adds no CONTAINS filter at all", async () => {
  const client = fakeClient({ documents: doc });
  await loadParentCandidates(client, PROJECT, '', 'identifier');
  expect(queryString(client.requests[0]?.params)).not.toContain('CONTAINS');
});

it('the picker path filters to tickets with children; the create form path does not (BB-300 D1, AC-1/AC-7)', async () => {
  // The parent FILTER picker offers only tickets that HAVE children — the
  // server rewrites filter[has_children]=1 into a stock id IN (…) filter
  // (bb_core's HasChildrenFilterSubscriber), so paging stays honest. The
  // create form deliberately emits NO such filter: a ticket must be fileable
  // under a childless parent.
  const picker = fakeClient({ documents: doc });
  await loadParentCandidates(picker, PROJECT, '', 'identifier');
  expect(queryString(picker.requests[0]?.params)).toContain(
    'filter[has_children]=1',
  );
  const create = fakeClient({ documents: doc });
  await loadParentCandidates(create, PROJECT, '');
  expect(queryString(create.requests[0]?.params)).not.toContain('has_children');
});

it('the edit form offers OPEN tickets only; the filter picker still sees closed ones (BB-309 D13, AC-13)', async () => {
  // The human's decision during `coding`: filing work under a closed parent
  // is not a case the edit form should offer, so its read carries
  // `filter[closed]=0`. The parent FILTER picker asks a different question — an
  // operator narrowing a list by a parent that has since been closed is
  // legitimate, and its children are still open — so it keeps sending no
  // `closed` filter at all. Both halves are asserted in one case, because the
  // decision is the DIFFERENCE between the two callers.
  const create = fakeClient({ documents: doc });
  await loadParentCandidates(create, PROJECT, '');
  expect(queryString(create.requests[0]?.params)).toContain('filter[closed]=0');
  const picker = fakeClient({ documents: doc });
  await loadParentCandidates(picker, PROJECT, '', 'identifier');
  expect(queryString(picker.requests[0]?.params)).not.toContain('closed');
});

it('an empty query adds no CONTAINS group at all', async () => {
  const client = fakeClient({ documents: doc });
  await loadParentCandidates(client, PROJECT, '');
  expect(queryString(client.requests[0]?.params)).not.toContain('CONTAINS');
});

it('the candidate read never carries a parent_id filter, even now the shared builder supports one (R2)', async () => {
  // The candidate read must never see the filter it feeds (spec F7): a caller
  // that passed the FOREGROUND_ACTIVE criteria through would narrow the picker to the
  // active parent's children — a self-referential filter. `loadParentCandidates`
  // therefore passes `parent: null` explicitly, and this case is the guard.
  // (`include=parent_id` stays — the include is not a filter.)
  const client = fakeClient({ documents: doc });
  await loadParentCandidates(client, PROJECT, 'BB-2');
  const s = queryString(client.requests[0]?.params);
  expect(s).not.toContain('filter[parent_id.id]');
});

it('asks for a sparse fieldset — the picker needs two attributes, not a body', async () => {
  // A `bb_ticket` carries its whole description; 50 of them is a lot of bytes
  // for a list that renders `BB-nnn · title`.
  const client = fakeClient({ documents: doc });
  await loadParentCandidates(client, PROJECT, '');
  const s = queryString(client.requests[0]?.params);
  expect(s).toContain('fields[bb_ticket--bb_ticket]');
  expect(s).toContain('identifier');
  expect(s).toContain('title');
  expect(s).not.toContain('description');
});

it('a row missing its attributes still yields a usable candidate', async () => {
  const client = fakeClient({
    documents: { [PATH]: { data: [{ type: 'bb_ticket', id: 't9' }] } },
  });
  expect((await loadParentCandidates(client, PROJECT, '')).rows).toEqual([
    { id: 't9', identifier: 't9', title: 'Untitled' },
  ]);
});

it('an empty collection is an ANSWER, not a failure', async () => {
  const client = fakeClient({ documents: { [PATH]: { data: [] } } });
  const outcome = await loadParentCandidates(client, PROJECT, 'nothing');
  expect(outcome.rows).toEqual([]);
  expect(outcome.error).toBeUndefined();
});

it('a failing read yields `[]` AND the reason (the outcome rule)', async () => {
  // The same rule `listOutcome` applies, so the adapter can record a `parents`
  // error exactly like every other bag (D4).
  const client = fakeClient({ documents: doc, failingPaths: [PATH] });
  const outcome = await loadParentCandidates(client, PROJECT, '');
  expect(outcome.rows).toEqual([]);
  expect(outcome.error).toBe(`no ${PATH}`);
});

// BB-292 D8 — the parent picker discloses truncation at exactly
// PARENT_PAGE_SIZE rows, so a silent drop to the list's 15 would make that
// disclosure a lie. And the includes it never rendered are dropped: a sparse
// fieldset that omits `parent_id`/`conductor_id` strips those relationships from
// the rows, so the sideloaded resources arrive with nothing pointing at them
// (spec fact 5) — the previous docblock claimed they survived.
it('the parent candidate read still asks for PARENT_PAGE_SIZE rows, and no includes', async () => {
  const client = fakeClient({ documents: doc });
  await loadParentCandidates(client, PROJECT, '');
  const s = queryString(client.requests[0]?.params);
  expect(s).toMatch(new RegExp(`page\\[limit\\]=${PARENT_PAGE_SIZE}`));
  expect(s).toMatch(/fields\[bb_ticket--bb_ticket\]=identifier,title/);
  expect(s).not.toMatch(/include=/);
});
