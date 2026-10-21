import type { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { expect, it, vi } from 'vitest';
import type { ScreenContext } from '../../src/Screen/screen.js';
import {
  TeamMemberStatsScreen,
  WorkspaceMemberStatsScreen,
} from '../../src/Statistics/member-stats.js';
import type { DropshClient } from '../../src/types.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function context(
  params: Record<string, string>,
  scopes: string[],
  membershipQueries: string[] = [],
) {
  const get: DropshClient['get'] = async (path, query) => {
    if (path === 'og_membership/default') {
      membershipQueries.push(
        decodeURIComponent((query as DrupalJsonApiParams).getQueryString()),
      );
      return {
        data: [{ relationships: { uid: { data: { id: params.userId } } } }],
      };
    }
    if (path === 'bakers/statistics') {
      scopes.push(
        decodeURIComponent(
          (query as { getQueryString: () => string }).getQueryString(),
        ),
      );
      return { data: { attributes: { groups: [] } } };
    }
    throw new Error(`unexpected read: ${path}`);
  };
  return {
    sessionGeneration: 1,
    services: {
      workspaceId: params.workspaceId,
      client: {
        get,
        collection: vi.fn(() => {
          const collection = {
            where: vi.fn(),
            first: vi.fn(async () => ({ attr: () => 7 })),
          };
          collection.where.mockReturnValue(collection);
          return collection;
        }),
      },
    },
    requestDraw: () => {},
    isActive: () => true,
    nowSeconds: () => 1_700_000_000,
    params,
  } as ScreenContext;
}

it('loads workspace-member Stats with the selected user id', async () => {
  const scopes: string[] = [];
  const membershipQueries: string[] = [];
  const screen = new WorkspaceMemberStatsScreen();
  screen.enter(
    context(
      { workspaceId: 'workspace-1', userId: 'user-1', userName: 'Ada' },
      scopes,
      membershipQueries,
    ),
  );
  await tick();
  expect(scopes).toEqual(['user_id=user-1']);
  expect(membershipQueries[0]).toContain('sort=drupal_internal__id');
});

it('loads team-member Stats with the parent team id', async () => {
  const scopes: string[] = [];
  const screen = new TeamMemberStatsScreen();
  screen.enter(
    context(
      {
        teamId: 'team-1',
        teamName: 'Platform',
        userId: 'user-1',
        userName: 'Ada',
      },
      scopes,
    ),
  );
  await tick();
  expect(scopes).toEqual(['team_id=team-1&user_id=user-1']);
});
