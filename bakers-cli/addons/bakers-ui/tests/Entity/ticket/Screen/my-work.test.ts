import type { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { expect, it, vi } from 'vitest';
import { MyWorkScreen } from '../../../../src/Entity/ticket/Screen/my-work.js';
import { Router } from '../../../../src/Routing/router.js';
import type { Screen, ScreenContext } from '../../../../src/Screen/screen.js';
import { nodeById, renderTree } from '../../../render-tree.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

it('resolves the current identity and lists only its open work', async () => {
  const queries: string[] = [];
  const get = vi.fn(async (path: string, params?: unknown) => {
    queries.push(
      decodeURIComponent(
        (params as DrupalJsonApiParams | undefined)?.getQueryString() ?? '',
      ),
    );
    if (path === 'user/user') {
      return {
        data: [
          {
            id: 'user-1',
            attributes: { name: 'cw', display_name: 'Christian' },
          },
        ],
      };
    }
    return {
      data: [
        {
          id: 'ticket-1',
          attributes: {
            identifier: 'BB-521',
            title: 'Rebuild TUI info',
            closed: false,
          },
          relationships: { labels: { data: [] } },
        },
      ],
    };
  });
  const context: ScreenContext = {
    sessionGeneration: 1,
    services: {
      client: { get, collection: vi.fn() } as never,
      currentUser: 'cw',
      workspace: 'bakers',
    },
    requestDraw: vi.fn(),
    isActive: () => true,
  };
  const screen = new MyWorkScreen();
  screen.enter(context);
  await tick();

  const shown = screen.present(context);
  expect(renderTree(shown.body).join('\n')).toContain('BB-521');
  expect(
    renderTree(nodeById(shown.body, 'my-work-filter-closed-chip')!).join(''),
  ).toBe('x closed: hidden');
  expect(
    renderTree(nodeById(shown.body, 'my-work-filter-search-chip')!).join(''),
  ).toBe('/ search');
  expect(
    renderTree(nodeById(shown.body, 'my-work-filter-project-chip')!).join(''),
  ).toBe('r project');
  expect(
    queries.some((query) => query.includes('assignee_user_id.id]=user-1')),
  ).toBe(true);
  expect(queries.some((query) => query.includes('closed]=0'))).toBe(true);
});

it('requests a single server-side filtered page for the current user', async () => {
  const ticketQueries: string[] = [];
  const get = vi.fn(async (path: string, params?: unknown) => {
    const query = decodeURIComponent(
      (params as DrupalJsonApiParams | undefined)?.getQueryString() ?? '',
    );
    if (path === 'user/user') {
      return {
        data: [
          {
            id: 'user-1',
            attributes: { name: 'cw', display_name: 'Christian' },
          },
        ],
      };
    }
    ticketQueries.push(query);
    return {
      data: [
        {
          id: 'ticket-1',
          attributes: {
            identifier: 'WORK-1',
            title: 'Work page 1',
            closed: false,
          },
          relationships: { labels: { data: [] } },
        },
      ],
    };
  });
  const context: ScreenContext = {
    sessionGeneration: 1,
    services: {
      client: { get, collection: vi.fn() } as never,
      currentUser: 'cw',
      workspace: 'bakers',
    },
    requestDraw: vi.fn(),
    isActive: () => true,
  };
  const screen = new MyWorkScreen();
  screen.enter(context);
  await tick();

  const presented = screen.present(context);
  const text = renderTree(presented.body).join('\n');
  // BB-540 — exactly ONE page request, server-side filtered.
  expect(ticketQueries).toHaveLength(1);
  expect(text).toContain('WORK-1');
  expect(presented.meta).toContain('1 open ticket(s)');
});

it('honours criteria.project as a server-side filter when set', async () => {
  const ticketQueries: string[] = [];
  const get = vi.fn(async (path: string, params?: unknown) => {
    const query = decodeURIComponent(
      (params as DrupalJsonApiParams | undefined)?.getQueryString() ?? '',
    );
    if (path === 'user/user') {
      return {
        data: [
          {
            id: 'user-1',
            attributes: { name: 'cw', display_name: 'Christian' },
          },
        ],
      };
    }
    ticketQueries.push(query);
    return { data: [], meta: { count: 0 } };
  });
  const context: ScreenContext = {
    sessionGeneration: 1,
    services: {
      client: { get, collection: vi.fn() } as never,
      currentUser: 'cw',
      workspace: 'bakers',
    },
    requestDraw: vi.fn(),
    isActive: () => true,
  };
  const screen = new MyWorkScreen();
  // BB-540 — set a project criterion before load.
  screen.setCriteria(
    {
      query: '',
      state: null,
      closed: false,
      parent: null,
      who: null,
      owner: null,
      project: { id: 'p1', label: 'Alpha' },
    },
    context,
  );
  await tick();

  // BB-540 — the project filter is applied server-side via the
  // projectFromCriteria flag (set in `buildUserTicketQueryParams`).
  const last = ticketQueries[ticketQueries.length - 1] ?? '';
  expect(last).toMatch(/project_id/);
  expect(last).toMatch(/p1/);
  expect(
    renderTree(
      nodeById(screen.present(context).body, 'my-work-filter-project-chip')!,
    ).join(''),
  ).toBe('r project: Alpha');
});

// A real Router with the real My work screen; the pickers are stubs, so each
// test drives the hand-off through `back(result)` the way a picker does.
function myWorkRouter() {
  const ticketQueries: string[] = [];
  const get = vi.fn(async (path: string, params?: unknown) => {
    if (path === 'user/user')
      return { data: [{ id: 'user-1', attributes: { name: 'cw' } }] };
    ticketQueries.push(
      decodeURIComponent(
        (params as DrupalJsonApiParams | undefined)?.getQueryString() ?? '',
      ),
    );
    return { data: [], meta: { count: 0 } };
  });
  const picker = (id: string) =>
    ({
      id,
      enter: vi.fn(),
      leave: vi.fn(),
      render: vi.fn(() => []),
      handleInput: vi.fn(() => false),
      reset: vi.fn(),
    }) as unknown as Screen;
  const myWork = new MyWorkScreen();
  const router = new Router(
    new Map<string, Screen>([
      ['my.work', myWork],
      ['my.work.project-filter', picker('my.work.project-filter')],
      ['my.work.parent-filter', picker('my.work.parent-filter')],
      [
        'project.tickets.parent-filter',
        picker('project.tickets.parent-filter'),
      ],
    ]),
    vi.fn(),
    1,
    {
      services: {
        client: { get, collection: vi.fn() } as never,
        currentUser: 'cw',
        workspace: 'bakers',
      },
    } as never,
  );
  const chip = (id: string) =>
    renderTree(
      nodeById(
        myWork.present(router.context()).body,
        `my-work-filter-${id}-chip`,
      )!,
    ).join('');
  return { router, myWork, ticketQueries, chip };
}

it('filters My work by the project picked in the project filter', async () => {
  const { router, myWork, ticketQueries, chip } = myWorkRouter();
  router.navigate('my.work');
  await tick();
  myWork.handleInput('r', router.context());
  expect(router.active?.id).toBe('my.work.project-filter');

  router.back({
    type: 'project-filter-set',
    project: { id: 'p1', label: 'Alpha' },
  });
  await tick();

  expect(ticketQueries.at(-1)).toMatch(/project_id\.id/);
  expect(ticketQueries.at(-1)).toMatch(/p1/);
  expect(chip('project')).toBe('r project: Alpha');
});

it('clears only the project criterion when the project picker clears', async () => {
  const { router, myWork, ticketQueries, chip } = myWorkRouter();
  router.navigate('my.work');
  await tick();
  const kept = {
    query: 'login',
    state: 'working',
    closed: null,
    parent: { id: 't1', identifier: 'BAKERS-1' },
    who: null,
    owner: null,
  };
  myWork.setCriteria(
    { ...kept, project: { id: 'p1', label: 'Alpha' } },
    router.context(),
  );
  await tick();
  myWork.handleInput('r', router.context());

  router.back({ type: 'project-filter-set', project: null });
  await tick();

  expect(myWork.criteria).toEqual({ ...kept, project: null });
  expect(ticketQueries.at(-1)).not.toMatch(/project_id\.id/);
  expect(chip('project')).toBe('r project');
});

it('filters My work by the parent picked, and a cleared pick drops only it', async () => {
  const { router, myWork, chip } = myWorkRouter();
  router.navigate('my.work');
  await tick();
  const project = { id: 'p1', label: 'Alpha' };
  myWork.setCriteria({ ...myWork.criteria, project }, router.context());
  await tick();

  router.navigate('my.work.parent-filter');
  router.back({
    type: 'parent-filter-set',
    parent: { id: 't1', identifier: 'BAKERS-1' },
  });
  await tick();
  expect(myWork.criteria.parent).toEqual({ id: 't1', identifier: 'BAKERS-1' });
  expect(chip('parent')).toBe('p parent: BAKERS-1');

  router.navigate('my.work.parent-filter');
  router.back({ type: 'parent-filter-set', parent: null });
  await tick();
  expect(myWork.criteria.parent).toBeNull();
  expect(myWork.criteria.project).toEqual(project);
  expect(chip('parent')).toBe('p parent');
});

it('opens the My work parent picker on p', async () => {
  const { router, myWork } = myWorkRouter();
  router.navigate('my.work');
  await tick();
  myWork.handleInput('p', router.context());
  expect(router.active?.id).toBe('my.work.parent-filter');
});
