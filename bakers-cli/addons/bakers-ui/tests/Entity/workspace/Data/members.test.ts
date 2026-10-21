import type { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { expect, it, vi } from 'vitest';
import {
  loadWorkspaceMemberships,
  WORKSPACE_LEAD_ROLE,
} from '../../../../src/Entity/workspace/Data/members.js';
import type { DropshClient } from '../../../../src/types.js';

it('loads all active workspace members and identifies only the lead rank', async () => {
  const collection = {
    where: vi.fn(),
    first: vi.fn(async () => ({
      attr: (key: string) => (key === 'drupal_internal__id' ? 7 : undefined),
    })),
  };
  collection.where.mockReturnValue(collection);
  let page = 0;
  const client = {
    collection: vi.fn(() => collection),
    get: vi.fn(async () => {
      page++;
      return page === 1
        ? {
            data: [
              {
                relationships: {
                  uid: { data: { id: 'lead' } },
                  roles: {
                    data: [
                      {
                        id: 'role-uuid',
                        meta: {
                          drupal_internal__target_id: WORKSPACE_LEAD_ROLE,
                        },
                      },
                    ],
                  },
                },
              },
            ],
            links: { next: 'page-2' },
          }
        : {
            data: [
              {
                relationships: {
                  uid: { data: { id: 'member' } },
                  roles: { data: [] },
                },
              },
            ],
          };
    }),
  } as unknown as DropshClient;

  const result = await loadWorkspaceMemberships(client, 'workspace-1');
  expect(result.memberIds).toEqual(['lead', 'member']);
  expect([...result.leadIds]).toEqual(['lead']);
  expect(client.get).toHaveBeenCalledTimes(2);
  for (const [, params] of (client.get as ReturnType<typeof vi.fn>).mock
    .calls) {
    const query = decodeURIComponent(
      (params as DrupalJsonApiParams).getQueryString(),
    );
    expect(query).toContain('sort=drupal_internal__id');
  }
});

it('fails rather than treating withheld memberships as a non-admin roster', async () => {
  const collection = {
    where: vi.fn(),
    first: vi.fn(async () => ({ attr: () => 7 })),
  };
  collection.where.mockReturnValue(collection);
  const client = {
    collection: vi.fn(() => collection),
    get: vi.fn(async () => ({ data: [], meta: { omitted: {} } })),
  } as unknown as DropshClient;
  await expect(loadWorkspaceMemberships(client, 'workspace-1')).rejects.toThrow(
    'withheld',
  );
});
