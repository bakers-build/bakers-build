import { expect, it, vi } from 'vitest';
import { formatActionLadder } from '../../../../src/Component/footer-actions/index.js';
import { WorkspaceMemberRunsScreen } from '../../../../src/Entity/run/Screen/user-runs.js';
import { TeamMemberRunsScreen } from '../../../../src/Entity/team/Screen/team-member-work.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import type { DropshClient } from '../../../../src/types.js';
import { nodeById, renderTree } from '../../../render-tree.js';
import { routes } from '../../../tab-bars.js';

it('declares independent workspace-member and team-member run routes', () => {
  expect(WorkspaceMemberRunsScreen.route).toMatchObject({
    id: 'workspace.member.runs',
    tab: { id: 'runs', scope: 'workspace-member' },
  });
  expect(TeamMemberRunsScreen.route).toMatchObject({
    id: 'team.member.runs',
    tab: { id: 'runs', scope: 'team-member' },
  });
  expect(routes.tabLocation(TeamMemberRunsScreen.route.id, {})).toMatchObject({
    level: 'team-member',
    tab: 'runs',
  });
});

class TestWorkspaceMemberRunsScreen extends WorkspaceMemberRunsScreen {
  loadPage(context: ScreenContext) {
    return this.loadRows(context, 0);
  }
}

it('rejects withheld workspace-member run rows', async () => {
  const collection = {
    where: vi.fn(),
    sort: vi.fn(),
    page: vi.fn(),
    first: vi.fn(async () => ({ attr: () => 7 })),
    list: vi.fn(async () => []),
  };
  collection.where.mockReturnValue(collection);
  collection.sort.mockReturnValue(collection);
  collection.page.mockReturnValue(collection);
  const client = {
    collection: vi.fn(() => collection),
    get: vi.fn(async (path: string) =>
      path === 'og_membership/default'
        ? { data: [{ relationships: { uid: { data: { id: 'u1' } } } }] }
        : { data: [], meta: { omitted: true } },
    ),
  } as unknown as DropshClient;
  const context = {
    services: { client, workspaceId: 'workspace-1' },
    params: { workspaceId: 'workspace-1', userId: 'u1' },
  } as ScreenContext;

  await expect(
    new TestWorkspaceMemberRunsScreen().loadPage(context),
  ).rejects.toThrow('withheld member run rows');
});

it('publishes count/page in meta and Enter/Tab in actions — not a status ladder (BB-375)', () => {
  const screen = new WorkspaceMemberRunsScreen();
  const shown = screen.present({
    sessionGeneration: 1,
    requestDraw: () => {},
    isActive: () => true,
    params: { userId: 'u1', userName: 'cw' },
    user: { id: 'u1', name: 'cw' },
  } as ScreenContext);
  expect(shown.status).toBeUndefined();
  expect(shown.meta ?? '').toMatch(/page /);
  expect(formatActionLadder(shown.actions)).toContain('Enter ticket');
  expect(formatActionLadder(shown.actions)).toContain('Tab tabs');
  expect(
    renderTree(nodeById(shown.body, 'user-runs-filter-closed-chip')!).join(''),
  ).toBe('x closed: hidden');
});
