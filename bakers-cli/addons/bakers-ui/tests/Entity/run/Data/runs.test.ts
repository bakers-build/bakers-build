import type { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { expect, it } from 'vitest';
import {
  loadProjectRuns,
  mapRunData,
  RUN_LIST_ATTRIBUTES,
  selectedRunTicketId,
  ticketRunRows,
} from '../../../../src/Entity/run/Data/runs.js';
import type { DropshClient, JsonApiResource } from '../../../../src/types.js';

function fakeClient(doc: unknown): {
  client: DropshClient;
  captured: { path?: string; params?: unknown };
} {
  const captured: { path?: string; params?: unknown } = {};
  const client: DropshClient = {
    get: async (path, params) => {
      captured.path = path;
      captured.params = params;
      return doc;
    },
    collection: () => ({}) as never,
  };
  return { client, captured };
}

const RUN: JsonApiResource = {
  type: 'bb_run--bb_run',
  id: 'r1',
  attributes: {
    drupal_internal__id: 844,
    state: 'running',
    state_at_start: 'coding',
    agent: 'claude',
    started_at: '2026-07-21T15:00:00+00:00',
    heartbeat: '2026-07-21T15:05:00+00:00',
    claim_expires_at: '2026-07-21T16:00:00+00:00',
    created: '2026-07-21T14:00:00+00:00',
  },
  relationships: { ticket_id: { data: { id: 't1' } } },
};

const TICKET: JsonApiResource = {
  type: 'bb_ticket--bb_ticket',
  id: 't1',
  attributes: { identifier: 'BB-175' },
};

it('queries bb_run scoped to the project, sorted/paged/included', async () => {
  const { client, captured } = fakeClient({ data: [RUN], included: [TICKET] });
  // A PAGE since BB-292: rows plus `hasNext` off the document's `links.next`.
  const page = await loadProjectRuns(client, 'proj-1', { closed: false });

  expect(captured.path).toBe('bb_run/bb_run');
  const qs = decodeURIComponent(
    (captured.params as DrupalJsonApiParams).getQueryString(),
  );
  expect(qs).toContain('filter[ticket_id.project_id.id]=proj-1');
  expect(qs).toContain('filter[closed]=0');
  expect(qs).toContain('include=ticket_id');
  expect(qs).toContain('sort=-started_at,-drupal_internal__id');
  expect(qs).toContain('page[limit]=20');
  expect(page.rows).toHaveLength(1);
  // No `links` on this document, so it is the last page.
  expect(page.hasNext).toBe(false);
});

it('states the window its own query asked for (BB-312 D3)', async () => {
  const { client, captured } = fakeClient({ data: [RUN], included: [TICKET] });
  const page = await loadProjectRuns(client, 'proj-1', { closed: false }, 2);
  expect(page.window).toEqual({ offset: 40, limit: 20 });
  // The window and the query must be the SAME numbers — a window that drifted
  // from `page[offset]` would position the rows somewhere they are not.
  const qs = decodeURIComponent(
    (captured.params as DrupalJsonApiParams).getQueryString(),
  );
  expect(qs).toContain('page[offset]=40');
  expect(qs).toContain('page[limit]=20');
});

it('passes criteria through: closed null emits no closed filter', async () => {
  const { client, captured } = fakeClient({ data: [], included: [] });
  await loadProjectRuns(client, 'proj-1', { closed: null });
  const qs = decodeURIComponent(
    (captured.params as DrupalJsonApiParams).getQueryString(),
  );
  expect(qs).not.toMatch(/filter\[closed\]/);
});

it('maps a run resource + its included ticket to a RunRow', async () => {
  const { client } = fakeClient({ data: [RUN], included: [TICKET] });
  const [row] = (await loadProjectRuns(client, 'proj-1', { closed: false }))
    .rows;
  expect(row).toEqual({
    id: 'r1',
    drupalId: 844,
    ticketId: 't1',
    ticketIdentifier: 'BB-175',
    ticketTitle: '',
    state: 'running',
    phase: 'coding',
    agent: 'claude',
    startedAt: '2026-07-21T15:00:00+00:00',
    heartbeat: '2026-07-21T15:05:00+00:00',
    claimExpiresAt: '2026-07-21T16:00:00+00:00',
    closed: false,
  });
});

it('falls back to created when started_at is null', () => {
  const row = mapRunData(
    {
      id: 'r2',
      attributes: {
        state: 'claimed',
        created: '2026-07-21T14:00:00+00:00',
        started_at: null,
      },
      relationships: { ticket_id: { data: { id: 't1' } } },
    },
    new Map([['t1', TICKET]]),
  );
  expect(row.startedAt).toBe('2026-07-21T14:00:00+00:00');
  expect(row.heartbeat).toBeNull();
  expect(row.claimExpiresAt).toBeNull();
});

it('renders a dash and null ticketId when the ticket include is absent', () => {
  const row = mapRunData(
    { id: 'r3', attributes: { state: 'done' }, relationships: {} },
    new Map(),
  );
  expect(row.ticketId).toBeNull();
  expect(row.ticketIdentifier).toBe('—');
  expect(row.phase).toBe('—');
  expect(row.agent).toBe('—');
});

it('resolves the selected run row to its ticket id (or null)', () => {
  const rows = [{ ticketId: 't1' }, { ticketId: null }] as ReturnType<
    typeof mapRunData
  >[];
  expect(selectedRunTicketId(rows, 0)).toBe('t1');
  expect(selectedRunTicketId(rows, 1)).toBeNull();
  expect(selectedRunTicketId(rows, 9)).toBeNull();
});

// ---- BB-255 D5: the ticket's OWN runs, out of the detail document ---------
//
// The ticket detail document already sideloads its `bb_run` includes with the
// full attribute set (spec fact 5, re-measured on BB-255), so the Runs tab and
// the run detail screen need no second request — and a second read would be a
// second failure mode on an already-loaded screen.

const ticketDoc = (runs: JsonApiResource[]) => ({
  data: {
    id: 't1',
    type: 'bb_ticket--bb_ticket',
    attributes: { identifier: 'BB-175' },
    relationships: { runs: { data: runs.map((r) => ({ id: r.id ?? '' })) } },
  },
  included: [...runs],
});

const run = (
  id: string,
  attributes: Record<string, unknown>,
): JsonApiResource => ({
  id,
  type: 'bb_run--bb_run',
  attributes,
  relationships: { ticket_id: { data: { id: 't1' } } },
});

it('ticketRunRows maps the sideloaded runs through mapRunData', () => {
  const rows = ticketRunRows(
    ticketDoc([
      run('r1', {
        drupal_internal__id: 4599,
        state: 'running',
        state_at_start: 'coding',
        agent: 'claude',
        started_at: '2026-08-01T18:00:00+00:00',
      }),
    ]),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.drupalId).toBe(4599);
  expect(rows[0]?.state).toBe('running');
  expect(rows[0]?.phase).toBe('coding');
  expect(
    rows[0]?.ticketIdentifier,
    'the ticket itself resolves the TICKET column',
  ).toBe('BB-175');
});

it('ticketRunRows ignores non-run includes and yields [] when there are none', () => {
  const doc = {
    data: { id: 't1', attributes: {}, relationships: {} },
    included: [
      { id: 'c1', type: 'bb_comment--bb_comment', attributes: {} },
      { id: 'l1', type: 'bb_term--bb_labels', attributes: { name: 'x' } },
    ],
  };
  expect(ticketRunRows(doc)).toEqual([]);
  expect(ticketRunRows({})).toEqual([]);
});

it('ticketRunRows sorts newest-started first, and the order is TOTAL', () => {
  const runs = [
    run('r-old', {
      drupal_internal__id: 1,
      started_at: '2026-08-01T10:00:00+00:00',
    }),
    run('r-new', {
      drupal_internal__id: 2,
      started_at: '2026-08-01T18:00:00+00:00',
    }),
    run('r-mid', {
      drupal_internal__id: 3,
      started_at: '2026-08-01T14:00:00+00:00',
    }),
  ];
  const ids = (list: JsonApiResource[]): string[] =>
    ticketRunRows(ticketDoc(list)).map((r) => r.id);
  expect(ids(runs)).toEqual(['r-new', 'r-mid', 'r-old']);
  // Same rows, shuffled input ⇒ identical output. Determinism, not stability.
  expect(ids([...runs].reverse())).toEqual(['r-new', 'r-mid', 'r-old']);
  expect(
    ids([
      runs[2] as JsonApiResource,
      runs[0] as JsonApiResource,
      runs[1] as JsonApiResource,
    ]),
  ).toEqual(['r-new', 'r-mid', 'r-old']);
});

it('ticketRunRows falls back to created, and an unparseable start sorts last', () => {
  const rows = ticketRunRows(
    ticketDoc([
      run('r-broken', { drupal_internal__id: 9, started_at: 'not-a-date' }),
      run('r-created-only', {
        drupal_internal__id: 8,
        created: '2026-08-01T09:00:00+00:00',
      }),
    ]),
  );
  expect(
    rows.map((r) => r.id),
    'a malformed date can never take the top slot',
  ).toEqual(['r-created-only', 'r-broken']);
});

it('ties on the start time are broken by drupal_internal__id, then by id', () => {
  const same = '2026-08-01T10:00:00+00:00';
  expect(
    ticketRunRows(
      ticketDoc([
        run('a', { drupal_internal__id: 1, started_at: same }),
        run('b', { drupal_internal__id: 2, started_at: same }),
      ]),
    ).map((r) => r.id),
  ).toEqual(['b', 'a']);
  expect(
    ticketRunRows(
      ticketDoc([
        run('aaa', { started_at: same }),
        run('bbb', { started_at: same }),
      ]),
    ).map((r) => r.id),
  ).toEqual(['bbb', 'aaa']);
});

it('ticketRunRows does not mutate document.included', () => {
  const runs = [
    run('r-old', { started_at: '2026-08-01T10:00:00+00:00' }),
    run('r-new', { started_at: '2026-08-01T18:00:00+00:00' }),
  ];
  const doc = ticketDoc(runs);
  const before = (doc.included ?? []).map((r) => r.id);
  ticketRunRows(doc);
  expect((doc.included ?? []).map((r) => r.id)).toEqual(before);
});

// BB-292 AC-5, the run half: the fieldset is the mapper's own lower bound.
it('a run resource carrying exactly the fieldset maps with no fallback', () => {
  const attributes: Record<string, unknown> = {
    drupal_internal__id: 4784,
    state: 'running',
    state_at_start: 'spec',
    agent: 'claude',
    started_at: '2026-08-05T20:12:47+00:00',
    created: '2026-08-05T20:12:47+00:00',
    heartbeat: '2026-08-05T20:14:52+00:00',
    claim_expires_at: '2026-08-05T22:14:52+00:00',
    closed: false,
  };
  expect(Object.keys(attributes).sort()).toEqual(
    [...RUN_LIST_ATTRIBUTES].sort(),
  );
  const row = mapRunData(
    {
      id: 'run-1',
      attributes,
      relationships: { ticket_id: { data: { id: 't-1' } } },
    },
    new Map([['t-1', { attributes: { identifier: 'BB-292' } }]]),
  );
  expect(row.drupalId).toBe(4784);
  expect(row.ticketIdentifier).toBe('BB-292');
  expect(row.phase).toBe('spec');
  expect(row.agent).toBe('claude');
  expect(row.state).toBe('running');
  expect(row.closed).toBe(false);
});

it('resolves the ticket title from the sideloaded include', () => {
  const row = mapRunData(
    {
      id: 'r1',
      attributes: { state: 'running' },
      relationships: { ticket_id: { data: { id: 't1' } } },
    },
    new Map([
      [
        't1',
        { attributes: { identifier: 'BB-1', title: 'show which tickets' } },
      ],
    ]),
  );
  expect(row.ticketIdentifier).toBe('BB-1');
  expect(row.ticketTitle).toBe('show which tickets');
});

it('leaves the title empty when the include did not carry one', () => {
  const row = mapRunData(
    {
      id: 'r1',
      attributes: { state: 'running' },
      relationships: { ticket_id: { data: { id: 't1' } } },
    },
    new Map([['t1', { attributes: { identifier: 'BB-1' } }]]),
  );
  expect(row.ticketTitle).toBe('');
});
