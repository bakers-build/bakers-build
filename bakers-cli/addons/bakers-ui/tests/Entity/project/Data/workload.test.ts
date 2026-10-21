import type { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { describe, expect, it, vi } from 'vitest';
import { loadProjectWorkload } from '../../../../src/Entity/project/Data/workload.js';
import type { DropshClient } from '../../../../src/types.js';

const projectDocument = {
  data: [
    {
      id: 'project-1',
      attributes: {
        name: 'bakers.build Platform',
        key: 'bakers.build',
        repository: { url: 'https://gitlab.example.com/bakers/bakers' },
      },
      relationships: {
        group_id: { data: { id: 'group-1' } },
        teams: { data: [{ id: 'team-1' }, { id: 'team-2' }] },
      },
    },
  ],
  included: [
    { id: 'group-1', attributes: { name: 'Product' } },
    { id: 'team-1', attributes: { name: 'Platform' } },
    { id: 'team-2', attributes: { name: 'Delivery' } },
  ],
};

const ticket = (
  id: string,
  derivedStatus: string,
  assigneeId: string | null,
) => ({
  id,
  attributes: {
    identifier: id.toUpperCase(),
    title: `Title ${id}`,
    derived_status: derivedStatus,
    closed: false,
  },
  relationships: {
    labels: { data: [] },
    assignee_user_id: {
      data: assigneeId ? { id: assigneeId } : null,
    },
  },
});

describe('loadProjectWorkload', () => {
  it('loads complete project-scoped pages and derives context plus all buckets', async () => {
    const queries: string[] = [];
    const get = vi.fn(async (path: string, params?: unknown) => {
      const query = decodeURIComponent(
        (params as DrupalJsonApiParams | undefined)?.getQueryString() ?? '',
      );
      queries.push(`${path}?${query}`);
      if (path === 'bb_project/bb_project') return projectDocument;
      if (!query.includes('page[offset]')) {
        return {
          data: [ticket('ticket-1', 'running', null)],
          links: { next: 'page-2' },
        };
      }
      return { data: [ticket('ticket-2', 'queued', 'user-1')] };
    });
    const client = { get, collection: vi.fn() } as unknown as DropshClient;

    const result = await loadProjectWorkload(client, 'project-1');

    expect(queries[0]).toContain('filter[id]=project-1');
    expect(queries.slice(1)).toHaveLength(2);
    expect(queries[1]).toContain('filter[project_id.id]=project-1');
    expect(queries[2]).toContain('page[offset]=20');
    expect(result.project).toEqual({
      id: 'project-1',
      name: 'bakers.build Platform',
      key: 'bakers.build',
      group: 'Product',
      teams: ['Platform', 'Delivery'],
      repository: 'https://gitlab.example.com/bakers/bakers',
    });
    expect(result.workload.open.map(({ id }) => id)).toEqual([
      'ticket-1',
      'ticket-2',
    ]);
    expect(result.workload.running.map(({ id }) => id)).toEqual(['ticket-1']);
    expect(result.workload.waiting.map(({ id }) => id)).toEqual(['ticket-2']);
    expect(result.workload.unassigned.map(({ id }) => id)).toEqual([
      'ticket-1',
    ]);
  });

  it('omits unavailable optional context instead of inventing placeholders', async () => {
    const get = vi.fn(async (path: string) =>
      path === 'bb_project/bb_project'
        ? { data: [{ id: 'project-1', attributes: { name: 'Bare' } }] }
        : { data: [] },
    );
    const client = { get, collection: vi.fn() } as unknown as DropshClient;

    const result = await loadProjectWorkload(client, 'project-1');

    expect(result.project).toEqual({
      id: 'project-1',
      name: 'Bare',
      teams: [],
    });
  });

  it('rejects when a later page fails instead of returning partial totals', async () => {
    let ticketPage = 0;
    const get = vi.fn(async (path: string) => {
      if (path === 'bb_project/bb_project') return projectDocument;
      ticketPage++;
      if (ticketPage === 1)
        return {
          data: [ticket('ticket-1', 'running', 'u1')],
          links: { next: 'x' },
        };
      throw new Error('503 page two');
    });
    const client = { get, collection: vi.fn() } as unknown as DropshClient;

    await expect(loadProjectWorkload(client, 'project-1')).rejects.toThrow(
      '503 page two',
    );
  });

  it('rejects ticket rows withheld by the control plane', async () => {
    const get = vi.fn(async (path: string) =>
      path === 'bb_project/bb_project'
        ? projectDocument
        : { data: [], meta: { omitted: { detail: 'access denied' } } },
    );
    const client = { get, collection: vi.fn() } as unknown as DropshClient;

    await expect(loadProjectWorkload(client, 'project-1')).rejects.toThrow(
      'withheld',
    );
  });

  it('rejects rows withheld on a later ticket page', async () => {
    let ticketPage = 0;
    const get = vi.fn(async (path: string) => {
      if (path === 'bb_project/bb_project') return projectDocument;
      ticketPage += 1;
      return ticketPage === 1
        ? {
            data: [ticket('ticket-1', 'running', 'u1')],
            links: { next: 'page-2' },
          }
        : { data: [], meta: { omitted: { detail: 'access denied' } } };
    });
    const client = { get, collection: vi.fn() } as unknown as DropshClient;

    await expect(loadProjectWorkload(client, 'project-1')).rejects.toThrow(
      'withheld',
    );
  });
});
