import { describe, expect, it, vi } from 'vitest';
import { TicketCommentsScreen } from '../../../../src/Entity/ticket/Screen/ticket-comments.js';
import { TicketPlanningScreen } from '../../../../src/Entity/ticket/Screen/ticket-planning.js';
import { messageTree } from '../../../../src/lib/vnode.js';
import type { RouteMetadata } from '../../../../src/Routing/route.js';
import { Router } from '../../../../src/Routing/router.js';
import { buildRoutes } from '../../../../src/Routing/routes.js';
import { AsyncScreen } from '../../../../src/Screen/async-screen.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import { BaseScreen, presentation } from '../../../../src/Screen/screen.js';
import type {
  JsonApiResource,
  TicketDetailDocument,
} from '../../../../src/types.js';

const routes = buildRoutes();

const TIED = '2026-07-21T10:00:00+00:00';

const comment = (fixture: {
  id: string;
  type: string;
  author?: string;
  created?: string;
  internalId?: number;
  body?: string;
}): JsonApiResource => ({
  type: 'bb_comment--bb_comment',
  id: fixture.id,
  attributes: {
    bb_comment_type: fixture.type,
    author_name: fixture.author ?? 'ann',
    ...(fixture.created === undefined ? {} : { created: fixture.created }),
    ...(fixture.internalId === undefined
      ? {}
      : { drupal_internal__id: fixture.internalId }),
    ...(fixture.body === undefined ? {} : { body: { value: fixture.body } }),
  },
});

const document: TicketDetailDocument = {
  data: {
    id: 'T1',
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'TEST-1',
      title: 'Ticket',
      state: 'coding',
    },
  },
  included: [
    comment({
      id: 'spec-old',
      type: 'spec',
      created: TIED,
      internalId: 10,
      body: 'OLDER-SPEC',
    }),
    comment({
      id: 'spec-new',
      type: 'spec',
      author: 'feat/a_b_c',
      created: TIED,
      internalId: 11,
      body: 'NEWER-SPEC',
    }),
    comment({
      id: 'plan-1',
      type: 'plan',
      author: 'ann',
      created: '2026-07-18T20:00:00Z',
      internalId: 5,
      body: 'Step one.',
    }),
    comment({
      id: 'test-1',
      type: 'test',
      author: 'ann',
      created: '2026-07-18T20:00:00Z',
      internalId: 6,
      body: 'Assert the outcome.',
    }),
    comment({
      id: 'hand',
      type: 'summary',
      created: '2026-07-22T10:00:00Z',
      internalId: 12,
      body: 'NOT-A-SPEC',
    }),
    comment({
      id: 'specs',
      type: 'specs',
      created: '2026-07-22T11:00:00Z',
      internalId: 13,
      body: 'TYPO-SPEC',
    }),
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

class ExampleScreen extends BaseScreen {
  static readonly route = {
    id: 'ticket.example',
    path: '/tickets/:ticketId/example',
    parent: 'project.tickets',
    tab: { id: 'example', label: 'Example', scope: 'ticket', weight: 50 },
  } satisfies RouteMetadata;
  readonly id = 'ticket.example';
  present() {
    return presentation(messageTree(this.id, ['example']));
  }
}

describe('Planning route', () => {
  it('registers the Planning contract beside the other ticket screens', () => {
    expect(TicketPlanningScreen.route).toEqual({
      id: 'ticket.planning',
      path: '/tickets/:ticketId/planning',
      parent: 'project.tickets',
      tab: { id: 'planning', label: 'Planning', scope: 'ticket', weight: 15 },
      fallback: { routeId: 'my.work' },
      context: TicketPlanningScreen.route.context,
    });
    expect(new TicketPlanningScreen()).toBeInstanceOf(AsyncScreen);
    expect(routes.get('ticket.planning')?.screen).toBeInstanceOf(AsyncScreen);
    expect(routes.get('ticket.planning')?.metadata.path).toBe(
      '/tickets/:ticketId/planning',
    );
  });

  it('orders Overview, Planning, History, Runs', () => {
    expect(routes.tabs('ticket').map((tab) => [tab.id, tab.label])).toEqual([
      ['overview', 'Overview'],
      ['planning', 'Planning'],
      ['comments', 'History'],
      ['runs', 'Runs'],
    ]);
  });

  it('keeps Comments route id and path while renaming the label', () => {
    expect(TicketCommentsScreen.route.id).toBe('ticket.comments');
    expect(TicketCommentsScreen.route.path).toBe('/tickets/:ticketId/comments');
    expect(TicketCommentsScreen.route.tab).toMatchObject({
      id: 'comments',
      label: 'History',
    });
    const router = setup();
    router.navigate('ticket.comments', { ticketId: 'T1' }, false, { document });
    expect(router.active?.id).toBe('ticket.comments');
    expect(router.context().params?.ticketId).toBe('T1');
  });

  it('keeps Agents and contributed tabs discoverable', () => {
    expect(routes.get('project.ticket-agents')?.metadata.tab).toMatchObject({
      id: 'ticket-agents',
      label: 'Ticket-Agents',
      scope: 'project',
    });
    expect(routes.tabs('project').map((tab) => tab.id)).toContain(
      'ticket-agents',
    );
    const registry = buildRoutes([ExampleScreen]);
    expect(registry.tabs('ticket').map((tab) => tab.id)).toEqual([
      'overview',
      'planning',
      'comments',
      'runs',
      'example',
    ]);
    const session = registry.createSession({});
    const router = new Router(
      session.screens(),
      vi.fn(),
      1,
      {},
      session.navigation(),
    );
    router.navigate('ticket.detail', { ticketId: 'T1' }, false);
    expect(router.navigateTab('ticket', 'example')).toBe(true);
    expect(router.active?.id).toBe('ticket.example');
  });

  it('reads comments and labels only', async () => {
    const queries: string[] = [];
    const screen = new TicketPlanningScreen();
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
    screen.enter(ctx);
    await tick();
    expect(queries).toEqual(['bb_ticket/bb_ticket/T1?include=comments,labels']);
  });
});

describe('Planning documents', () => {
  it('pipes the newest exact-type spec, plan and test with author and time', () => {
    const router = setup();
    router.navigate('ticket.planning', { ticketId: 'T1' }, false, { document });
    const lines = router.active?.renderNonInteractive?.(router.context()) ?? [];
    const text = lines.join('\n');
    expect(lines).toContain('Latest spec');
    expect(lines).toContain('Latest plan');
    expect(lines).toContain('Latest test');
    expect(text).toContain('NEWER-SPEC');
    expect(text).toContain('Step one.');
    expect(text).toContain('Assert the outcome.');
    expect(text).not.toContain('OLDER-SPEC');
    expect(text).not.toContain('NOT-A-SPEC');
    expect(text).not.toContain('TYPO-SPEC');
  });

  it('names missing spec, plan and test documents', () => {
    const router = setup();
    router.navigate('ticket.planning', { ticketId: 'T1' }, false, {
      document: { ...document, included: [] },
    });
    const lines = router.active?.renderNonInteractive?.(router.context()) ?? [];
    expect(lines).toContain('Latest spec');
    expect(lines).toContain('No spec comment.');
    expect(lines).toContain('Latest plan');
    expect(lines).toContain('No plan comment.');
    expect(lines).toContain('Latest test');
    expect(lines).toContain('No test comment.');
  });
});
