import { expect, it, vi } from 'vitest';
import { TeamMemberOverviewScreen } from '../../../../src/Entity/user/Screen/member-overview.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import type { DropshClient } from '../../../../src/types.js';
import { renderTree } from '../../../render-tree.js';

it('validates team membership even though the overview body is empty', async () => {
  const collection = {
    where: vi.fn(),
    first: vi.fn(async () => ({ attr: () => 7 })),
  };
  collection.where.mockReturnValue(collection);
  const client = {
    collection: vi.fn(() => collection),
    get: vi.fn(async () => ({ data: [] })),
  } as unknown as DropshClient;
  const context = {
    sessionGeneration: 1,
    requestDraw: vi.fn(),
    isActive: () => true,
    services: { client, workspaceId: 'workspace-1' },
    params: { teamId: 'team-1', userId: 'u1' },
    user: { id: 'u1', name: 'Ada' },
  } as ScreenContext;
  const screen = new TeamMemberOverviewScreen();

  screen.enter(context);

  await vi.waitFor(() => expect(screen.state).toBe('error'));
  expect(renderTree(screen.present(context).body)).toContain(
    'user u1 is not an active member of bb_team team-1',
  );
});
