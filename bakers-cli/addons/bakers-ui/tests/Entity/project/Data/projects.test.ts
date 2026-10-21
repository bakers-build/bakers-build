import type { VNode } from '@opentui/core';
import { expect, it } from 'vitest';
import { listTableTree } from '../../../../src/Entity/collection.js';
import {
  loadProjectRows,
  PROJECT_TABLE,
  type ProjectRow,
} from '../../../../src/Entity/project/Data/projects.js';
import { cellValues, idsOf, nodeById } from '../../../render-tree.js';

const NOW = 1_000_000; // epoch seconds

const iso = (epoch: number) => new Date(epoch * 1000).toISOString();

/** A bb_conductor collection resource (raw JSON:API `data[]` entry). */
function conductor(
  id: string,
  projectId: string,
  attrs: Record<string, unknown>,
) {
  return {
    type: 'bb_conductor--bb_conductor',
    id,
    attributes: attrs,
    relationships: { project_id: { data: { id: projectId } } },
  };
}

/** A bb_project sideload (`included[]` entry). */
function project(id: string, name: string) {
  return {
    type: 'bb_project--bb_project',
    id,
    attributes: { name },
  };
}

/** Fake dropsh client whose `get()` returns a fixed collection document. */
function fakeClient(doc: unknown) {
  return {
    collection() {
      throw new Error('loadProjectRows must not use collection()');
    },
    async get() {
      return doc;
    },
  };
}

it('lists projects from bb_conductor, joining the sideloaded project name', async () => {
  const client = fakeClient({
    data: [
      conductor('c1', 'p-bakers', {
        status: 'online',
        last_seen: iso(NOW - 10),
        lease_expires_at: iso(NOW + 60),
      }),
      conductor('c2', 'p-shop', {
        status: 'offline',
        last_seen: iso(NOW - 10),
      }),
    ],
    included: [project('p-bakers', 'bakers'), project('p-shop', 'shop')],
  });
  const rows = await loadProjectRows({ client, nowSeconds: () => NOW });
  const bakers = rows.find((r) => r.project === 'bakers');
  const shop = rows.find((r) => r.project === 'shop');
  expect(bakers?.derivedStatus).toBe('online');
  expect(bakers?.ageLabel).toBe('just now');
  expect(shop?.derivedStatus).toBe('offline');
});

it('stale when the conductor last_seen is old', async () => {
  const client = fakeClient({
    data: [
      conductor('c1', 'p1', {
        status: 'online',
        last_seen: iso(NOW - 601),
        lease_expires_at: iso(NOW + 60),
      }),
    ],
    included: [project('p1', 'bakers')],
  });
  const rows = await loadProjectRows({ client, nowSeconds: () => NOW });
  expect(rows[0]?.derivedStatus).toBe('stale');
});

it('the liveliest conductor wins for a project with several', async () => {
  const client = fakeClient({
    data: [
      conductor('dead', 'p1', { status: 'offline', last_seen: iso(NOW - 10) }),
      conductor('live', 'p1', {
        status: 'online',
        last_seen: iso(NOW - 5),
        lease_expires_at: iso(NOW + 60),
      }),
    ],
    included: [project('p1', 'bakers')],
  });
  const rows = await loadProjectRows({ client, nowSeconds: () => NOW });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.derivedStatus).toBe('online'); // live sibling wins over offline
  expect(rows[0]?.ageLabel).toBe('just now');
});

it('a conductor with no resolvable project is skipped', async () => {
  const client = fakeClient({
    data: [conductor('c1', 'p-missing', { status: 'online' })],
    included: [], // project not sideloaded
  });
  const rows = await loadProjectRows({ client, nowSeconds: () => NOW });
  expect(rows).toEqual([]);
});

it('no conductors → empty list', async () => {
  const client = fakeClient({ data: [], included: [] });
  const rows = await loadProjectRows({ client, nowSeconds: () => NOW });
  expect(rows).toEqual([]);
});

// ---------------------------------------------------------------------------
// BB-345 AC 1/2 — the projects list is a CONFIGURATION of the one table.
//
// `Entity/project/Component/project-list/` is deleted with this ticket, and the
// three claims it carried that are the PROJECT list's own move here: which
// columns it has, that every row is keyed on the project's uuid, and what it
// says when it is empty. The claims it carried that belong to the RENDERER —
// that a highlight is stated on every row, selected or not — are not repeated
// here: they are `listTableTree`'s, they are pinned once in
// `tests/Screen/list-table.test.ts`, and restating them per entity is the
// duplication this ticket exists to remove.
// ---------------------------------------------------------------------------

const ROW: ProjectRow = {
  id: 'p-1',
  project: 'bakers',
  projectName: 'bakers',
  projectSlug: 'bakers',
  derivedStatus: 'online',
  lastSeen: NOW - 180,
  ageLabel: '3m ago',
};

it('the projects list is a configuration of the one table', () => {
  const tree = listTableTree(PROJECT_TABLE, [ROW], undefined, {
    selectedIndex: 0,
  });
  expect(cellValues(tree)).toEqual([
    // The header row BB-345 D6 gives it — an operator decision: a list has a
    // header, and three unlabelled columns were readable only because there are
    // three of them.
    'PROJECT',
    // The blank leading every cell but the first is the column SEPARATOR
    // (BB-345): the row's Yoga `gap` carried no text, so no attribute could
    // paint it and the selection highlight came out in fragments. It is a
    // column of the cell now, and the painted geometry is unchanged.
    ' STATUS',
    ' AGE',
    'bakers',
    ' online',
    ' 3m ago',
  ]);
});

it('keys every project node on the project, not on its position', () => {
  // R4 — the id says WHICH project a row is, so a re-sorted list moves the
  // content with the entity rather than leaving it on the node at that position.
  // The ids are `rowNodeId(table.noun, row.id)`'s now, so the screen cannot
  // publish one spelling as the click target and key its rows under another.
  const tree = listTableTree(
    PROJECT_TABLE,
    [
      { ...ROW, id: 'zeta' },
      { ...ROW, id: 'alpha' },
    ],
    undefined,
    { selectedIndex: 0 },
  );
  expect(idsOf(tree)).toEqual([
    'project-table',
    'project-header',
    'project-header-name',
    'project-header-status',
    'project-header-age',
    'project-row-zeta',
    'project-cell-zeta-name',
    'project-cell-zeta-status',
    'project-cell-zeta-age',
    'project-row-alpha',
    'project-cell-alpha-name',
    'project-cell-alpha-status',
    'project-cell-alpha-age',
  ]);
});

it('hands a long project name to the cell whole, because PROJECT grows', () => {
  // BB-345 AC 5 — the OPERATOR'S CORRECTION to Task 5, and the reason it was
  // needed: a fixed 24-column PROJECT cut an ordinary project name at 24 even at
  // 160 columns, where the trailing AGE held ~120 columns of whitespace. That is
  // the ticket's own finding 3 reproduced on this list.
  //
  // Free-text columns GROW, and the price is stated where it is paid: a grower
  // declares no budget, so `cellText` has nothing to measure against and cannot
  // mark the cut Yoga eventually makes. The value therefore reaches the cell as
  // it was written — which is what this asserts — and the renderer's `truncate`
  // cuts it silently at whatever width the row really has. The operator took
  // that trade knowingly: an unmarked cut at an absurd length beats a marked cut
  // of every ordinary name.
  const name = 'a-really-long-project-name-well-over-24-columns';
  const tree = listTableTree(
    PROJECT_TABLE,
    [{ ...ROW, projectName: name }],
    undefined,
    {
      selectedIndex: 0,
    },
  );
  expect(cellValues(nodeById(tree, 'project-cell-p-1-name') as VNode)).toEqual([
    name,
  ]);
});

it('an empty project list renders its header and an explicit line', () => {
  const tree = listTableTree(PROJECT_TABLE, [], undefined, {
    selectedIndex: -1,
  });
  expect(cellValues(tree)).toEqual([
    'PROJECT',
    ' STATUS',
    ' AGE',
    'No projects.',
  ]);
  expect(idsOf(tree)).toContain('project-empty');
});

it('a failing conductor query degrades to an empty list, not a throw', async () => {
  const client = {
    collection() {
      throw new Error('unused');
    },
    async get() {
      throw new Error('network down');
    },
  };
  const rows = await loadProjectRows({ client, nowSeconds: () => NOW });
  expect(rows).toEqual([]);
});
