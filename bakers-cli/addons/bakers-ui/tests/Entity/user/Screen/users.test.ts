import { expect, it, vi } from 'vitest';
import { UsersScreen } from '../../../../src/Entity/user/Screen/users.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import type { DropshClient } from '../../../../src/types.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

it('opens the selected member inside the current workspace', async () => {
  const membershipCollection = {
    where: vi.fn(),
    first: vi.fn(async () => ({
      attr: (key: string) => (key === 'drupal_internal__id' ? 7 : undefined),
    })),
  };
  membershipCollection.where.mockReturnValue(membershipCollection);
  const client = {
    get: vi.fn(async (path: string) => {
      if (path === 'og_membership/default')
        return {
          data: [{ relationships: { uid: { data: { id: 'u-ada' } } } }],
        };
      if (path === 'user/user')
        return {
          data: [
            {
              id: 'u-ada',
              attributes: {
                display_name: 'Ada',
                drupal_internal__uid: 4,
              },
            },
          ],
        };
      throw new Error(`unexpected read: ${path}`);
    }),
    collection: vi.fn(() => membershipCollection),
  } as unknown as DropshClient;
  const navigated: { routeId: string; params: Record<string, string> }[] = [];
  const context: ScreenContext = {
    sessionGeneration: 1,
    services: {
      client,
      isWorkspaceAdmin: true,
      workspaceId: 'workspace-1',
    },
    requestDraw: () => {},
    isActive: () => true,
    nowSeconds: () => 1_700_000_000,
    navigate: (routeId, params) =>
      navigated.push({ routeId, params: params ?? {} }),
  };
  const screen = new UsersScreen();
  screen.enter(context);
  await tick();

  expect(screen.handleInput('enter', context)).toBe(true);
  expect(navigated).toEqual([
    {
      routeId: 'workspace.member.overview',
      params: {
        workspaceId: 'workspace-1',
        userId: 'u-ada',
        userName: 'Ada',
      },
    },
  ]);
});
