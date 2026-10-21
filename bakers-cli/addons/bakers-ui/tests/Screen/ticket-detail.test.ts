import { describe, expect, it, vi } from 'vitest';
import { formatActionLadder } from '../../src/Component/footer-actions/index.js';
import type { TicketContentProps } from '../../src/Entity/ticket/Component/ticket-content/index.js';
import { ticketContentRowId } from '../../src/Entity/ticket/Component/ticket-content/model.js';
import type { TicketCommentsScreen } from '../../src/Entity/ticket/Screen/ticket-comments.js';
import {
  TicketDetailScreen,
  ticketDetailInputContext,
} from '../../src/Entity/ticket/Screen/ticket-detail.js';
import { TicketRunsScreen } from '../../src/Entity/ticket/Screen/ticket-runs.js';
import { messageTree } from '../../src/lib/vnode.js';
import { ContextBag } from '../../src/Routing/context.js';
import type { RouteMetadata } from '../../src/Routing/route.js';
import { Router } from '../../src/Routing/router.js';
import { buildRoutes } from '../../src/Routing/routes.js';
import { BaseScreen, presentation } from '../../src/Screen/screen.js';

const routes = buildRoutes();

import type { ScreenContext } from '../../src/Screen/screen.js';
import type { TicketDetailDocument } from '../../src/types.js';
import { childrenOf, idsOf, renderTree } from '../render-tree.js';
import { fakeClient } from '../test-support.js';

/**
 * WHICH SECTION IS OPEN — BB-346, and no longer a rendered bar.
 *
 * This used to read the detail bar's text out of the header tree by its node id
 * and look for `[Overview]`. There is no such bar: the sections are entries of
 * the top-tab registry and the CHROME draws them, so what the screen publishes
 * is a route. Asking the registry is the same question one indirection
 * closer to the source — and it is what the chrome reads to draw the bar, so a
 * case that passes here cannot disagree with the bar on screen.
 */
const openSection = (
  screen: TicketDetailScreen | TicketRunsScreen | TicketCommentsScreen,
): string | undefined => routes.tabLocation(screen.id, {})?.tab;

const contentOf = (
  screen: TicketDetailScreen,
  context: ScreenContext,
): TicketContentProps => screen.contentProps(context);

const expandedKeysOf = (screen: TicketDetailScreen, ctx: ScreenContext) => [
  ...contentOf(screen, ctx).expandedKeys,
];

const document: TicketDetailDocument = {
  data: {
    type: 'bb_ticket--bb_ticket',
    id: 'ticket-1',
    // BB-369 AC-1 — a real workflow state, so the header's state row asserts
    // the ticket's value rather than the `—` an absent attribute would give.
    attributes: {
      identifier: 'BB-1',
      title: 'Owned detail state',
      state: 'coding',
    },
  },
  included: [
    {
      type: 'bb_run--bb_run',
      id: 'run-1',
      attributes: { status: 'running', state: 'running' },
    },
  ],
};

const context = (navigate = vi.fn()): ScreenContext => ({
  sessionGeneration: 1,
  requestDraw: vi.fn(),
  isActive: () => true,
  params: { ticketId: 'ticket-1' },
  contexts: ContextBag.empty().set(ticketDetailInputContext, { document }),
  navigate,
  nowSeconds: () => 0,
});

describe('TicketDetailScreen interaction ownership', () => {
  // Overview owns only its own selection and expansion.
  it('owns overview selection and expansion', () => {
    const screen = new TicketDetailScreen();
    const ctx = context();
    screen.enter(ctx);
    expect(openSection(screen)).toBe('overview');
    const before = contentOf(screen, ctx);
    expect(screen.present(ctx).rowIds).toEqual(
      before.model.selectableKeys.map(ticketContentRowId),
    );
    expect(screen.activate(0, ctx)).toBe(true);
    const after = contentOf(screen, ctx);
    expect([...after.expandedKeys]).not.toEqual([...before.expandedKeys]);
    expect(after.selectedKey).toBe(after.model.selectableKeys[0]);
  });

  it('opens Overview with the description already expanded, and re-seeds per ticket', () => {
    const screen = new TicketDetailScreen();
    const ctx = context();
    screen.enter(ctx);

    expect(expandedKeysOf(screen, ctx)).toEqual(['section:Description']);

    // Collapse, then expand again: the seed is a starting point, not a lock.
    screen.activate(0, ctx);
    expect(expandedKeysOf(screen, ctx)).toEqual([]);
    screen.activate(0, ctx);
    expect(expandedKeysOf(screen, ctx)).toEqual(['section:Description']);

    // A different ticket re-seeds: the controller keys its initialisation on
    // the document id, so a collapse the operator made on one ticket does not
    // travel to the next one they open.
    screen.activate(0, ctx);
    expect(expandedKeysOf(screen, ctx)).toEqual([]);
    const other: TicketDetailDocument = {
      data: {
        type: 'bb_ticket--bb_ticket',
        id: 'ticket-2',
        attributes: {
          identifier: 'BB-2',
          title: 'A second ticket',
          state: 'coding',
        },
      },
    };
    const otherCtx: ScreenContext = {
      ...context(),
      params: { ticketId: 'ticket-2' },
      contexts: ContextBag.empty().set(ticketDetailInputContext, {
        document: other,
      }),
    };
    screen.enter(otherCtx);
    expect(expandedKeysOf(screen, otherCtx)).toEqual(['section:Description']);
  });

  // BB-346 R1 — the Tab key belongs to the kernel now. A screen that still
  // reported it handled would swallow it before the kernel's branch ran, and the
  // seam would be dead code on the key path.
  it('leaves Tab and Shift-Tab to the kernel', () => {
    const screen = new TicketDetailScreen();
    const ctx = context();
    screen.enter(ctx);

    expect(screen.handleInput('tab', ctx)).toBe(false);
    expect(screen.handleInput('shift+tab', ctx)).toBe(false);
    expect(openSection(screen), 'and neither moved the section').toBe(
      'overview',
    );
  });

  it('navigates the selected sideloaded run without a controller callback', () => {
    const navigate = vi.fn();
    const screen = new TicketRunsScreen();
    const ctx = context(navigate);
    screen.enter(ctx);

    expect(screen.activate(0, ctx)).toBe(true);
    expect(navigate).toHaveBeenCalledWith(
      'run.detail',
      { ticketId: 'ticket-1', runId: 'run-1' },
      document,
    );
  });

  it('keeps e as ticket editing on the Runs tab', () => {
    const navigate = vi.fn();
    const screen = new TicketRunsScreen();
    const ctx = context(navigate);

    screen.enter(ctx);

    expect(screen.commandForInput?.('e')).toBe('edit-assignment');
    expect(screen.actionForInput?.('e', ctx)?.routeId).toBe(
      'ticket.assignment.edit',
    );
  });

  it('repaints the run row on a cancellation result reaching the Runs tab', () => {
    const screen = new TicketRunsScreen();
    const ctx = context();
    screen.enter(ctx);

    const cancelledDocument: TicketDetailDocument = {
      ...document,
      included: [
        {
          type: 'bb_run--bb_run',
          id: 'run-1',
          attributes: { status: 'cancelled', state: 'cancelled' },
        },
      ],
    };
    screen.receiveResult(
      { type: 'run-cancelled', document: cancelledDocument },
      ctx,
    );

    expect(screen.document?.included?.[0]?.attributes?.state).toBe('cancelled');
    expect(ctx.requestDraw).toHaveBeenCalled();
  });

  it('resets all destination-local state', () => {
    const screen = new TicketDetailScreen();
    const ctx = context();
    screen.enter(ctx);
    screen.select(4, ctx);
    screen.reset();
    screen.enter(ctx);
    expect(screen.present(ctx).selectedIndex).toBe(0);
    expect(openSection(screen)).toBe('overview');
  });
});

// BB-661 D1/D2 — the inline addons card's keyboard reach and the preview
// loader's error handling.
describe('TicketDetailScreen inline addons card (BB-661)', () => {
  const addonsDoc = {
    data: {
      type: 'bakers-addons',
      id: 'ticket-1',
      attributes: {
        conductor: { status: 'online' },
        addons: [
          {
            id: 'a1',
            name: 'ports',
            version: '1',
            contract: 2,
            label: 'Ports',
            messages: [
              {
                key: 'tunnel',
                label: 'Share tunnel',
                input: null,
                access: 'view',
                access_ok: true,
              },
            ],
            latest: null,
          },
        ],
      },
    },
  };

  it('reaches the inline card by keyboard and opens the full screen on Enter', async () => {
    const navigate = vi.fn();
    const client = fakeClient({
      documents: { 'bakers/addons/ticket/': addonsDoc },
    });
    const screen = new TicketDetailScreen();
    const ctx: ScreenContext = {
      ...context(navigate),
      services: { client },
    };
    screen.enter(ctx);
    // readTicketAddons() resolves on a later microtask; let it settle.
    await Promise.resolve();
    await Promise.resolve();

    const baseKeys = contentOf(screen, ctx).model.selectableKeys;
    const addonsIndex = baseKeys.length;
    expect(screen.select(addonsIndex, ctx)).toBe(true);
    expect(screen.activate(addonsIndex, ctx)).toBe(true);
    expect(navigate).toHaveBeenCalledWith('ticket.addons', {
      ticketId: 'ticket-1',
    });
  });

  it('does not reject when the addons preview fetch fails', async () => {
    const client = fakeClient({ failingPaths: ['bakers/addons/ticket/'] });
    const screen = new TicketDetailScreen();
    const ctx: ScreenContext = { ...context(), services: { client } };
    screen.enter(ctx);
    await Promise.resolve();
    await Promise.resolve();
    // No addons key was added: a failed fetch leaves the card absent rather
    // than throwing an unhandled rejection.
    expect(contentOf(screen, ctx).addonsPreview).toBeUndefined();
  });
});

function freezableScreen(
  attributes: Record<string, unknown>,
  options: { writeError?: unknown } = {},
) {
  const seeded: TicketDetailDocument = {
    data: { type: 'bb_ticket--bb_ticket', id: 'ticket-1', attributes },
  };
  const read = fakeClient({ documents: { 'bb_ticket/bb_ticket': seeded } });
  const write = fakeClient(
    options.writeError !== undefined ? { writeError: options.writeError } : {},
  );
  const screen = new TicketDetailScreen();
  const ctx: ScreenContext = {
    sessionGeneration: 1,
    requestDraw: vi.fn(),
    isActive: () => true,
    params: { ticketId: 'ticket-1' },
    contexts: ContextBag.empty().set(ticketDetailInputContext, {
      document: seeded,
    }),
    services: { client: read, writeClient: write },
    nowSeconds: () => 0,
  };
  screen.enter(ctx);
  return { screen, ctx, read, write };
}

describe('freezing a ticket from the cockpit', () => {
  it('f toggles the freeze flag through the write client', async () => {
    const { screen, ctx, read, write } = freezableScreen({
      identifier: 'BB-302',
      title: 'T',
      state: 'spec',
      frozen: false,
    });

    expect(screen.handleInput('f', ctx)).toBe(true);
    await vi.waitFor(() => expect(write.writes).toHaveLength(1));

    expect(write.writes[0]?.type).toBe('bb_ticket--bb_ticket');
    expect(write.writes[0]?.id).toBe('ticket-1');
    expect(write.writes[0]?.body).toMatchObject({
      attributes: { frozen: true },
    });
    await vi.waitFor(() =>
      expect(
        read.gets.some((path) => path.startsWith('bb_ticket/bb_ticket/')),
      ).toBe(true),
    );
  });

  it('f on a frozen ticket clears the hold, and the footer names the direction', async () => {
    const { screen, ctx, write } = freezableScreen({
      identifier: 'BB-302',
      title: 'T',
      state: 'spec',
      frozen: true,
    });

    expect(formatActionLadder(screen.present(ctx).actions)).toContain(
      'f unfreeze',
    );
    expect(screen.handleInput('f', ctx)).toBe(true);
    await vi.waitFor(() => expect(write.writes).toHaveLength(1));
    expect(write.writes[0]?.body).toMatchObject({
      attributes: { frozen: false },
    });
  });

  it('the footer offers f freeze while the ticket is not held', () => {
    const { screen, ctx } = freezableScreen({
      identifier: 'BB-302',
      title: 'T',
      frozen: false,
    });
    expect(formatActionLadder(screen.present(ctx).actions)).toContain(
      'f freeze',
    );
  });

  it('a refused write reaches the status line instead of reading as saved', async () => {
    const { screen, ctx } = freezableScreen(
      { identifier: 'BB-302', title: 'T', frozen: false },
      {
        writeError: {
          status: 403,
          body: {
            errors: [
              { detail: 'You are not authorized to update this ticket.' },
            ],
          },
        },
      },
    );

    expect(screen.handleInput('f', ctx)).toBe(true);
    await vi.waitFor(() =>
      expect(screen.present(ctx).status).toContain('not authorized'),
    );
    expect(formatActionLadder(screen.present(ctx).actions)).not.toContain(
      'f unfreeze',
    );
  });
});

// BB-346 — the ticket detail names its LEVEL instead of drawing a bar.
describe('TicketDetailScreen publishes the ticket tab level', () => {
  const readyScreen = (view?: string): TicketDetailScreen => {
    const screen = new TicketDetailScreen();
    const ctx = context();
    screen.enter(
      view === undefined ? ctx : { ...ctx, params: { ...ctx.params, view } },
    );
    return screen;
  };

  it('publishes overview while the router owns the other destinations', () => {
    const screen = readyScreen();
    expect(routes.tabLocation(screen.id, {})).toMatchObject({
      level: 'ticket',
      tab: 'overview',
    });
    const session = routes.createSession({});
    const router = new Router(
      session.screens(),
      vi.fn(),
      1,
      {},
      session.navigation(),
    );
    router.navigate('ticket.detail', { ticketId: 'ticket-1' }, false, {
      document,
    });
    for (const tab of ['planning', 'comments', 'runs', 'overview']) {
      expect(router.navigateTab('ticket', tab)).toBe(true);
      expect(router.active?.id).toBe(
        tab === 'overview' ? 'ticket.detail' : `ticket.${tab}`,
      );
    }
    expect(router.navigateTab('ticket', 'ticket-agents')).toBe(false);
  });

  // Two-line header: title + meta (state · assignee · labels). Extra identity
  // rows were removed; geometry is now `chromeHeight` from the two-row header.
  it('draws the meta line with state and assignee under the title', () => {
    const screen = readyScreen();
    const header = screen.present(context()).header;
    expect(header).toBeDefined();
    const rows = childrenOf(header as NonNullable<typeof header>);
    // Two header rows: title + meta.
    expect(rows).toHaveLength(2);
    expect(idsOf(rows[0] as NonNullable<typeof header>)).toEqual([
      'ticket-detail-header-title',
    ]);
    expect(idsOf(rows[1] as NonNullable<typeof header>)).toEqual([
      'ticket-detail-header-meta',
    ]);
    // Meta line carries state without a 'State:' prefix, no 'Assigned:' or
    // 'Created by:' labels.
    const metaText = renderTree(rows[1] as NonNullable<typeof header>).join('');
    expect(metaText).toContain('coding');
    expect(metaText).not.toContain('State:');
    expect(metaText).not.toContain('Assigned:');
    expect(metaText).not.toContain('Created by:');
    // Screen keys live in footer `actions` (BB-375), not on the meta row.
    expect(formatActionLadder(screen.present(context()).actions)).toContain(
      'Tab section',
    );
  });

  // BB-369 D2 — `headerTree` is shared by all three view modes. The compact
  // views append their own mode row as the last (third) row.
  it('carries the state on the meta line in the compact views too', () => {
    for (const view of ['teaser', 'board_card']) {
      const shown = readyScreen(view).present(context());
      const header = shown.header;
      const rows = childrenOf(header as NonNullable<typeof header>);
      // rows[1] is the meta line carrying the state without a prefix.
      expect(
        renderTree(rows[1] as NonNullable<typeof header>).join(''),
        `${view} keeps the state on the meta line`,
      ).toContain('coding');
      // Three rows: title, meta, mode — the mode row is last.
      expect(rows, `${view} still has its own mode row last`).toHaveLength(3);
      expect(idsOf(shown.body), `${view} keeps the compact block`).toContain(
        'ticket-teaser',
      );
    }
  });

  // R4 — BB-239 removed a bar from the compact views and this must not put one
  // back: they have no sections at all.
  it('draws no bar at all in the compact views', () => {
    expect(
      routes.tabLocation(readyScreen('teaser').id, { view: 'teaser' }),
    ).toBeNull();
    expect(
      routes.tabLocation(readyScreen('board_card').id, { view: 'board_card' }),
    ).toBeNull();
  });
});
// Contribution navigation is a router responsibility; content and keys belong
// to the registered screen. A fake addon proves this without special host code.
class ExampleScreen extends BaseScreen {
  static readonly route = {
    id: 'ticket.example',
    path: '/tickets/:ticketId/example',
    parent: 'project.tickets',
    tab: { id: 'example', label: 'Example', scope: 'ticket', weight: 50 },
  } satisfies RouteMetadata;
  readonly id = 'ticket.example';
  present() {
    return presentation(
      messageTree(this.id, ['vitest', 'pnpm vitest run — 12 passed']),
    );
  }
  handleInput(input: string) {
    return input === 'z';
  }
}

describe('contributed screens join the ticket routes', () => {
  function harness() {
    const registry = buildRoutes([ExampleScreen]);
    const session = registry.createSession({});
    const router = new Router(
      session.screens(),
      vi.fn(),
      1,
      {
        services: {
          client: { get: vi.fn(async () => document), collection: vi.fn() },
        },
      } as Pick<ScreenContext, 'services'>,
      session.navigation(),
    );
    return { registry, session, router };
  }

  it('appends the contributed route after the built-in tabs', () => {
    expect(
      harness()
        .registry.tabs('ticket')
        .map((tab) => tab.id),
    ).toEqual(['overview', 'planning', 'comments', 'runs', 'example']);
  });

  it('opens the same registered instance without growing tab history', () => {
    const { router, session } = harness();
    router.navigate('ticket.detail', { ticketId: 'ticket-1' }, false);
    expect(router.navigateTab('ticket', 'example')).toBe(true);
    expect(router.active).toBe(session.screen('ticket.example'));
    expect(router.context().params?.ticketId).toBe('ticket-1');
    expect(router.active?.handleInput('z', router.context())).toBe(true);
    expect(router.historyForTest()).toEqual([]);
    expect(router.navigateTab('ticket', 'overview')).toBe(true);
    expect(router.active).toBe(session.screen('ticket.detail'));
  });

  it('keeps Overview expansion across a round trip through an addon', async () => {
    const { router } = harness();
    router.navigate('ticket.detail', { ticketId: 'ticket-1' }, false);
    await Promise.resolve();
    const overview = router.active as TicketDetailScreen;
    overview.activate(0, router.context());
    const expanded = expandedKeysOf(overview, router.context());
    router.navigateTab('ticket', 'example');
    router.navigateTab('ticket', 'overview');
    await Promise.resolve();
    const active = router.active as TicketDetailScreen;
    expect(expandedKeysOf(active, router.context())).toEqual(expanded);
  });

  it('renders only the contributed screen content on that route', () => {
    const { router } = harness();
    router.navigate('ticket.example', { ticketId: 'ticket-1' }, false);
    const active = router.active;
    if (!active) throw new Error('Expected the contributed route to be active');
    expect(renderTree(active.present(router.context()).body)).toEqual([
      'vitest',
      'pnpm vitest run — 12 passed',
    ]);
  });

  it('leaves the four built-in destinations when no addon is registered', () => {
    expect(
      buildRoutes()
        .tabs('ticket')
        .map((tab) => tab.id),
    ).toEqual(['overview', 'planning', 'comments', 'runs']);
    expect(buildRoutes().routeForTab('ticket', 'example')).toBeUndefined();
  });
});
