import { expect, it, vi } from 'vitest';
import { TeamWorkScreen } from '../../../../src/Entity/team/Screen/team-work.js';
import {
  TeamOverviewScreen,
  TeamStatsScreen,
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
//
// The DETAIL is the team-scoped statistics, over the `?team_id=` the control
// plane has served since BB-321. It reads that and nothing else: `by_team` is
// what the server omits under that scope, so a team's own page shows its
// TOTALS — which is the whole point of scoping.

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

// BB-391 second round — `resolveTeam` is WIRED, not dead code.
//
// It existed for exactly the case the detail could not handle: a deep link
// (`bakers ui` → `/teams/<uuid>`) carries no `teamName`, so the header rendered the
// raw uuid, and the two figures a crew's own page has that its statistics do not
// — the workspace it lives in and its headcount — were never shown at all. The
// detail therefore reads BOTH: the identity and the team-scoped statistics.
const DETAIL_WORLD: Record<string, unknown> = {
  ...TEAM_WORLD,
  'bakers/statistics': {
    data: {
      attributes: {
        groups: [
          {
            id: 'breakdown',
            label: 'Breakdown',
            figures: [
              {
                id: 'team_projects',
                label: 'Projects',
                description: '',
                widget: 'grouped_horizontal_bars',
                generated: '2026-08-21T19:00:00+00:00',
                filters: {
                  period: {
                    label: 'Period',
                    value: '7',
                    options: [
                      { value: '7', label: '7 days' },
                      { value: '30', label: '30 days' },
                    ],
                  },
                },
                categories: [{ key: 'project-1', label: 'bakers.build' }],
                measurements: [
                  {
                    id: 'closed_tickets',
                    label: 'Tickets closed',
                    value_type: 'integer',
                    unit: 'tickets',
                    values: { 'project-1': 30 },
                  },
                  {
                    id: 'runs',
                    label: 'Runs created',
                    value_type: 'integer',
                    unit: 'runs',
                    values: { 'project-1': 31 },
                  },
                ],
                empty: { is_empty: false, message: null },
                cache: { max_age: 0, contexts: [], tags: [] },
              },
            ],
          },
        ],
      },
    },
  },
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

// ---- the detail -----------------------------------------------------------

it('scopes the detail read with ?team_id= and renders the figures', async () => {
  const paths: string[] = [];
  const queries: string[] = [];
  const screen = new TeamStatsScreen();
  const { context } = harness(async (path, params) => {
    paths.push(path);
    queries.push(
      decodeURIComponent(
        (
          params as { getQueryString?: () => string } | undefined
        )?.getQueryString?.() ?? '',
      ),
    );
    if (!(path in DETAIL_WORLD)) throw new Error(`unexpected read: ${path}`);
    return DETAIL_WORLD[path];
  });
  screen.enter({ ...context, params: { teamId: 'team-uuid-1' } });
  await tick();

  expect(paths).toContain('bakers/statistics');
  expect(paths).not.toContain('bb_team/bb_team');
  const statsQuery = queries[paths.indexOf('bakers/statistics')] ?? '';
  expect(statsQuery).toContain('team_id=team-uuid-1');
  expect(statsQuery).not.toContain('filter[period]');
  const text = screen
    .renderNonInteractive({ ...context, params: { teamId: 'team-uuid-1' } })
    .join('\n');
  expect(text).toContain('Tickets closed');
  expect(text).toContain('Runs created');
  expect(text).toContain('30');
});

it('renders figures without loading or displaying crew metadata', async () => {
  const screen = new TeamStatsScreen();
  const { context } = harness(serve(DETAIL_WORLD));
  const scoped = {
    ...context,
    params: { teamId: 'team-uuid-1', teamName: 'Platform' },
  };
  screen.enter(scoped);
  await tick();

  const text = screen.renderNonInteractive(scoped).join('\n');
  expect(text).toContain('Tickets closed');
  expect(text).toContain('Runs created');
  expect(text).not.toContain('CREW');
  expect(text).not.toContain('Workspace');
  expect(text).not.toContain('Members');
});

it('reports a statistics failure without making an identity read', async () => {
  const screen = new TeamStatsScreen();
  const paths: string[] = [];
  const { context } = harness(async (path) => {
    paths.push(path);
    if (path === 'bakers/statistics') throw new Error('500 Server Error');
    throw new Error(`unexpected read: ${path}`);
  });
  const scoped = { ...context, params: { teamId: 'team-uuid-1' } };
  screen.enter(scoped);
  await tick();

  expect(paths).toEqual(['bakers/statistics']);
  expect(screen.renderNonInteractive(scoped).join('\n')).toContain(
    '500 Server Error',
  );
});

it('reports when no team figures are configured', async () => {
  const screen = new TeamStatsScreen();
  const { context } = harness(
    serve({
      'bakers/statistics': { data: { attributes: { groups: [] } } },
    }),
  );
  const scoped = { ...context, params: { teamId: 'team-uuid-1' } };
  screen.enter(scoped);
  await tick();

  expect(screen.renderNonInteractive(scoped).join('\n')).toContain(
    'No figures configured for this team.',
  );
});

// A control plane predating the statistics route must be reported as OLD, not as
// a team with no work — the same discrimination spec D9 draws for every other
// consumer of this read.
it('reports an absent statistics endpoint rather than an empty team', async () => {
  const screen = new TeamStatsScreen();
  const { context } = harness(async () => {
    throw Object.assign(new Error('HTTP 404'), {
      status: 404,
      body: '<!DOCTYPE html><html><body>Page not found</body></html>',
    });
  });
  const scoped = { ...context, params: { teamId: 'team-uuid-1' } };
  screen.enter(scoped);
  await tick();
  expect(screen.renderNonInteractive(scoped).join('\n')).toContain(
    '/jsonapi/bakers/statistics',
  );
});
