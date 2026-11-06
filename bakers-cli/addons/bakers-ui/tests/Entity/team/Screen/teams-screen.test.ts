import { expect, it, vi } from 'vitest';
import { TeamWorkScreen } from '../../../../src/Entity/team/Screen/team-work.js';
import {
  TeamOverviewScreen,
  TeamsScreen,
} from '../../../../src/Entity/team/Screen/teams-screen.js';
import { buildRoutes } from '../../../../src/Routing/routes.js';

const routes = buildRoutes();

import type { ScreenContext } from '../../../../src/Screen/screen.js';
import type { DropshClient } from '../../../../src/types.js';
import { renderTree } from '../../../render-tree.js';

// BB-391 (AC4) — the team SURFACE, and specifically that it is REACHABLE.
//
// "The file exists" is not the claim these cases make. A screen is reachable in
// this renderer when `Routing/routes.ts` registers its class and the class's
// `route.tab` puts it on a level's tab bar — that is exactly how
// `Entity/project`'s list is reached, and the two assertions below read the real
// production registry rather than a fixture of it.

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

const TEAM_WORLD: Record<string, unknown> = {
  'bb_team/bb_team': {
    data: [
      {
        id: 'team-uuid-1',
        attributes: { name: 'Platform', drupal_internal__id: 7 },
        relationships: { workspace_id: { data: { id: 'ws-1' } } },
      },
    ],
    included: [{ id: 'ws-1', attributes: { name: 'keytec' } }],
  },
  'og_membership/default': {
    data: [
      { id: 'm1', attributes: { entity_id: '7' } },
      { id: 'm2', attributes: { entity_id: '7' } },
    ],
  },
};

const serve =
  (world: Record<string, unknown>): DropshClient['get'] =>
  async (path) => {
    if (!(path in world)) throw new Error(`unexpected read: ${path}`);
    return world[path];
  };

// ---- reachability ---------------------------------------------------------

it('the production route registry knows the teams list and the team detail', () => {
  expect(routes.ids()).toContain(TeamsScreen.route.id);
  expect(routes.ids()).toContain(TeamOverviewScreen.route.id);
  expect(routes.get(TeamsScreen.route.id)?.screen).toBeInstanceOf(TeamsScreen);
});

it('the teams list occupies a ROOT tab, so the bar navigates to it', () => {
  const tab = routes
    .tabs('root')
    .find((t) => t.id === TeamsScreen.route.tab?.id);
  expect(tab, 'no `teams` tab on the root level').toBeDefined();
  expect(tab?.label).toBe('Teams');
  // …and the tab really resolves back to THIS screen, which is the hop
  // `gotoTopTab` takes when the operator presses Tab or clicks the label.
  expect(routes.routeForTab('root', 'teams')?.metadata.id).toBe(
    TeamsScreen.route.id,
  );
});

it('the detail falls back to the list when there is no history', () => {
  expect(TeamOverviewScreen.route.fallback?.routeId).toBe(TeamsScreen.route.id);
});

it('the Overview landing performs no control-plane reads', async () => {
  const get = vi.fn(async () => ({ data: [] }));
  const screen = new TeamOverviewScreen();
  const { context } = harness(get);
  const scoped = { ...context, params: { teamId: 'team-uuid-1' } };

  screen.enter(scoped);
  await tick();

  expect(get).not.toHaveBeenCalled();
  expect(renderTree(screen.present(scoped).body)).toEqual([]);
});

// ---- the list -------------------------------------------------------------

it('lists each team with its workspace and member count', async () => {
  const screen = new TeamsScreen();
  const { context } = harness(serve(TEAM_WORLD));
  screen.enter(context);
  await tick();

  const text = renderTree(screen.present(context).body).join('\n');
  expect(text).toContain('Platform');
  expect(text).toContain('keytec');
  expect(text).toContain('2');
  expect(screen.rows).toHaveLength(1);
});

it('Enter on a row opens THAT team’s detail, carrying its name', async () => {
  const screen = new TeamsScreen();
  const { context, navigated } = harness(serve(TEAM_WORLD));
  screen.enter(context);
  await tick();

  expect(screen.handleInput('enter', context)).toBe(true);
  expect(navigated).toEqual([
    {
      routeId: TeamWorkScreen.route.id,
      params: { teamId: 'team-uuid-1', teamName: 'Platform' },
    },
  ]);
});

it('says so when there are no teams, rather than rendering nothing', async () => {
  const screen = new TeamsScreen();
  const { context } = harness(
    serve({ ...TEAM_WORLD, 'bb_team/bb_team': { data: [] } }),
  );
  screen.enter(context);
  await tick();
  expect(renderTree(screen.present(context).body).join('\n')).toContain(
    'No teams.',
  );
});

// BB-391 second round — a REFUSED collection read is not an empty crew list.
//
// `listTeams` has always answered with a `ListOutcome`, whose entire purpose is
// to tell those two apart, and the screen used to render both as `No teams.`
// D9 declines to teach this CLI to distinguish 403 from a rank-narrowed empty
// collection IN GENERAL; it does not license throwing away a distinction the
// read already hands over.
it('says the crew list could not be READ, rather than that there are none', async () => {
  const screen = new TeamsScreen();
  const { context } = harness(async (path) => {
    if (path === 'bb_team/bb_team') throw new Error('403 Forbidden');
    return TEAM_WORLD['og_membership/default'];
  });
  screen.enter(context);
  await tick();

  const text = renderTree(screen.present(context).body).join('\n');
  expect(text).toContain('Could not read the team list.');
  expect(text).toContain('403 Forbidden');
  expect(text).not.toContain('No teams.');
  // Nothing is selectable, so Enter cannot navigate into a row that is not there.
  expect(screen.rows).toEqual([]);
});

// The MEMBERS column keeps its own failure separate: the crew's identities came
// back, only the headcount did not.
it('still lists the crews when only the membership count was refused', async () => {
  const screen = new TeamsScreen();
  const { context } = harness(async (path) => {
    if (path === 'og_membership/default') throw new Error('403 Forbidden');
    return TEAM_WORLD['bb_team/bb_team'];
  });
  screen.enter(context);
  await tick();

  const text = renderTree(screen.present(context).body).join('\n');
  expect(text).toContain('Platform');
  expect(text).not.toContain('Could not read the team list.');
});

// BB-391 second round — truncation is `links.next` and nothing else.
//
// `rows.length >= 50` false-positives on an instance with exactly 50 teams, and
// the server caps a page at 50 rows whatever `page[limit]` asked for, so a full
// page is exactly as consistent with "that was all" as with "more follows".
it('reports truncation from links.next, never from a full page of rows', async () => {
  const fullPage = {
    data: Array.from({ length: 50 }, (_unused, index) => ({
      id: `team-${index}`,
      attributes: { name: `Crew ${index}`, drupal_internal__id: index },
    })),
    included: [],
  };

  const exact = new TeamsScreen();
  const exactContext = harness(
    serve({ ...TEAM_WORLD, 'bb_team/bb_team': fullPage }),
  ).context;
  exact.enter(exactContext);
  await tick();
  expect(exact.present(exactContext).meta ?? '').not.toContain('first page');

  const more = new TeamsScreen();
  const moreContext = harness(
    serve({
      ...TEAM_WORLD,
      'bb_team/bb_team': {
        ...fullPage,
        links: { next: { href: 'https://next' } },
      },
    }),
  ).context;
  more.enter(moreContext);
  await tick();
  expect(more.present(moreContext).meta ?? '').toContain('first page');
});
