import { expect, it, vi } from 'vitest';
import { TeamWorkScreen } from '../../../../src/Entity/team/Screen/team-work.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import { renderTree } from '../../../render-tree.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const contextWith = (
  get: (path: string) => Promise<unknown>,
): ScreenContext => ({
  sessionGeneration: 1,
  params: { teamId: 'team-1', teamName: 'Platform' },
  services: { client: { get, collection: vi.fn() } as never },
  requestDraw: vi.fn(),
  isActive: () => true,
});

const team = {
  data: [
    {
      id: 'team-1',
      attributes: { name: 'Platform', drupal_internal__id: 7 },
      relationships: { workspace_id: { data: { id: 'ws-1' } } },
    },
  ],
  included: [{ id: 'ws-1', attributes: { name: 'keytec' } }],
};

it('renders compact team context and team-level workload counters', async () => {
  const screen = new TeamWorkScreen();
  const context = contextWith(async (path) => {
    if (path === 'bb_team/bb_team') return team;
    if (path === 'og_membership/default') {
      return {
        data: [
          {
            id: 'm1',
            attributes: { entity_id: '7' },
            relationships: { uid: { data: { id: 'user-1' } } },
          },
        ],
      };
    }
    if (path === 'bb_project/bb_project') return { data: [{ id: 'p1' }] };
    return {
      data: [
        {
          id: 't1',
          attributes: {
            identifier: 'BB-1',
            title: 'Work',
            closed: false,
            derived_status: 'running',
          },
          relationships: {
            labels: { data: [] },
            assignee_user_id: { data: { id: 'user-1' } },
          },
        },
      ],
    };
  });

  screen.enter(context);
  expect(renderTree(screen.present(context).body)).toContain(
    'Loading team work…',
  );
  await tick();
  const ready = renderTree(screen.present(context).body).join('\n');
  expect(ready).toContain('Workspace: keytec');
  expect(ready).toContain('Members: 1');
  expect(ready).toContain('Projects: 1');
  expect(ready).toContain('Open 1');
  expect(ready).toContain('Running 1');
  expect(ready).toContain('Waiting 0');
});

it('shows a retryable upstream error instead of totals', async () => {
  const screen = new TeamWorkScreen();
  const context = contextWith(async (path) => {
    if (path === 'bb_team/bb_team') return team;
    if (path === 'og_membership/default') throw new Error('403 memberships');
    return { data: [] };
  });

  screen.enter(context);
  await tick();
  const failed = renderTree(screen.present(context).body).join('\n');
  expect(failed).toContain('403 memberships');
  expect(failed).toContain('Press Enter to retry.');
  expect(failed).not.toContain('Open 0');
});
