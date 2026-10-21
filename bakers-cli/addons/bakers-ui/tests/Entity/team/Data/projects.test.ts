import type { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { expect, it, vi } from 'vitest';
import { listLinkedProjectIds } from '../../../../src/Entity/team/Data/projects.js';
import type { DropshClient } from '../../../../src/types.js';

it('loads every linked-project page for the selected team', async () => {
  let page = 0;
  const get = vi.fn(async (_path: string, params?: unknown) => {
    const query = decodeURIComponent(
      (params as DrupalJsonApiParams).getQueryString(),
    );
    expect(query).toContain('filter[teams.id]=team-1');
    expect(query).toContain('sort=drupal_internal__id');
    page++;
    return page === 1
      ? { data: [{ id: 'project-1' }], links: { next: 'page-2' } }
      : { data: [{ id: 'project-2' }] };
  });
  const client = { get, collection: vi.fn() } as unknown as DropshClient;

  await expect(listLinkedProjectIds(client, 'team-1')).resolves.toEqual([
    'project-1',
    'project-2',
  ]);
  expect(get).toHaveBeenCalledTimes(2);
});

it.each([
  1, 2,
])('rejects omitted linked projects on page %i', async (omitted) => {
  let page = 0;
  const client = {
    get: vi.fn(async () => {
      page++;
      if (page === omitted) return { data: [], meta: { omitted: {} } };
      return { data: [{ id: 'project-1' }], links: { next: 'page-2' } };
    }),
    collection: vi.fn(),
  } as unknown as DropshClient;
  await expect(listLinkedProjectIds(client, 'team-1')).rejects.toThrow(
    'withheld',
  );
});
