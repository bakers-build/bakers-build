import { expect, it, vi } from 'vitest';
import { TeamUsersScreen } from '../../../../src/Entity/team/Screen/team-users.js';
import {
  TeamOverviewScreen,
  TeamsScreen,
} from '../../../../src/Entity/team/Screen/teams-screen.js';
import { buildRoutes } from '../../../../src/Routing/routes.js';

const routes = buildRoutes();

import type { ScreenContext } from '../../../../src/Screen/screen.js';
import type { DropshClient } from '../../../../src/types.js';
import { renderTree } from '../../../render-tree.js';

// BB-391 AC4 (second round) — the TEAM LEVEL, by operator ruling.
//
// The root `Users` tab is gone and the users level hangs off a crew instead:
// Teams → one crew → Users → one person. That revises BB-377's information
// architecture, and these cases are where the revision is pinned — on the real
// production registry, because "the file exists" is not the claim. A screen is
// reachable in this renderer when `Routing/routes.ts` registers it and its
// `route.tab` puts it on a level's bar.

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(get: DropshClient['get']): {
  context: ScreenContext;
  navigated: { routeId: string; params: Record<string, string> }[];
} {
  const navigated: { routeId: string; params: Record<string, string> }[] = [];
  const context: ScreenContext = {
    sessionGeneration: 1,
    services: { client: { get, collection: vi.fn() } },
    requestDraw: () => {},
    isActive: () => true,
    nowSeconds: () => 1_700_000_000,
    navigate: (routeId, params) =>
      navigated.push({ routeId, params: params ?? {} }),
  };
  return { context, navigated };
}

/** Two of the three users are in the crew; `listUsers` reads them all. */
const USERS = [
  { id: 'u-anon', label: 'Anonymous', uid: 0 },
  { id: 'u-root', label: 'root', uid: 1 },
  { id: 'u-ada', label: 'Ada', uid: 4 },
  { id: 'u-linus', label: 'Linus', uid: 5 },
  { id: 'u-outsider', label: 'Outsider', uid: 6 },
];

const world = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  'bb_team/bb_team': {
    data: [
      {
        id: 'team-uuid-1',
        attributes: { name: 'Platform', drupal_internal__id: 7 },
      },
    ],
  },
  'og_membership/default': {
    data: [
      {
        id: 'm1',
        attributes: { entity_id: '7' },
        relationships: { uid: { data: { id: 'u-ada' } } },
      },
      {
        id: 'm2',
        attributes: { entity_id: '7' },
        relationships: { uid: { data: { id: 'u-linus' } } },
      },
    ],
  },
  'bb_project/bb_project': { data: [{ id: 'project-1' }] },
  'bb_ticket/bb_ticket': {
    data: [
      {
        id: 'ticket-1',
        attributes: {
          identifier: 'BB-1',
          title: 'Current work',
          closed: false,
          derived_status: 'running',
        },
        relationships: {
          labels: { data: [] },
          assignee_user_id: { data: { id: 'u-ada' } },
        },
      },
    ],
  },
  ...over,
});

/** A client serving the JSON:API paths from `world` plus the user collection. */
function client(
  paths: Record<string, unknown>,
  users: typeof USERS | Error = USERS,
): DropshClient {
  return {
    get: async (path) => {
      if (path === 'user/user') {
        if (users instanceof Error) throw users;
        return {
          data: users.map((user) => ({
            id: user.id,
            attributes: {
              display_name: user.label,
              drupal_internal__uid: user.uid,
            },
          })),
        };
      }
      if (!(path in paths)) throw new Error(`unexpected read: ${path}`);
      const answer = paths[path];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    collection: () => ({
      list: async () => {
        if (users instanceof Error) throw users;
        return users.map((user) => ({
          id: user.id,
          attr: (key: string) =>
            key === 'display_name'
              ? user.label
              : key === 'drupal_internal__uid'
                ? user.uid
                : undefined,
        }));
      },
    }),
  } as unknown as DropshClient;
}

// ---- the level ------------------------------------------------------------

it('registers the crew’s Users list in the production route registry', () => {
  expect(routes.ids()).toContain(TeamUsersScreen.route.id);
  expect(routes.get(TeamUsersScreen.route.id)?.screen).toBeInstanceOf(
    TeamUsersScreen,
  );
});

it('puts Overview, Work, Stats and Members on the TEAM level, in that order', () => {
  expect(routes.tabs('team').map((tab) => tab.id)).toEqual([
    'overview',
    'work',
    'stats',
    'members',
  ]);
  expect(routes.routeForTab('team', 'overview')?.metadata.id).toBe(
    TeamOverviewScreen.route.id,
  );
  expect(routes.routeForTab('team', 'members')?.metadata.id).toBe(
    TeamUsersScreen.route.id,
  );
});

// The ruling's point: `users` is no longer a ROOT destination. Asserted on the
// registry the bar navigates through, not only on the tab registry, because the
// two are independent declarations and either one alone can strand the other.
it('leaves no Users tab on the root level', () => {
  expect(routes.tabs('root').map((tab) => tab.id)).toEqual([
    'my-work',
    'stats',
    'projects',
    'teams',
    'conductors',
  ]);
  expect(routes.routeForTab('root', 'users')).toBeUndefined();
});

// A team tab is a DESTINATION, so Tab runs a real navigate — and it must carry
// `teamId`, or the tab opens with no crew, exactly the way a project tab needs
// `projectId` and a user tab needs `userId`.
it('preserves teamId when the bar navigates between the crew’s tabs', () => {
  const destination = routes
    .createSession({})
    .navigation()
    .tab('team', 'members', { teamId: 'team-uuid-1' });
  expect(destination?.routeId).toBe(TeamUsersScreen.route.id);
  expect(destination?.params).toEqual({ teamId: 'team-uuid-1' });
});

it('both team screens draw the team level’s own bar', () => {
  expect(routes.tabLocation(TeamOverviewScreen.route.id, {})).toMatchObject({
    level: 'team',
    tab: 'overview',
  });
  expect(routes.tabLocation(TeamUsersScreen.route.id, {})).toMatchObject({
    level: 'team',
    tab: 'members',
  });
});

it('escapes to the crews list, which is how the operator got here', () => {
  expect(TeamUsersScreen.route.fallback?.routeId).toBe(TeamsScreen.route.id);
});

// ---- the list -------------------------------------------------------------

it('lists the crew’s active members and nobody else', async () => {
  const screen = new TeamUsersScreen();
  const { context } = harness(async () => undefined);
  const scoped = {
    ...context,
    services: { client: client(world()) },
    params: { teamId: 'team-uuid-1', teamName: 'Platform' },
  };
  screen.enter(scoped);
  await tick();

  const text = renderTree(screen.present(scoped).body).join('\n');
  expect(text).toContain('Ada');
  expect(text).toContain('Linus');
  // Not in the crew, and therefore not on this tab even though `listUsers`
  // returned them.
  expect(text).not.toContain('Outsider');
  // Anonymous and uid 1 are never operator rows — the rule the root list had.
  expect(text).not.toContain('Anonymous');
  expect(screen.rows.map((row) => row.label)).toEqual(['Ada', 'Linus']);
});

it('shows current assignment counts, including a member with zero work', async () => {
  const screen = new TeamUsersScreen();
  const { context } = harness(async () => undefined);
  const scoped = {
    ...context,
    services: { client: client(world()) },
    params: { teamId: 'team-uuid-1', teamName: 'Platform' },
  };
  screen.enter(scoped);
  await tick();

  expect(screen.rows).toEqual([
    {
      id: 'u-ada',
      label: 'Ada',
      open: 1,
      running: 1,
      waiting: 0,
    },
    {
      id: 'u-linus',
      label: 'Linus',
      // A member with no activity is still a member — the whole reason the crew
      // is read from `og_membership` and not from the statistics document.
      open: 0,
      running: 0,
      waiting: 0,
    },
  ]);
});

it('resolves members from later user pages instead of dropping them', async () => {
  const base = client(world());
  let userPage = 0;
  const pagedClient = {
    ...base,
    get: async (path: string, params?: unknown) => {
      if (path !== 'user/user') return base.get(path, params);
      userPage += 1;
      const rows = userPage === 1 ? USERS.slice(0, 2) : USERS.slice(2);
      return {
        data: rows.map((user) => ({
          id: user.id,
          attributes: {
            display_name: user.label,
            drupal_internal__uid: user.uid,
          },
        })),
        ...(userPage === 1 ? { links: { next: 'page-2' } } : {}),
      };
    },
  } as unknown as DropshClient;
  const screen = new TeamUsersScreen();
  const scoped = {
    ...harness(async () => undefined).context,
    services: { client: pagedClient },
    params: { teamId: 'team-uuid-1' },
  };
  screen.enter(scoped);
  await tick();

  expect(userPage).toBe(2);
  expect(screen.rows.map(({ label }) => label)).toEqual(['Ada', 'Linus']);
});

it('opens the selected member inside the current team', async () => {
  const screen = new TeamUsersScreen();
  const { context, navigated } = harness(async () => undefined);
  const scoped = {
    ...context,
    services: { client: client(world()) },
    params: { teamId: 'team-uuid-1', teamName: 'Platform' },
  };
  screen.enter(scoped);
  await tick();

  expect(screen.handleInput('enter', scoped)).toBe(true);
  expect(navigated).toEqual([
    {
      routeId: 'team.member.overview',
      params: {
        teamId: 'team-uuid-1',
        teamName: 'Platform',
        userId: 'u-ada',
        userName: 'Ada',
      },
    },
  ]);
});

it('says a crew is empty when it is, and says so differently when it cannot tell', async () => {
  const empty = new TeamUsersScreen();
  const emptyContext = {
    ...harness(async () => undefined).context,
    services: {
      client: client(world({ 'og_membership/default': { data: [] } })),
    },
    params: { teamId: 'team-uuid-1' },
  };
  empty.enter(emptyContext);
  await tick();
  expect(renderTree(empty.present(emptyContext).body).join('\n')).toContain(
    'No active members',
  );

  const refused = new TeamUsersScreen();
  const refusedContext = {
    ...harness(async () => undefined).context,
    services: {
      client: client(
        world({ 'og_membership/default': new Error('403 Forbidden') }),
      ),
    },
    params: { teamId: 'team-uuid-1' },
  };
  refused.enter(refusedContext);
  await tick();
  const text = renderTree(refused.present(refusedContext).body).join('\n');
  expect(text).toContain('Could not read the crew');
  expect(text).toContain('403 Forbidden');
  expect(text).not.toContain('No active members');
});

it('names the crew in its chrome and counts the members it drew', async () => {
  const screen = new TeamUsersScreen();
  const scoped = {
    ...harness(async () => undefined).context,
    services: { client: client(world()) },
    params: { teamId: 'team-uuid-1', teamName: 'Platform' },
  };
  screen.enter(scoped);
  await tick();

  const shown = screen.present(scoped);
  expect(shown.title).toContain('Platform');
  expect(shown.meta ?? '').toContain('2 member(s)');
});
