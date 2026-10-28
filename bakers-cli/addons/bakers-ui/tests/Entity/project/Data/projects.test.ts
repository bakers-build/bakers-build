import type { VNode } from '@opentui/core';
import { expect, it } from 'vitest';
import { listTableTree } from '../../../../src/Entity/collection.js';
import {
  loadProjectRows,
  PROJECT_TABLE,
  type ProjectRow,
} from '../../../../src/Entity/project/Data/projects.js';
import { cellValues, idsOf, nodeById } from '../../../render-tree.js';
import { queryStringOf, toResource } from '../../../test-support.js';

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

/** A bb_project resource (raw JSON:API), as the project-name read lists it. */
function project(id: string, name: string) {
  return {
    type: 'bb_project--bb_project',
    id,
    attributes: { name },
  };
}

/**
 * Fake dropsh client: `get()` serves the bb_conductor `pages` in order (an
 * `Error` page throws) and records each query; `collection('bb_project')`
 * lists `projects`, narrowed by `whereIn('id', …)` and cut at the server's
 * 50-row page as one `list()` is; a read asking for `p-broken` throws.
 */
function fakeClient(
  pages: unknown[],
  projects: ReturnType<typeof project>[] = [],
) {
  const queries: string[] = [];
  return {
    queries,
    collection(type: string) {
      if (type !== 'bb_project') throw new Error(`unexpected ${type}`);
      let ids: unknown[] | undefined;
      const collection = {
        whereIn(path: string, values: unknown[]) {
          if (path === 'id') ids = values;
          return collection;
        },
        list: async () => {
          if (ids?.includes('p-broken')) throw new Error('network down');
          return projects
            .filter((p) => !ids || ids.includes(p.id))
            .slice(0, 50)
            .map(toResource);
        },
      };
      return collection;
    },
    async get(_path: string, params: unknown) {
      queries.push(queryStringOf(params));
      const page = pages[queries.length - 1];
      if (page instanceof Error) throw page;
      return page;
    },
  };
}

it('lists projects from bb_conductor, joining the project name', async () => {
  const client = fakeClient(
    [
      {
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
      },
    ],
    [project('p-bakers', 'bakers'), project('p-shop', 'shop')],
  );
  const rows = await loadProjectRows({ client, nowSeconds: () => NOW });
  const bakers = rows.find((r) => r.project === 'bakers');
  const shop = rows.find((r) => r.project === 'shop');
  expect(bakers?.derivedStatus).toBe('online');
  expect(bakers?.ageLabel).toBe('just now');
  expect(shop?.derivedStatus).toBe('offline');
});

it('stale when the conductor last_seen is old', async () => {
  const client = fakeClient(
    [
      {
        data: [
          conductor('c1', 'p1', {
            status: 'online',
            last_seen: iso(NOW - 601),
            lease_expires_at: iso(NOW + 60),
          }),
        ],
      },
    ],
    [project('p1', 'bakers')],
  );
  const rows = await loadProjectRows({ client, nowSeconds: () => NOW });
  expect(rows[0]?.derivedStatus).toBe('stale');
});

it('the liveliest conductor wins for a project with several', async () => {
  const client = fakeClient(
    [
      {
        data: [
          conductor('dead', 'p1', {
            status: 'offline',
            last_seen: iso(NOW - 10),
          }),
          conductor('live', 'p1', {
            status: 'online',
            last_seen: iso(NOW - 5),
            lease_expires_at: iso(NOW + 60),
          }),
        ],
      },
    ],
    [project('p1', 'bakers')],
  );
  const rows = await loadProjectRows({ client, nowSeconds: () => NOW });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.derivedStatus).toBe('online'); // live sibling wins over offline
  expect(rows[0]?.ageLabel).toBe('just now');
});

it('a conductor with no resolvable project is skipped', async () => {
  const client = fakeClient(
    [{ data: [conductor('c1', 'p-missing', { status: 'online' })] }],
    [], // no bb_project of that id
  );
  const rows = await loadProjectRows({ client, nowSeconds: () => NOW });
  expect(rows).toEqual([]);
});

it('no conductors → empty list', async () => {
  const client = fakeClient([{ data: [] }]);
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
  const client = fakeClient([new Error('network down')]);
  const rows = await loadProjectRows({ client, nowSeconds: () => NOW });
  expect(rows).toEqual([]);
});

it('reads every page of bb_conductor until links.next is absent', async () => {
  const client = fakeClient(
    [
      {
        data: [conductor('c1', 'p-alpha', { status: 'offline' })],
        links: { next: { href: 'next' } },
      },
      {
        data: [
          conductor('c2', 'p-alpha', {
            status: 'online',
            last_seen: iso(NOW - 5),
            lease_expires_at: iso(NOW + 60),
          }),
          conductor('c3', 'p-beta', { status: 'offline' }),
        ],
      },
    ],
    [project('p-alpha', 'alpha'), project('p-beta', 'beta')],
  );
  const rows = await loadProjectRows({ client, nowSeconds: () => NOW });
  expect(rows.map((r) => `${r.project}=${r.derivedStatus}`)).toEqual([
    'alpha=online',
    'beta=offline',
  ]);
  expect(client.queries).toHaveLength(2);
  // Offset paging needs a total order; the serial id is its unique key.
  expect(client.queries[0]).toContain('drupal_internal__id');
  expect(client.queries[1]).toContain('page[offset]=');
});

it('a failing later page degrades to an empty list, never a partial one', async () => {
  const client = fakeClient(
    [
      {
        data: [conductor('c1', 'p-alpha', { status: 'offline' })],
        links: { next: { href: 'next' } },
      },
      new Error('network down'),
    ],
    [project('p-alpha', 'alpha')],
  );
  const rows = await loadProjectRows({ client, nowSeconds: () => NOW });
  expect(rows).toEqual([]);
});

it('names a project that sits past the first page of visible bb_project rows', async () => {
  const visible = Array.from({ length: 51 }, (_, i) =>
    project(`p-${i}`, `project-${i}`),
  );
  const client = fakeClient(
    [{ data: [conductor('c1', 'p-50', { status: 'offline' })] }],
    visible,
  );
  const rows = await loadProjectRows({ client, nowSeconds: () => NOW });
  expect(rows.map((r) => r.project)).toEqual(['project-50']);
});

it('names every referenced project when they span more than one name read', async () => {
  const projects = Array.from({ length: 51 }, (_, i) =>
    project(`p-${i}`, `project-${i}`),
  );
  const client = fakeClient(
    [
      {
        data: projects.map((p, i) =>
          conductor(`c${i}`, p.id, { status: 'offline' }),
        ),
      },
    ],
    projects,
  );
  const rows = await loadProjectRows({ client, nowSeconds: () => NOW });
  expect(rows.map((r) => r.project).sort()).toEqual(
    projects.map((p) => p.attributes.name).sort(),
  );
});

it('a failing later name read degrades to an empty list, never a partial one', async () => {
  const ids = [...Array.from({ length: 20 }, (_, i) => `p-${i}`), 'p-broken'];
  const client = fakeClient(
    [
      {
        data: ids.map((id, i) => conductor(`c${i}`, id, { status: 'offline' })),
      },
    ],
    ids.map((id) => project(id, id)),
  );
  const rows = await loadProjectRows({ client, nowSeconds: () => NOW });
  expect(rows).toEqual([]);
});
