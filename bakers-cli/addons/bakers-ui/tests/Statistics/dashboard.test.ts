import { describe, expect, it } from 'vitest';
import { formatActionLadder } from '../../src/Component/footer-actions/index.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import {
  MyStatsScreen,
  ProjectStatsScreen,
} from '../../src/Statistics/dashboard.js';
import type { DropshClient } from '../../src/types.js';

// BB-456 — the Dashboard reads the configured-figure contract (spec D5): a
// project renders its own figures, and the root screen (no project in
// context) resolves the account's own uuid and renders ITS figures — there
// are no workspace statistics any more (spec D6). Replaces the fixed
// tickets/runs document BB-256/271/319/321/377 built, and the PER USER
// navigation that document made possible (dropped: see `dashboard.ts`'s own
// comment on why the new contract carries no successor for it).

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A project-scoped context: `resolveScopeId` reads `context.project.id`. */
function projectHarness(get: DropshClient['get']): ScreenContext {
  return {
    sessionGeneration: 1,
    project: { id: 'proj-1', name: 'bakers', slug: 'bakers' },
    services: {
      client: {
        get,
        collection: () => ({}) as never,
        update: async () => ({}),
      },
    },
    requestDraw: () => {},
    isActive: () => true,
    nowSeconds: () => 1_700_000_000,
  } as ScreenContext;
}

/** A root context: `resolveScopeId` resolves `services.currentUser` to a uuid. */
function rootHarness(get: DropshClient['get']): ScreenContext {
  return {
    sessionGeneration: 1,
    services: {
      client: {
        get,
        collection: () => ({}) as never,
        update: async () => ({}),
      },
      currentUser: 'cw',
    },
    requestDraw: () => {},
    isActive: () => true,
    nowSeconds: () => 1_700_000_000,
  } as ScreenContext;
}

/** The index document discovery answers, and the value document for each id. */
function statsClient(
  listings: Array<{
    id: string;
    label: string;
    display: string;
    weight: number;
  }>,
  values: Record<string, Record<string, unknown>>,
): DropshClient['get'] {
  return async (path: string) => {
    if (path === 'user/user') return { data: [{ id: 'u-cw' }] };
    if (path === 'bakers/statistics') {
      return {
        data: {
          attributes: {
            groups: listings.length
              ? [
                  {
                    id: 'overview',
                    label: 'Overview',
                    figures: listings.map((listing) => ({
                      id: listing.id,
                      label: listing.label,
                      description: '',
                      widget: 'matrix',
                      generated: 'g',
                      filters: {},
                      categories: [
                        { key: 'day', label: 'Last 24 hours' },
                        { key: 'week', label: 'Last 7 days' },
                        { key: 'month', label: 'Last 30 days' },
                      ],
                      measurements: [
                        {
                          id: listing.id,
                          label: listing.label,
                          value_type: 'integer',
                          unit: 'count',
                          values: values[listing.id]?.total ?? {},
                        },
                      ],
                      empty: { is_empty: false, message: null },
                      cache: { max_age: 0, contexts: [], tags: [] },
                    })),
                  },
                ]
              : [],
          },
        },
      };
    }
    return { data: [] };
  };
}

async function ready(context: ScreenContext): Promise<{
  screen: MyStatsScreen | ProjectStatsScreen;
  context: ScreenContext;
}> {
  const screen = context.project
    ? new ProjectStatsScreen()
    : new MyStatsScreen();
  screen.enter(context);
  await tick();
  return { screen, context };
}

describe('ProjectStatsScreen', () => {
  it('renders one section per discovered figure, weight-ordered', async () => {
    const get = statsClient(
      [
        {
          id: 'project_tickets',
          label: 'Closed tickets',
          display: 'windows',
          weight: 0,
        },
        { id: 'project_runs', label: 'Runs', display: 'windows', weight: 1 },
      ],
      {
        project_tickets: {
          generated: 'g',
          windows: {},
          total: { day: 1, week: 5, month: 20 },
        },
        project_runs: {
          generated: 'g',
          windows: {},
          total: { day: 2, week: 6, month: 30 },
        },
      },
    );
    const { screen, context } = await ready(projectHarness(get));
    const lines = screen.renderNonInteractive(context);

    expect(lines).toContain('Closed tickets');
    expect(lines).toContain('Runs');
    expect(lines.indexOf('Closed tickets')).toBeLessThan(lines.indexOf('Runs'));
  });

  it('never names user_id/team_id: the scope is the project uuid alone', async () => {
    const paths: string[] = [];
    const get: DropshClient['get'] = async (path) => {
      paths.push(path);
      if (path === 'bakers/statistics') return { data: [] };
      return { data: [] };
    };
    await ready(projectHarness(get));
    expect(paths).toEqual(['bakers/statistics']);
  });

  it('renders the empty state when discovery names no figure', async () => {
    const { screen, context } = await ready(
      projectHarness(async () => ({ data: { attributes: { groups: [] } } })),
    );
    expect(screen.renderNonInteractive(context)).toEqual([
      '  No figures configured for this group.',
    ]);
  });

  it('reports an unsupported control plane and a failed read', async () => {
    const unsupported = new ProjectStatsScreen();
    const notFound = Object.assign(new Error('nope'), { status: 404 });
    const contextA = projectHarness(async () => {
      throw notFound;
    });
    unsupported.enter(contextA);
    await tick();
    expect(unsupported.renderNonInteractive(contextA)[0]).toBe(
      'This control plane does not serve /jsonapi/bakers/statistics.',
    );

    const failed = new ProjectStatsScreen();
    const contextB = projectHarness(async () => {
      throw new Error('connection refused');
    });
    failed.enter(contextB);
    await tick();
    expect(failed.renderNonInteractive(contextB)).toEqual([
      'Could not read /jsonapi/bakers/statistics.',
      '',
      'connection refused',
    ]);
  });

  it('reports the figure count in the meta line', async () => {
    const get = statsClient(
      [
        {
          id: 'project_tickets',
          label: 'Closed tickets',
          display: 'windows',
          weight: 0,
        },
      ],
      {
        project_tickets: {
          generated: 'g',
          windows: {},
          total: { day: 1, week: 1, month: 1 },
        },
      },
    );
    const { screen, context } = await ready(projectHarness(get));
    expect(screen.present(context).meta).toBe('1 figure(s)');
  });

  it('publishes the new-ticket and Tab actions, and no per-row selection', async () => {
    const get = statsClient([], {});
    const { screen, context } = await ready(projectHarness(get));
    const shown = screen.present(context);
    expect(formatActionLadder(shown.actions)).toContain('n new');
    expect(formatActionLadder(shown.actions)).toContain('Tab tabs');
    expect(shown.selectable ?? 0).toBe(0);
  });
});

describe('MyStatsScreen', () => {
  it('resolves services.currentUser to a uuid, then scopes discovery by it', async () => {
    const paths: string[] = [];
    const params: unknown[] = [];
    const get: DropshClient['get'] = async (path, p) => {
      paths.push(path);
      params.push(p);
      if (path === 'user/user') return { data: [{ id: 'u-cw' }] };
      if (path === 'bakers/statistics')
        return { data: { attributes: { groups: [] } } };
      return { data: [] };
    };
    await ready(rootHarness(get));

    expect(paths[0]).toBe('user/user');
    expect(paths[1]).toBe('bakers/statistics');
    const qs = decodeURIComponent(
      (params[1] as { getQueryString: () => string }).getQueryString(),
    );
    expect(qs).toContain('user_id=u-cw');
  });

  it('reports an error when the current account cannot be resolved', async () => {
    const { screen, context } = await ready(
      rootHarness(async (path) =>
        path === 'user/user' ? { data: [] } : { data: [] },
      ),
    );
    expect(screen.renderNonInteractive(context)).toEqual([
      'Could not read /jsonapi/bakers/statistics.',
      '',
      "current account 'cw' not found",
    ]);
  });

  it('titles the root screen as Stats', async () => {
    const { screen, context } = await ready(rootHarness(statsClient([], {})));
    expect(screen.present(context).title).toBe('bakers.build stats');
  });
});

describe('Stats screens’ piped output', () => {
  it('prints the same sections the interactive tree draws, no Tab hint', async () => {
    const get = statsClient(
      [
        {
          id: 'project_tickets',
          label: 'Closed tickets',
          display: 'windows',
          weight: 0,
        },
      ],
      {
        project_tickets: {
          generated: 'g',
          windows: {},
          total: { day: 1, week: 2, month: 3 },
        },
      },
    );
    const { screen, context } = await ready(projectHarness(get));
    expect(screen.renderNonInteractive(context)).toContain('Closed tickets');
  });

  it('drops the Tab hint from an unsupported control plane', async () => {
    const screen = new ProjectStatsScreen();
    const context = projectHarness(async () => {
      throw Object.assign(new Error('nope'), { status: 404 });
    });
    screen.enter(context);
    await tick();

    expect(screen.renderNonInteractive(context)).toEqual([
      'This control plane does not serve /jsonapi/bakers/statistics.',
      '',
      'It predates BB-456. Deploy it to see the figures.',
      '',
    ]);
    expect(screen.nonInteractive(context)).toEqual({
      lines: [
        'bakers · stats',
        'This control plane does not serve /jsonapi/bakers/statistics.',
        'It predates BB-456. Deploy it to see the figures.',
      ],
      stream: 'stderr',
      exitCode: 1,
    });
  });
});
