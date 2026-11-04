import type { VNode } from '@opentui/core';
import { describe, expect, it } from 'vitest';
import { listTableTree } from '../../../../src/Entity/collection.js';
import {
  CONDUCTOR_TABLE,
  type ConductorListContext,
  type ConductorRow,
  countConductors,
  listConductorRowPage,
  listConductors,
  listConductorsPreferringWrite,
  PROJECT_CONDUCTOR_TABLE,
} from '../../../../src/Entity/conductor/Data/conductors.js';
import { cellValues, idsOf, nodeById } from '../../../render-tree.js';
import {
  fakeClient,
  queryStringOf,
  toResource,
} from '../../../test-support.js';

// BB-236 — the CONDUCTOR data service returns CONDUCTORS: the fields, the label
// fallbacks, the project linkage and the two read strategies. The project filter and
// the `(status)` label are the EDIT popup's rules, not the data's — they are asserted
// in `edit-form-data.test.ts`, where they live.

const PROJECT = 'pppppppp-0000-0000-0000-000000000001';
const OTHER_PROJECT = 'pppppppp-0000-0000-0000-000000000002';

/** `project: null` means the resource carries no `project_id` relationship at all. */
const conductor = (
  id: string,
  attrs: Record<string, unknown> = {},
  project: string | null = PROJECT,
  ownerUserId: string | null | undefined = undefined,
): ReturnType<typeof toResource> => {
  const relationships: Record<string, { data?: { id: string } | null }> = {};
  if (project !== null) {
    relationships.project_id = { data: { id: project } };
  }
  if (ownerUserId !== undefined) {
    relationships.owner_user_id = {
      data: ownerUserId ? { id: ownerUserId } : null,
    };
  }
  return toResource({
    id,
    type: 'bb_conductor--bb_conductor',
    attributes: attrs,
    ...(Object.keys(relationships).length > 0 ? { relationships } : {}),
  });
};

const rows = () => ({
  bb_conductor: [
    conductor('c1', {
      label: 'cw-framework',
      machine_id: 'm1',
      status: 'running',
    }),
    conductor('c2', { label: 'tom', machine_id: 'mine', status: 'offline' }),
    conductor(
      'c3',
      { label: 'elsewhere', machine_id: 'm3', status: 'running' },
      OTHER_PROJECT,
    ),
  ],
});

it('a conductor carries id, label, machineId, status and its project', async () => {
  const client = fakeClient({
    rows: {
      bb_conductor: [
        conductor(
          'c1',
          {
            label: 'cw-framework',
            machine_id: 'cw-framework@box',
            status: 'running',
          },
          'p1',
        ),
      ],
    },
  });
  expect((await listConductors(client)).rows).toEqual([
    {
      id: 'c1',
      label: 'cw-framework',
      machineId: 'cw-framework@box',
      status: 'running',
      active: true,
      projectId: 'p1',
      ownerUserId: null,
    },
  ]);
  expect(client.collections).toEqual(['bb_conductor/bb_conductor']);
});

it('a blank label shows no id, and an unlinked project is null', async () => {
  const client = fakeClient({
    rows: {
      bb_conductor: [
        conductor('c2', { machine_id: 'box-2' }, null),
        conductor('c3', {}, null),
      ],
    },
  });
  const [noLabel, bare] = (await listConductors(client)).rows;
  expect(noLabel?.label).toBe('(unnamed)');
  expect(noLabel?.projectId).toBeNull();
  expect(noLabel?.status).toBeUndefined();
  expect(bare?.label).toBe('(unnamed)');
});

it('listConductors returns the collection AS IT IS — every project, plain labels', async () => {
  // No project filter and no `(status)` decoration here: both are the edit popup`s
  // rules, and a data service that applied them would be unusable anywhere else.
  const client = fakeClient({ rows: rows() });
  const { rows: conductors, error } = await listConductors(client);
  expect(conductors.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  expect(conductors.map((c) => c.label)).toEqual([
    'cw-framework',
    'tom',
    'elsewhere',
  ]);
  // A successful read carries no error (BB-257 D4).
  expect(error).toBeUndefined();
});

it('listConductorsPreferringWrite reads the write client first, the read client as fallback', async () => {
  const write = fakeClient({ rows: rows() });
  const read = fakeClient({ rows: rows() });
  expect((await listConductorsPreferringWrite({ write, read })).length).toBe(3);
  expect(write.collections).toEqual(['bb_conductor/bb_conductor']);
  expect(read.collections).toEqual([]);

  const failing = fakeClient({
    rows: rows(),
    failingCollections: ['bb_conductor'],
  });
  const fallback = fakeClient({ rows: rows() });
  expect(
    (await listConductorsPreferringWrite({ write: failing, read: fallback }))
      .length,
  ).toBe(3);
  expect(fallback.collections).toEqual(['bb_conductor/bb_conductor']);
});

it('AC-7: a failing conductor list yields `[]` in BOTH read strategies', async () => {
  const failing = fakeClient({
    rows: rows(),
    failingCollections: ['bb_conductor'],
  });
  expect((await listConductors(failing)).rows).toEqual([]);
  expect(
    await listConductorsPreferringWrite({ write: failing, read: failing }),
  ).toEqual([]);
});

// ---- BB-257 D4: a failure is SAYABLE, not merely empty ---------------------
//
// The other half of the producer gap phase 2 left open (see the same case in
// `users.test.ts`): `CreateOptionErrors.conductors` existed and the renderer
// could show it, but nothing ever produced one.

it('D4: a failing conductor read yields the REASON, not just an empty list', async () => {
  const failing = fakeClient({
    rows: rows(),
    failingCollections: ['bb_conductor'],
  });
  const outcome = await listConductors(failing);
  expect(outcome.rows).toEqual([]);
  expect(outcome.error).toBe('no bb_conductor/bb_conductor');
});

// BB-232 — the Conductors screen needs more of the record than the edit popup
// ever did: where the conductor runs, whether it is still alive, and the process
// identity that makes it stoppable.
//
// BB-353 — capacity (current_load / max_parallel) lives on bb_machine, not
// on the conductor. listConductorRowPage sideloads `machine` and maps from there.

const MACHINE = 'mmmmmmmm-0000-0000-0000-000000000001';

const cockpitConductor = (
  attrs: Record<string, unknown> = {},
  machineId: string | null = MACHINE,
) => ({
  id: 'c1',
  type: 'bb_conductor--bb_conductor',
  attributes: {
    label: 'cw-framework',
    conductor_id: 'cw-framework',
    status: 'online',
    workspace_root: '/home/dev/bakers/.bakers',
    last_seen: 1_000_000,
    lease_expires_at: 1_000_300,
    last_pid: 4242,
    conductor_name: 'conductor',
    // NO host_key here (BB-450 B7): bb_conductor carries no such field in
    // reality — filter[host_key] against it is a server-side 400. Writing one
    // on this fixture would hide the exact defect B7 named: a test that could
    // not tell a correct read from the broken one.
    ...attrs,
  },
  relationships: {
    project_id: { data: { id: PROJECT } },
    ...(machineId
      ? { machine: { data: { id: machineId, type: 'bb_machine' } } }
      : {}),
  },
});

const cockpitMachine = (attrs: Record<string, unknown> = {}) => ({
  id: MACHINE,
  type: 'bb_machine--bb_machine',
  attributes: {
    name: 'cw-laptop',
    host_key: 'cw-dev-box',
    current_load: 2,
    max_parallel: 5,
    ...attrs,
  },
});

/** Document listConductorRowPage receives via client.get (+ include=machine). */
const cockpitDoc = (
  conductorAttrs: Record<string, unknown> = {},
  machineAttrs: Record<string, unknown> | null = {},
) => ({
  data: [
    cockpitConductor(conductorAttrs, machineAttrs === null ? null : MACHINE),
  ],
  included: machineAttrs === null ? [] : [cockpitMachine(machineAttrs)],
});

const rowCtx = {
  now: 1_000_010,
  exists: () => true,
  thisHostKey: 'cw-dev-box',
};

it('carries the fields the cockpit renders, with capacity from the machine', async () => {
  const client = fakeClient({
    documents: {
      'bb_conductor/bb_conductor': cockpitDoc(),
    },
  });
  const [c] = (await listConductorRowPage(client, rowCtx, {})).rows;

  expect(c?.workspaceRoot).toBe('/home/dev/bakers/.bakers');
  expect(c?.lastSeen).toBe(1_000_000);
  expect(c?.leaseExpiresAt).toBe(1_000_300);
  expect(c?.lastPid).toBe(4242);
  expect(c?.conductorName).toBe('conductor');
  // BB-450 AC-4: the host_key a stop compares against this machine's own.
  expect(c?.hostKey).toBe('cw-dev-box');
  // AC-5: the machine's label, for the MACHINE column.
  expect(c?.machineLabel).toBe('cw-laptop');
  // Spec D5/D10: utilization from conductor.machine, not conductor attrs.
  expect(c?.currentLoad).toBe(2);
  expect(c?.maxParallel).toBe(5);
  expect(client.gets).toEqual(['bb_conductor/bb_conductor']);
  expect(queryStringOf(client.requests[0]?.params)).toContain(
    'include=machine',
  );
});

it('BB-450 D13: filters to a project when the project-scoped tab passes one', async () => {
  const client = fakeClient({
    documents: {
      'bb_conductor/bb_conductor': cockpitDoc(),
    },
  });
  await listConductorRowPage(client, rowCtx, { projectId: 'p-bakers' });

  const query = queryStringOf(client.requests[0]?.params);
  expect(query).toContain('include=machine');
  expect(query).toContain('project_id.id');
  expect(query).toContain('p-bakers');
});

it('BB-450 D13: reads every conductor when no project is given (the root-level tab)', async () => {
  const client = fakeClient({
    documents: {
      'bb_conductor/bb_conductor': cockpitDoc(),
    },
  });
  await listConductorRowPage(client, rowCtx, {});

  expect(queryStringOf(client.requests[0]?.params)).not.toContain(
    'project_id.id',
  );
});

it('maps capacity from the sideloaded machine even when conductor still has legacy attrs', async () => {
  // Machine wins: removed conductor capacity must not shadow host budget.
  const client = fakeClient({
    documents: {
      'bb_conductor/bb_conductor': cockpitDoc(
        { current_load: 99, max_parallel: 99, reported_load: 1 },
        { current_load: 3, max_parallel: 8 },
      ),
    },
  });
  const [c] = (await listConductorRowPage(client, rowCtx, {})).rows;
  expect(c?.currentLoad).toBe(3);
  expect(c?.maxParallel).toBe(8);
});

it('falls back to process telemetry / legacy conductor capacity when machine is absent', async () => {
  const client = fakeClient({
    documents: {
      'bb_conductor/bb_conductor': cockpitDoc(
        { reported_load: 1, max_parallel: 4 },
        null,
      ),
    },
  });
  const [c] = (await listConductorRowPage(client, rowCtx, {})).rows;
  expect(c?.currentLoad).toBe(1);
  expect(c?.maxParallel).toBe(4);
});

it('derives liveness through the shared deriver', async () => {
  const client = fakeClient({
    documents: { 'bb_conductor/bb_conductor': cockpitDoc() },
  });
  const [fresh] = (await listConductorRowPage(client, rowCtx, {})).rows;
  expect(fresh?.derivedStatus).toBe('online');

  const [old] = (
    await listConductorRowPage(
      client,
      { now: 1_900_000, exists: () => true, thisHostKey: 'cw-dev-box' },
      {},
    )
  ).rows;
  expect(old?.derivedStatus).toBe('stale');
});

it('never produces registry-only — every row came from the control plane', async () => {
  const client = fakeClient({
    documents: { 'bb_conductor/bb_conductor': cockpitDoc() },
  });
  const rowsOut = (await listConductorRowPage(client, rowCtx, {})).rows;

  for (const r of rowsOut) {
    expect(r.derivedStatus).not.toBe('registry-only');
  }
});

it('marks a row local only when its workspace exists on this machine', async () => {
  const client = fakeClient({
    documents: { 'bb_conductor/bb_conductor': cockpitDoc() },
  });
  const [here] = (
    await listConductorRowPage(
      client,
      {
        now: 1_000_010,
        exists: (p: string) => p === '/home/dev/bakers/.bakers',
        thisHostKey: 'cw-dev-box',
      },
      {},
    )
  ).rows;
  expect(here?.isLocal).toBe(true);

  const [elsewhere] = (
    await listConductorRowPage(
      client,
      { now: 1_000_010, exists: () => false, thisHostKey: 'cw-dev-box' },
      {},
    )
  ).rows;
  expect(elsewhere?.isLocal).toBe(false);
});

it('marks a row `mine` only when its host_key matches THIS machine, never from a path (BB-450 B10)', async () => {
  const client = fakeClient({
    documents: {
      'bb_conductor/bb_conductor': cockpitDoc({}, { host_key: 'cw-dev-box' }),
    },
  });
  const [own] = (
    await listConductorRowPage(
      client,
      { now: 1_000_010, exists: () => true, thisHostKey: 'cw-dev-box' },
      {},
    )
  ).rows;
  expect(own?.mine).toBe(true);

  // Same workspace_root, so `isLocal` alone cannot tell them apart — a
  // DIFFERENT machine's host_key is what makes this row foreign (BB-281
  // Finding 2: two records naming one checkout under different machines).
  const [foreign] = (
    await listConductorRowPage(
      client,
      { now: 1_000_010, exists: () => true, thisHostKey: 'some-other-machine' },
      {},
    )
  ).rows;
  expect(foreign?.mine).toBe(false);
  expect(foreign?.isLocal).toBe(true);
});

it('never treats an absent host_key as `mine`, even against an empty thisHostKey', async () => {
  const client = fakeClient({
    documents: {
      'bb_conductor/bb_conductor': cockpitDoc({}, null),
    },
  });
  const [c] = (
    await listConductorRowPage(
      client,
      { now: 1_000_010, exists: () => true, thisHostKey: '' },
      {},
    )
  ).rows;
  expect(c?.hostKey).toBeUndefined();
  expect(c?.mine).toBe(false);
});

it('reads a row written before the process fields existed', async () => {
  const client = fakeClient({
    documents: {
      'bb_conductor/bb_conductor': {
        data: [
          {
            id: 'c9',
            type: 'bb_conductor--bb_conductor',
            attributes: {
              label: 'old',
              machine_id: 'm9',
              status: 'online',
            },
          },
        ],
        included: [],
      },
    },
  });

  const [c] = (
    await listConductorRowPage(
      client,
      { now: 1_000_010, exists: () => false, thisHostKey: 'cw-dev-box' },
      {},
    )
  ).rows;

  expect(c?.lastPid).toBeUndefined();
  expect(c?.conductorName).toBeUndefined();
  expect(c?.hostKey).toBeUndefined();
  expect(c?.workspaceRoot).toBe('');
  // No workspace_root cannot be local, whatever the filesystem says.
  expect(c?.isLocal).toBe(false);
  // No hostKey on record ⇒ never `mine`, whatever thisHostKey happens to be.
  expect(c?.mine).toBe(false);
  expect(c?.currentLoad).toBe(0);
  expect(c?.maxParallel).toBe(0);
});

it('rejects on a failed cockpit read — the screen layer is what swallows it', async () => {
  const client = fakeClient({
    failingPaths: ['bb_conductor/bb_conductor'],
  });
  await expect(listConductorRowPage(client, rowCtx, {})).rejects.toThrow();
});

// ---------------------------------------------------------------------------
// BB-345 AC 1/2 — the conductors list is a CONFIGURATION of the one table.
//
// `Entity/conductor/Component/conductor-list/` is deleted with this ticket, and
// the claims it carried that are the CONDUCTOR list's own move here, beside the
// configuration that now makes them true: which columns it has, what each one
// shows, how the two elided columns are shortened, and that every row is keyed
// on the conductor's uuid. The claims that belong to the RENDERER — that a
// highlight is stated on every row, selected or not — are not repeated: they are
// `listTableTree`'s, pinned once in `tests/Screen/list-table.test.ts`, and
// restating them per entity is the duplication this ticket exists to remove.
// The open log is neither: it is not a row of this list, so it is the SCREEN's
// and is asserted in `tests/Entity/conductor/Screen/conductors.test.ts`.
// ---------------------------------------------------------------------------

const CONDUCTOR_ROW: ConductorRow = {
  id: 'c-1',
  label: 'cw-framework',
  machineId: 'cw-framework',
  status: 'online',
  projectId: 'p-1',
  workspaceRoot: '/home/dev/bakers/.bakers',
  lastSeen: 1_000_000,
  leaseExpiresAt: 1_000_300,
  currentLoad: 0,
  maxParallel: 5,
  lastPid: 4242,
  conductorName: 'conductor',
  hostKey: 'cw-dev-box',
  machineLabel: 'cw-laptop',
  derivedStatus: 'online',
  isLocal: true,
  mine: true,
};

const CTX: ConductorListContext = {
  nowSeconds: 1_000_004,
  busyIds: new Set<string>(),
  projectNames: new Map([['p-1', 'bakers']]),
};

const conductorTree = (
  rowsIn: ConductorRow[],
  over: Partial<ConductorListContext> = {},
): VNode =>
  listTableTree(
    CONDUCTOR_TABLE,
    rowsIn,
    { ...CTX, ...over },
    { selectedIndex: -1 },
  );

/** The cells of one conductor's row, joined the way the columns are drawn. */
const conductorRowText = (
  rowsIn: ConductorRow[],
  over: Partial<ConductorListContext> = {},
  id = 'c-1',
): string => {
  const node = nodeById(conductorTree(rowsIn, over), `conductor-row-${id}`);
  if (!node) throw new Error(`no row for ${id}`);
  return cellValues(node).join(' ');
};

it('labels all NINE conductor columns in a header row (BB-345 D6, BB-450 AC-7)', () => {
  // The case a header earns its keep in most, and the operator's reason for
  // giving every list one: nine unlabelled columns of ids, paths and numbers
  // are not self-describing the way the projects list's three were.
  expect(cellValues(conductorTree([])).slice(0, 9)).toEqual([
    'NAME',
    ' MACHINE',
    ' PROJECT',
    ' STATUS',
    ' AGE',
    ' WORKSPACE',
    ' PID',
    ' MARKS',
    ' LOAD',
  ]);
});

it('BB-450 D13: the project-scoped table drops PROJECT and keeps the other eight columns, unchanged', () => {
  expect(PROJECT_CONDUCTOR_TABLE.columns.map((c) => c.key)).toEqual([
    'name',
    'machine',
    'status',
    'age',
    'workspace',
    'pid',
    'marks',
    'load',
  ]);
  // Same objects, not a re-declaration that could drift from CONDUCTOR_TABLE.
  const kept = CONDUCTOR_TABLE.columns.filter((c) => c.key !== 'project');
  expect(PROJECT_CONDUCTOR_TABLE.columns).toEqual(kept);
});

it('says so plainly when there is nothing to show', () => {
  const empty = conductorTree([]);
  expect(cellValues(empty)).toContain('No conductors on this control plane.');
  expect(idsOf(empty)).toContain('conductor-empty');
});

it('renders the columns an operator needs', () => {
  const line = conductorRowText([CONDUCTOR_ROW]);

  expect(line).toContain('cw-framework');
  expect(line).toContain('bakers');
  expect(line).toContain('online');
  expect(line).toContain('just now');
  expect(line).toContain('4242');
  // BB-450 AC-7: currentLoad/maxParallel reach the row (BB-353) but were
  // never rendered until this column existed.
  expect(line).toContain('0/5');
});

it('draws the inactive marker whole in the STATUS cell', () => {
  // `offline!` is the longest producible value (8) and the column's budget is
  // 9, so the marker this change exists to add is not clipped away — unlike
  // the wordy `(inactive)` suffix, which would have needed a wider column and
  // disturbed the whole list's exact-width layout (list-table-layout.test.ts).
  const node = nodeById(
    conductorTree([
      { ...CONDUCTOR_ROW, active: false, derivedStatus: 'offline' },
    ]),
    'conductor-row-c-1',
  );
  if (!node) throw new Error('no row for c-1');
  const statusCell = cellValues(node)[3];
  expect(statusCell).toContain('offline!');
});

it("marks a conductor that is not this machine's own (BB-450 B10)", () => {
  expect(conductorRowText([{ ...CONDUCTOR_ROW, mine: false }])).toContain(
    'elsewhere',
  );
  expect(conductorRowText([CONDUCTOR_ROW])).not.toContain('elsewhere');
});

it('marks a conductor that is `mine` but not `isLocal` — an identity check, not a path one', () => {
  // The exact BB-281 Finding 2 shape: a foreign machine's record can name a
  // workspace_root that happens to exist on THIS disk too. `isLocal` alone
  // would miss it; MARKS must key on `mine`.
  expect(
    conductorRowText([{ ...CONDUCTOR_ROW, isLocal: true, mine: false }]),
  ).toContain('elsewhere');
});

it('elides a long workspace path on the LEFT, keeping the telling end', () => {
  const line = conductorRowText([
    {
      ...CONDUCTOR_ROW,
      workspaceRoot:
        '/home/dev/projects/very/deeply/nested/checkout/of/a/repo/.bakers',
    },
  ]);

  // The tail identifies the checkout; the head is the same for every row.
  expect(line).toContain('repo/.bakers');
  expect(line).toContain('…');
  expect(line).not.toContain('/home/dev/projects/very');
});

it('shows an action in flight, so a second keypress is visibly redundant', () => {
  const busy = conductorRowText([CONDUCTOR_ROW], {
    busyIds: new Set(['c-1']),
  });

  expect(busy).toContain('…');
  expect(busy).not.toBe(conductorRowText([CONDUCTOR_ROW]));
});

it('renders a conductor that never reported a pid without inventing one', () => {
  const line = conductorRowText([{ ...CONDUCTOR_ROW, lastPid: undefined }]);

  expect(line).not.toContain('undefined');
  expect(line).toContain('-');
});

// BB-232 review finding F4: two rows can share a project AND a
// workspace_root; the MACHINE column tells them apart, by the machine's label.
it('renders the machine label as its own column, beside the label', () => {
  const tree = conductorTree([
    { ...CONDUCTOR_ROW, label: 'framework', machineLabel: 'cw-laptop' },
  ]);

  expect(
    cellValues(nodeById(tree, 'conductor-cell-c-1-name') as VNode),
  ).toEqual(['framework']);
  expect(
    cellValues(nodeById(tree, 'conductor-cell-c-1-machine') as VNode),
    // BB-345 — the leading blank is the column SEPARATOR, which is a column of
    // this cell now rather than the row's Yoga gap, so that a selected row's
    // highlight can paint it. MACHINE is the second column, so it carries one.
  ).toEqual([' cw-laptop']);
});

it('separates two rows that agree on everything but their machine', () => {
  const rowsIn = [
    { ...CONDUCTOR_ROW, id: 'c-1', machineLabel: 'cw-laptop' },
    { ...CONDUCTOR_ROW, id: 'c-2', machineLabel: 'cw-server' },
  ];

  expect(conductorRowText(rowsIn, {}, 'c-1')).toContain('cw-laptop');
  expect(conductorRowText(rowsIn, {}, 'c-2')).toContain('cw-server');
});

it('never shows the registration key, whose head is the machine UUID', () => {
  const line = conductorRowText([
    {
      ...CONDUCTOR_ROW,
      machineId: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30-bakers-conductor',
    },
  ]);

  expect(line).not.toContain('0b6f3c1e');
  expect(line).not.toContain('bakers-conductor');
});

it('renders a conductor whose machine is unknown without inventing one', () => {
  expect(
    conductorRowText([
      { ...CONDUCTOR_ROW, label: 'nameless', machineLabel: undefined },
    ]),
  ).not.toContain('undefined');
});

it('renders a conductor whose project cannot be resolved as blank, not undefined', () => {
  const line = conductorRowText([{ ...CONDUCTOR_ROW, projectId: null }]);
  expect(line).not.toContain('undefined');
  expect(line).not.toContain('null');
});

// R4 — the id says WHICH conductor a row is. The list re-sorts on every 5 s
// refresh (the control plane's order is not pinned), so a positional key would
// move one conductor's cells onto another conductor's node. The ids are
// `rowNodeId(table.noun, row.id)`'s now, so the screen cannot publish one
// spelling as the click target and key its rows under another (BB-345 D2).
it('keys each row on the conductor, not on its position', () => {
  const ids = idsOf(
    conductorTree([
      { ...CONDUCTOR_ROW, id: 'zeta' },
      { ...CONDUCTOR_ROW, id: 'alpha' },
    ]),
  );

  expect(ids.filter((id) => id.startsWith('conductor-row-'))).toEqual([
    'conductor-row-zeta',
    'conductor-row-alpha',
  ]);
  expect(ids).toContain('conductor-cell-alpha-status');
});

describe('toConductor owner (BB-460 D8)', () => {
  it('carries owner_user_id, and null when the record has none', async () => {
    const client = fakeClient({
      rows: {
        bb_conductor: [
          conductor(
            'c1',
            { label: 'mine', conductor_id: 'cw-fw-bakers' },
            PROJECT,
            'user-cw',
          ),
          conductor(
            'c2',
            { label: 'ownerless', conductor_id: 'x-y-z' },
            PROJECT,
            null,
          ),
        ],
      },
    });
    const outcome = await listConductors(client);
    expect(outcome.rows.map((r) => r.ownerUserId)).toEqual(['user-cw', null]);
  });
});

const PAGE_CTX = { now: 1_000_000, exists: () => false, thisHostKey: 'host-a' };

const queryOf = (params: unknown): string =>
  decodeURIComponent((params as { getQueryString(): string }).getQueryString());

describe('listConductorRowPage (BB-460 D3/D6/D7)', () => {
  it('sends owner, sort, include and the page window in ONE query', async () => {
    const seen: unknown[] = [];
    const client = {
      get: async (_path: string, params: unknown) => {
        seen.push(params);
        return {
          data: [],
          links: { next: 'http://next' },
          meta: { count: 42 },
        };
      },
      collection: async () => ({ data: [] }),
    };
    const page = await listConductorRowPage(
      client as never,
      PAGE_CTX,
      { ownerUserId: 'user-cw', projectId: 'p1' },
      1,
    );
    const q = queryOf(seen[0]);
    expect(q).toContain('filter[owner_user_id.id]=user-cw');
    expect(q).toContain('filter[project_id.id]=p1');
    expect(q).toContain('sort=-last_seen,-drupal_internal__id');
    expect(q).toContain('page[limit]=20');
    expect(q).toContain('page[offset]=20');
    expect(page.total).toBe(42);
    expect(page.hasNext).toBe(true);
    expect(page.window).toEqual({ offset: 20, limit: 20 });
  });

  it('omits the owner filter when no owner is given', async () => {
    const seen: unknown[] = [];
    const client = {
      get: async (_p: string, params: unknown) => {
        seen.push(params);
        return { data: [] };
      },
      collection: async () => ({ data: [] }),
    };
    await listConductorRowPage(client as never, PAGE_CTX, {}, 0);
    expect(queryOf(seen[0])).not.toContain('owner_user_id');
  });

  it('a second page exists rather than the read stopping (AC-12)', async () => {
    const row = (id: string) => ({
      type: 'bb_conductor--bb_conductor',
      id,
      attributes: { label: id },
      relationships: {},
    });
    const client = {
      get: async (_p: string, params: unknown) => {
        const q = queryOf(params);
        return q.includes('page[offset]=20')
          ? { data: [row('c21')], meta: { count: 21 } }
          : {
              data: Array.from({ length: 20 }, (_v, i) => row(`c${i + 1}`)),
              links: { next: 'http://next' },
              meta: { count: 21 },
            };
      },
      collection: async () => ({ data: [] }),
    };
    const first = await listConductorRowPage(client as never, PAGE_CTX, {}, 0);
    expect(first.rows).toHaveLength(20);
    expect(first.hasNext).toBe(true);
    const second = await listConductorRowPage(client as never, PAGE_CTX, {}, 1);
    expect(second.rows.map((r) => r.id)).toEqual(['c21']);
  });
});

describe('countConductors (BB-460 D4)', () => {
  it('asks for one row and returns the reported total', async () => {
    const seen: unknown[] = [];
    const client = {
      get: async (_p: string, params: unknown) => {
        seen.push(params);
        return { data: [], meta: { count: 55 } };
      },
      collection: async () => ({ data: [] }),
    };
    expect(await countConductors(client as never, {})).toBe(55);
    expect(queryOf(seen[0])).toContain('page[limit]=1');
  });

  it('a plane that reports no count answers null, never a guess (R1)', async () => {
    const client = {
      get: async () => ({ data: [] }),
      collection: async () => ({ data: [] }),
    };
    expect(await countConductors(client as never, {})).toBeNull();
  });

  it('a failed probe is null, not a throw (D4)', async () => {
    const client = {
      get: async () => {
        throw new Error('boom');
      },
      collection: async () => ({ data: [] }),
    };
    expect(await countConductors(client as never, {})).toBeNull();
  });
});
