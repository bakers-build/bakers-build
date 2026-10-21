import type { JsonApiClient } from 'dropsh/plugin';
import { expect, it, vi } from 'vitest';
import {
  AmbiguousProjectNameError,
  resolveBbProjectContext,
} from '../src/bakers-project-context.js';

function api(
  projects: Array<{
    id: string;
    name: string;
    workspaceId: string;
    workspace: string;
  }>,
) {
  const resource = vi.fn(async (type: string, id: string) => {
    if (type === 'bb_group') {
      const project = projects.find((row) => `group-${row.id}` === id);
      return { id, rel: () => project?.workspaceId ?? null };
    }
    const project = projects.find((row) => row.workspaceId === id);
    return { id, attr: () => project?.workspace };
  });
  const collection = vi.fn((type: string) => {
    const filters: Array<[string, unknown]> = [];
    const query = {
      where: (key: string, _operator: string, value: unknown) => {
        filters.push([key, value]);
        return query;
      },
      page: () => query,
      list: async () => {
        if (type === 'bb_workspace')
          return [...new Map(projects.map((p) => [p.workspaceId, p])).entries()]
            .map(([id, p]) => ({ id, attr: () => p.workspace }))
            .filter((row) =>
              filters.every(
                ([key, value]) => key !== 'name' || row.attr() === value,
              ),
            );
        return projects
          .filter((p) =>
            filters.every(([key, value]) =>
              key === 'name'
                ? p.name === value
                : key !== 'group_id.workspace_id.id' || p.workspaceId === value,
            ),
          )
          .slice(0, 2)
          .map((p) => ({ id: p.id, rel: () => `group-${p.id}` }));
      },
    };
    return query;
  });
  return {
    client: { collection, resource } as unknown as JsonApiClient,
    collection,
    resource,
  };
}

it('derives the workspace when one reachable project has the committed name', async () => {
  const { client } = api([
    { id: 'p1', name: 'demo', workspaceId: 'w1', workspace: 'Engineering' },
  ]);
  await expect(
    resolveBbProjectContext(client, { project: 'demo' }),
  ).resolves.toEqual({
    projectId: 'p1',
    project: 'demo',
    workspaceId: 'w1',
    workspace: 'Engineering',
  });
});

it('refuses duplicate reachable projects with workspace-qualified candidates', async () => {
  const { client } = api([
    { id: 'p1', name: 'demo', workspaceId: 'w1', workspace: 'Engineering' },
    { id: 'p2', name: 'demo', workspaceId: 'w2', workspace: 'Sales' },
  ]);
  await expect(
    resolveBbProjectContext(client, { project: 'demo' }),
  ).rejects.toThrow(AmbiguousProjectNameError);
  await expect(
    resolveBbProjectContext(client, { project: 'demo' }),
  ).rejects.toThrow(/Engineering.*Sales.*bakers\.workspace/s);
});

it('uses an explicit workspace to narrow duplicate project names', async () => {
  const { client } = api([
    { id: 'p1', name: 'demo', workspaceId: 'w1', workspace: 'Engineering' },
    { id: 'p2', name: 'demo', workspaceId: 'w2', workspace: 'Sales' },
  ]);
  await expect(
    resolveBbProjectContext(client, { project: 'demo', workspace: 'Sales' }),
  ).resolves.toEqual({
    projectId: 'p2',
    project: 'demo',
    workspaceId: 'w2',
    workspace: 'Sales',
  });
});

it('reports missing projects with reachable workspace names', async () => {
  const { client } = api([
    { id: 'p1', name: 'other', workspaceId: 'w1', workspace: 'Engineering' },
  ]);
  await expect(
    resolveBbProjectContext(client, { project: 'demo' }),
  ).rejects.toThrow(/demo.*Engineering/s);
});
