import { expect, it, vi } from 'vitest';
import { WorkspaceMemberOverviewScreen } from '../../../../src/Entity/user/Screen/member-overview.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import type { DropshClient } from '../../../../src/types.js';
import { renderTree } from '../../../render-tree.js';

it('validates workspace membership before showing the overview', async () => {
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
    params: { workspaceId: 'workspace-1', userId: 'u1' },
    user: { id: 'u1', name: 'Ada' },
  } as ScreenContext;
  const screen = new WorkspaceMemberOverviewScreen();

  screen.enter(context);

  await vi.waitFor(() => expect(screen.state).toBe('error'));
  expect(renderTree(screen.present(context).body)).toContain(
    'user u1 is not an active member of bb_workspace workspace-1',
  );
});

const overviewWith = (profile: Record<string, unknown>) => {
  const collection = {
    where: vi.fn(),
    first: vi.fn(async () => ({ attr: () => 7 })),
  };
  collection.where.mockReturnValue(collection);
  const client = {
    collection: vi.fn(() => collection),
    get: vi.fn(async (path: string) =>
      path === 'og_membership/default'
        ? { data: [{ relationships: { uid: { data: { id: 'u1' } } } }] }
        : { data: { id: 'u1', type: 'user--user', attributes: profile } },
    ),
  } as unknown as DropshClient;
  const context = {
    sessionGeneration: 1,
    requestDraw: vi.fn(),
    isActive: () => true,
    services: { client, workspaceId: 'workspace-1' },
    params: { workspaceId: 'workspace-1', userId: 'u1' },
    user: { id: 'u1', name: 'Ada' },
  } as ScreenContext;
  const screen = new WorkspaceMemberOverviewScreen();
  screen.enter(context);
  return { screen, context, client };
};

it('shows an active member’s username, position and About me', async () => {
  const { screen, context, client } = overviewWith({
    name: 'ada',
    field_developer_title: 'Backend developer',
    field_bb_background: 'Drupal and PHP.\nLittle DevOps.',
  });
  await vi.waitFor(() => expect(screen.state).toBe('ready'));
  const body = renderTree(screen.present(context).body).join('\n');
  expect(body).toMatch(/Username\W+ada/);
  expect(body).toMatch(/Position\W+Backend developer/);
  expect(body).toContain('About me');
  expect(body).toContain('Drupal and PHP.');
  expect(body).toContain('Little DevOps.');
  expect(client.get).toHaveBeenCalledWith('user/user/u1');
});

it('shows none for an empty position and About me', async () => {
  const { screen, context } = overviewWith({ name: 'ada' });
  await vi.waitFor(() => expect(screen.state).toBe('ready'));
  const body = renderTree(screen.present(context).body).join('\n');
  expect(body).toMatch(/Position\W+none/);
  expect(body).toMatch(/About me\W+none/);
});
