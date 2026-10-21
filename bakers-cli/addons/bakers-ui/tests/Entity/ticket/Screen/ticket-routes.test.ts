import { describe, expect, it, vi } from 'vitest';
import { formatActionLadder } from '../../../../src/Component/footer-actions/index.js';
import { Router } from '../../../../src/Routing/router.js';
import {
  bootLocationFor,
  buildRoutes,
} from '../../../../src/Routing/routes.js';

const routes = buildRoutes();

import type { ScreenContext } from '../../../../src/Screen/screen.js';
import type { TicketDetailDocument } from '../../../../src/types.js';

const document: TicketDetailDocument = {
  data: {
    id: 'T1',
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'TEST-1',
      title: 'Ticket',
      state: 'coding',
      description: { value: 'Description body' },
    },
  },
  included: [
    {
      id: 'R1',
      type: 'bb_run--bb_run',
      attributes: { status: 'running', created: '2026-01-02T00:00:00Z' },
    },
    {
      id: 'R2',
      type: 'bb_run--bb_run',
      attributes: { status: 'done', created: '2026-01-01T00:00:00Z' },
    },
    {
      id: 'C1',
      type: 'bb_comment--bb_comment',
      attributes: {
        bb_comment_type: 'comment',
        body: { value: 'First body' },
        created: '2026-01-01',
      },
    },
    {
      id: 'C2',
      type: 'bb_comment--bb_comment',
      attributes: {
        bb_comment_type: 'comment',
        body: { value: 'Second body' },
        created: '2026-01-02',
      },
    },
  ],
};
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const setup = () => {
  const session = routes.createSession({});
  return new Router(session.screens(), vi.fn(), 1, {}, session.navigation());
};

describe('ticket routes', () => {
  it.each([
    'overview',
    'planning',
    'comments',
    'runs',
  ])('%s remains a tab destination while its request is pending', (tab) => {
    const session = routes.createSession({});
    const router = new Router(
      session.screens(),
      vi.fn(),
      1,
      {
        services: {
          client: { get: () => new Promise(() => {}), collection: vi.fn() },
        },
      } as Pick<ScreenContext, 'services'>,
      session.navigation(),
    );
    router.navigate('ticket.detail', { ticketId: 'T1' }, false);
    if (tab !== 'overview') router.navigateTab('ticket', tab);
    expect(
      routes.tabLocation(
        router.active?.id ?? '',
        router.context().params ?? {},
      ),
    ).toMatchObject({
      level: 'ticket',
      tab,
    });
  });

  it('navigates each ticket tab as a destination retaining scope without growing history', async () => {
    const router = setup();
    router.navigate('ticket.detail', { ticketId: 'T1' }, false, { document });
    for (const [tab, routeId] of [
      ['planning', 'ticket.planning'],
      ['comments', 'ticket.comments'],
      ['runs', 'ticket.runs'],
      ['overview', 'ticket.detail'],
    ]) {
      expect(router.navigateTab('ticket', tab ?? '')).toBe(true);
      expect(router.active?.id).toBe(routeId);
      expect(router.context().params?.ticketId).toBe('T1');
    }
    expect(router.historyForTest()).toEqual([]);
    await tick();
  });

  it('runs opens the selected run with Enter and Space, but releases edge arrows to scrolling', () => {
    const router = setup();
    expect(routes.routeForTab('ticket', 'runs')).toBeDefined();
    router.navigate('ticket.runs', { ticketId: 'T1' }, false, { document });
    const screen = activeScreen(router);
    expect(formatActionLadder(screen.present(router.context()).actions)).toBe(
      'Tab section · e edit · y copy id · Y copy link · ↑↓ select · Enter open run',
    );
    expect(screen.handleInput('up', router.context())).toBe(false);
    expect(screen.handleInput('down', router.context())).toBe(true);
    expect(screen.handleInput('down', router.context())).toBe(false);
    expect(screen.handleInput('enter', router.context())).toBe(true);
    expect(router.active?.id).toBe('run.detail');
    expect(router.context().params).toEqual({ ticketId: 'T1', runId: 'R2' });
    router.back();
    expect(router.active?.present(router.context()).selectedIndex).toBe(1);
    expect(router.active?.handleInput(' ', router.context())).toBe(true);
    expect(router.context().params?.runId).toBe('R2');
  });

  it.each([
    [
      'overview',
      'labels,parent_id,blocked_by,conductor_id,assignee_user_id,comments,owner_user_id,sub_tickets,referenced_tickets,reviewers,pending_reviews',
    ],
    ['planning', 'comments,labels'],
    ['comments', 'comments'],
    ['runs', 'runs'],
  ])('%s reads only its own includes', async (tab, includes) => {
    const queries: string[] = [];
    const screen = routes.routeForTab('ticket', tab)?.screen as
      | import('../../../../src/Screen/screen.js').Screen
      | undefined;
    expect(screen).toBeDefined();
    const ctx = {
      params: { ticketId: 'T1' },
      sessionGeneration: 5,
      requestDraw: vi.fn(),
      isActive: () => true,
      services: {
        client: {
          get: async (url: string) => {
            queries.push(url);
            return document;
          },
        },
      },
    } as unknown as ScreenContext;
    if (!screen) throw new Error('Missing ticket screen');
    screen.enter(ctx);
    await tick();
    // Overview also loads the inline addons card's own data alongside the
    // ticket fetch; the other tabs make exactly one request.
    const expected = [`bb_ticket/bb_ticket/T1?include=${includes}`];
    if (tab === 'overview') expected.push('bakers/addons/ticket/T1');
    expect(queries).toEqual(expected);
  });

  it('keeps the runs boot shortcut on the runs route', () => {
    expect(
      bootLocationFor({
        screen: 'ticket',
        ticketId: 'T1',
        view: 'full',
        tab: 'runs',
      }).routeId,
    ).toBe('ticket.runs');
  });
});

describe('ticket route state', () => {
  it('retains comments selection and expansion across sibling routes, but resets for a different ticket', async () => {
    const session = routes.createSession({});
    const runtime = {
      services: {
        client: {
          get: async (url: string) => ({
            ...document,
            data: { ...document.data, id: url.includes('/T2?') ? 'T2' : 'T1' },
          }),
        },
      },
    } as unknown as ScreenContext;
    const router = new Router(
      session.screens(),
      vi.fn(),
      1,
      runtime,
      session.navigation(),
    );
    router.navigate('ticket.comments', { ticketId: 'T1' });
    await tick();
    activeScreen(router).handleInput('down', router.context());
    activeScreen(router).handleInput(' ', router.context());
    const before = activeScreen(router).present(router.context());
    expect(before.selectedIndex).toBe(1);
    expect(before.rowIds).toHaveLength(2);
    router.navigateTab('ticket', 'overview');
    await tick();
    router.navigateTab('ticket', 'comments');
    await tick();
    const after = activeScreen(router).present(router.context());
    expect(after.selectedIndex).toBe(before.selectedIndex);
    expect(after.rowIds).toEqual(before.rowIds);
    router.navigate('ticket.comments', { ticketId: 'T2' });
    await tick();
    const next = activeScreen(router);
    expect(next.present(router.context()).selectedIndex).toBe(0);
    expect(
      (next as { document?: { data?: { id?: string } } }).document?.data?.id,
    ).toBe('T2');
  });

  it.each([
    'overview',
    'planning',
    'comments',
    'runs',
  ])('%s retains editing and ticket-copy behavior', (tab) => {
    const session = routes.createSession({});
    const copied: string[] = [];
    const runtime = {
      copyToClipboard: (value: string) => {
        copied.push(value);
        return 'copied';
      },
      services: { baseUrl: 'https://example.test' },
    } as unknown as ScreenContext;
    const router = new Router(
      session.screens(),
      vi.fn(),
      1,
      runtime,
      session.navigation(),
    );
    const id = tabRoute(tab);
    router.navigate(id, { ticketId: 'T1' }, false, { document });
    const screen = activeScreen(router);
    screen.handleInput('y', router.context());
    screen.handleInput('Y', router.context());
    expect(copied).toEqual([
      'TEST-1',
      'https://example.test/admin/bakers/ticket/T1',
    ]);
    const action = screen.actionForInput?.('e', router.context());
    expect(action).toMatchObject({
      type: 'navigate',
      routeId: 'ticket.assignment.edit',
    });
  });
});

function tabRoute(tab: string): string {
  return tab === 'overview' ? 'ticket.detail' : `ticket.${tab}`;
}

it('overview pipe retains state and labels while rendering only its own sections', () => {
  const router = setup();
  router.navigate('ticket.detail', { ticketId: 'T1' }, false, { document });
  const lines = router.active?.renderNonInteractive?.(router.context()) ?? [];
  expect(lines.slice(0, 6)).toEqual([
    'State',
    'coding',
    '',
    'Labels',
    'No labels.',
    '',
  ]);
  expect(lines).toContain('Description body');
  expect(lines).not.toContain('Comments');
  expect(lines).not.toContain('Runs');
});

function activeScreen(router: Router) {
  const screen = router.active;
  if (!screen) throw new Error('No active screen');
  return screen;
}

it('keeps compact ticket views on Overview even with a runs-tab hint', () => {
  expect(
    bootLocationFor({
      screen: 'ticket',
      ticketId: 'T1',
      view: 'teaser',
      tab: 'runs',
    }).routeId,
  ).toBe('ticket.detail');
});
