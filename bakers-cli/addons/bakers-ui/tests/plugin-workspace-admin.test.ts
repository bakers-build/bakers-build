import { beforeEach, expect, it, vi } from 'vitest';
import { buildRoutes } from '../src/Routing/routes.js';
import type { DropshClient, TuiOptions } from '../src/types.js';

const runTicketTui = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../src/Kernel/tui-kernel.js', () => ({ runTicketTui }));
const { default: bakersUiPlugin } = await import('../src/plugin.js');

beforeEach(() => runTicketTui.mockClear());

async function resolvedCapability(role?: string): Promise<boolean | undefined> {
  const workspace = {
    attr: (key: string) =>
      key === 'drupal_internal__id' ? 7 : key === 'name' ? 'Bb' : undefined,
  };
  const collection = {
    where: vi.fn(),
    first: vi.fn(async () => workspace),
    list: vi.fn(async () => []),
  };
  collection.where.mockReturnValue(collection);
  const client = {
    collection: vi.fn(() => collection),
    get: vi.fn(async (path: string) =>
      path === 'user/user'
        ? {
            data: [
              {
                id: 'user-1',
                attributes: { name: 'cw', display_name: 'Christian' },
              },
            ],
          }
        : {
            data: [
              {
                relationships: {
                  uid: { data: { id: 'user-1' } },
                  roles: {
                    data: role
                      ? [
                          {
                            id: 'role-uuid',
                            meta: { drupal_internal__target_id: role },
                          },
                        ]
                      : [],
                  },
                },
              },
            ],
          },
    ),
  } as unknown as DropshClient;
  const renderer = bakersUiPlugin({
    workspaceId: 'workspace-1',
    currentUser: 'cw',
  }).renderers[0];
  if (!renderer) throw new Error('renderer missing');
  await renderer.run({}, {}, { client });
  const call = runTicketTui.mock.calls.at(-1);
  if (!call) throw new Error('kernel was not called');
  return (call[3] as TuiOptions).isWorkspaceAdmin;
}

it('exposes workspace lead membership as an explicit renderer capability', async () => {
  expect(await resolvedCapability('bb_workspace-bb_workspace-lead')).toBe(true);
});

it('fails closed for an ordinary workspace member', async () => {
  expect(await resolvedCapability()).toBe(false);
});

it('registers the workspace roster and every member route only for leads', () => {
  const memberRoutes = (isLead: boolean) =>
    buildRoutes([], isLead)
      .ids()
      .filter(
        (id) =>
          id === 'workspace.members' || id.startsWith('workspace.member.'),
      );
  expect(memberRoutes(false)).toEqual([]);
  expect(memberRoutes(true)).toEqual([
    'workspace.members',
    'workspace.member.overview',
    'workspace.member.tickets',
    'workspace.member.runs',
  ]);
});
