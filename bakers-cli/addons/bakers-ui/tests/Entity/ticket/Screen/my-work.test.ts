import type { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { expect, it, vi } from 'vitest';
import { MyWorkScreen } from '../../../../src/Entity/ticket/Screen/my-work.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
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

it('a click selects an unselected row, opens the selected one and rejects out-of-range rows', async () => {
  const ticket = (id: string, identifier: string) => ({
    id,
    attributes: { identifier, title: identifier, closed: false },
    relationships: { labels: { data: [] } },
  });
  const get = vi.fn(async (path: string) =>
    path === 'user/user'
      ? { data: [{ id: 'user-1', attributes: { name: 'cw' } }] }
      : { data: [ticket('ticket-1', 'BB-1'), ticket('ticket-2', 'BB-2')] },
  );
  const requestDraw = vi.fn();
  const navigate = vi.fn();
  const context: ScreenContext = {
    sessionGeneration: 1,
    services: {
      client: { get, collection: vi.fn() } as never,
      currentUser: 'cw',
      workspace: 'bakers',
    },
    requestDraw,
    navigate,
    isActive: () => true,
  };
  const screen = new MyWorkScreen();
  screen.enter(context);
  await tick();
  expect(screen.present(context).rowIds).toHaveLength(2);
  requestDraw.mockClear();

  expect(screen.select(1, context)).toBe(true);
  expect(screen.present(context).selectedIndex).toBe(1);
  expect(requestDraw).toHaveBeenCalled();

  expect(screen.select(-1, context)).toBe(false);
  expect(screen.select(2, context)).toBe(false);
  expect(screen.present(context).selectedIndex).toBe(1);

  expect(screen.activate(1, context)).toBe(true);
  expect(navigate).toHaveBeenCalledWith('ticket.detail', { ticketId: 'ticket-2' });
});
