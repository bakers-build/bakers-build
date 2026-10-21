import type { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { describe, expect, it, vi } from 'vitest';
import { loadTeamWorkload } from '../../../../src/Entity/team/Data/workload.js';
import type { DropshClient } from '../../../../src/types.js';

const team = {
  data: [
    {
      id: 'team-1',
      attributes: { name: 'Platform', drupal_internal__id: 7 },
      relationships: { workspace_id: { data: { id: 'workspace-1' } } },
    },
  ],
  included: [{ id: 'workspace-1', attributes: { name: 'keytec' } }],
};

const memberships = {
  data: [
    {
      id: 'membership-1',
      attributes: { entity_id: '7' },
      relationships: { uid: { data: { id: 'user-1' } } },
    },
    {
      id: 'membership-2',
      attributes: { entity_id: '7' },
      relationships: { uid: { data: { id: 'user-2' } } },
    },
  ],
};

const ticket = (id: string, assigneeId: string | null, status: string) => ({
  id,
  attributes: {
    identifier: id.toUpperCase(),
    title: id,
    closed: false,
    derived_status: status,
  },
  relationships: {
    labels: { data: [] },
    assignee_user_id: { data: assigneeId ? { id: assigneeId } : null },
  },
});

describe('loadTeamWorkload', () => {
  it('walks linked projects and tickets, retains zero members, and excludes unassigned work', async () => {
    const calls: Array<{ path: string; query: string }> = [];
    let projectPage = 0;
    const get = vi.fn(async (path: string, params?: unknown) => {
      const query = decodeURIComponent(
        (params as DrupalJsonApiParams | undefined)?.getQueryString() ?? '',
      );
      calls.push({ path, query });
      if (path === 'bb_team/bb_team') return team;
      if (path === 'og_membership/default') return memberships;
      if (path === 'bb_project/bb_project') {
        projectPage++;
        return projectPage === 1
          ? { data: [{ id: 'project-1' }], links: { next: 'page-2' } }
          : { data: [{ id: 'project-2' }] };
      }
      if (query.includes('project-1')) {
        return {
          data: [
            ticket('running', 'user-1', 'running'),
            ticket('unassigned', null, 'idle'),
            ticket('outsider', 'user-3', 'running'),
          ],
        };
      }
      return { data: [ticket('waiting', 'user-1', 'queued')] };
    });
    const client = { get, collection: vi.fn() } as unknown as DropshClient;

    const result = await loadTeamWorkload(client, 'team-1');

    expect(result.team).toEqual({
      id: 'team-1',
      name: 'Platform',
      workspace: 'keytec',
      memberCount: 2,
      projectCount: 2,
    });
    expect(result.members).toEqual([
      { userId: 'user-1', open: 2, running: 1, waiting: 1 },
      { userId: 'user-2', open: 0, running: 0, waiting: 0 },
    ]);
    expect(result.total).toEqual({ open: 2, running: 1, waiting: 1 });
    expect(
      calls.find(({ path }) => path === 'bb_project/bb_project')?.query,
    ).toContain('filter[teams.id]=team-1');
    expect(
      calls.filter(({ path }) => path === 'bb_project/bb_project'),
    ).toHaveLength(2);
  });

  it('rejects incomplete linked-project paging instead of returning partial totals', async () => {
    let projectPage = 0;
    const get = vi.fn(async (path: string) => {
      if (path === 'bb_team/bb_team') return team;
      if (path === 'og_membership/default') return memberships;
      if (path === 'bb_project/bb_project') {
        projectPage++;
        if (projectPage === 1)
          return { data: [{ id: 'project-1' }], links: { next: 'x' } };
        throw new Error('project page refused');
      }
      return { data: [] };
    });
    const client = { get, collection: vi.fn() } as unknown as DropshClient;

    await expect(loadTeamWorkload(client, 'team-1')).rejects.toThrow(
      'project page refused',
    );
  });

  it('rejects linked projects withheld by the control plane', async () => {
    const get = vi.fn(async (path: string) => {
      if (path === 'bb_team/bb_team') return team;
      if (path === 'og_membership/default') return memberships;
      if (path === 'bb_project/bb_project') {
        return { data: [], meta: { omitted: { detail: 'access denied' } } };
      }
      return { data: [] };
    });
    const client = { get, collection: vi.fn() } as unknown as DropshClient;

    await expect(loadTeamWorkload(client, 'team-1')).rejects.toThrow(
      'withheld',
    );
  });

  it('rejects project tickets withheld by the control plane', async () => {
    const get = vi.fn(async (path: string) => {
      if (path === 'bb_team/bb_team') return team;
      if (path === 'og_membership/default') return memberships;
      if (path === 'bb_project/bb_project') {
        return { data: [{ id: 'project-1' }] };
      }
      return { data: [], meta: { omitted: { detail: 'access denied' } } };
    });
    const client = { get, collection: vi.fn() } as unknown as DropshClient;

    await expect(loadTeamWorkload(client, 'team-1')).rejects.toThrow(
      'withheld',
    );
  });
});
