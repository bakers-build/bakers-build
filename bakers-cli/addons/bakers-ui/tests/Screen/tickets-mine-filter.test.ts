import { describe, expect, it, vi } from 'vitest';
import { TicketsScreen } from '../../src/Entity/ticket/Screen/tickets.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import { nodeById, renderTree } from '../render-tree.js';

// BB-287 — the mine toggle: `m` switches the who criterion to the resolved
// current user and back (D1/D3). The resolution read is asserted as its own
// request: the first `m` asks `user/user` for the EXACT name, every later
// `m` reuses the cached candidate (D5).

const PROJECT = { id: 'project-1', name: 'Bb', slug: 'bakers' };
const ME = { id: 'user-cw', label: 'cw' };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const ticket = (id: string, identifier: string, assigneeId?: string) => ({
  type: 'bb_ticket--bb_ticket',
  id,
  attributes: { identifier, title: `title of ${identifier}`, state: 'coding' },
  relationships: {
    assignee_user_id: {
      data: assigneeId === undefined ? null : { id: assigneeId },
    },
  },
});

// BB-300/301 are cw's; BB-400 is someone else's, BB-401 nobody's.
const TICKETS = {
  data: [
    ticket('t1', 'BB-300', 'user-cw'),
    ticket('t2', 'BB-301', 'user-cw'),
    ticket('t3', 'BB-400', 'user-tm'),
    ticket('t4', 'BB-401'),
  ],
  included: [],
};

const USERS = {
  data: [
    {
      id: 'user-cw',
      type: 'user--user',
      attributes: { display_name: 'cw', name: 'cw', drupal_internal__uid: 2 },
    },
  ],
};

interface RecordedGet {
  path: string;
  params: unknown;
}

function harness(
  options: { currentUser?: string; users?: unknown; usersFail?: boolean } = {},
) {
  const requests: RecordedGet[] = [];
  const context: ScreenContext = {
    sessionGeneration: 1,
    project: PROJECT,
    params: { projectId: PROJECT.id },
    services: {
      client: {
        get: async (path: string, params?: unknown) => {
          requests.push({ path, params });
          if (path === 'user/user') {
            if (options.usersFail) throw new Error('no user/user');
            return options.users ?? USERS;
          }
          return TICKETS;
        },
        collection: vi.fn(),
      },
      ...(options.currentUser === undefined
        ? {}
        : { currentUser: options.currentUser }),
    },
    requestDraw: vi.fn(),
    isActive: () => true,
    navigate: vi.fn(),
  };
  return { context, requests };
}

const queryOf = (params: unknown): string =>
  decodeURIComponent((params as { getQueryString(): string }).getQueryString());

// BB-340 Task 7 — the list hands over a renderable TREE, so the text it shows
// is read out of the tree rather than off a row surface it no longer has.
const rendered = (screen: TicketsScreen, context: ScreenContext): string =>
  renderTree(screen.present(context).body).join('\n');

async function open(options: Parameters<typeof harness>[0] = {}) {
  const screen = new TicketsScreen();
  const { context, requests } = harness({ currentUser: 'cw', ...options });
  screen.enter(context);
  await tick();
  return { screen, context, requests };
}

const userReads = (requests: RecordedGet[]) =>
  requests.filter((r) => r.path === 'user/user');
const ticketQueries = (requests: RecordedGet[]) =>
  requests.filter((r) => r.path !== 'user/user').map((r) => queryOf(r.params));

describe('Tickets screen — the mine filter (BB-287)', () => {
  it('first `m` resolves me EXACTLY and reloads to only my tickets (AC-1, AC-6)', async () => {
    const { screen, context, requests } = await open();
    expect(screen.handleInput('m', context)).toBe(true);
    await tick();
    // One exact-name user read, then the reload filters on MY uuid, top level.
    expect(userReads(requests)).toHaveLength(1);
    expect(queryOf(userReads(requests)[0]?.params)).toContain(
      'filter[name]=cw',
    );
    const last = ticketQueries(requests).at(-1) ?? '';
    expect(last).toContain('filter[assignee_user_id.id]=user-cw');
    const frame = rendered(screen, context);
    expect(frame).toContain('BB-300');
    expect(frame).toContain('BB-301');
    expect(frame).not.toContain('BB-400');
    expect(frame).not.toContain('BB-401');
    // AC-4 — the filter section names it through the who segment, by LABEL (D7).
    expect(rendered(screen, context)).toContain('who: cw');
    expect(screen.present(context).meta ?? '').not.toContain('who:');
    const body = screen.present(context).body;
    expect(
      renderTree(nodeById(body, 'tickets-filter-who-chip')!).join(''),
    ).toBe('w who: cw');
    expect(
      renderTree(nodeById(body, 'tickets-filter-mine-chip')!).join(''),
    ).toBe('m mine');
  });

  it('`m` again clears the filter and the hidden tickets return (AC-2)', async () => {
    const { screen, context, requests } = await open();
    screen.handleInput('m', context);
    await tick();
    screen.handleInput('m', context);
    await tick();
    // The cached resolution is reused — still ONE user read (D5).
    expect(userReads(requests)).toHaveLength(1);
    const last = ticketQueries(requests).at(-1) ?? '';
    expect(last).not.toContain('filter[assignee_user_id.id]');
    expect(rendered(screen, context)).toContain('BB-400');
  });

  it('mine combines as an AND with the state cycle (AC-3)', async () => {
    const { screen, context, requests } = await open();
    screen.handleInput('m', context);
    await tick();
    screen.handleInput('s', context); // null → triage
    await tick();
    const last = ticketQueries(requests).at(-1) ?? '';
    expect(last).toContain('filter[assignee_user_id.id]=user-cw');
    expect(last).toContain('filter[state]=triage');
  });

  it('`m` after a who pick of someone else switches to ME (D3)', async () => {
    const { screen, context, requests } = await open();
    screen.receiveResult(
      { type: 'who-filter-set', who: { id: 'user-tm', label: 'tm' } },
      context,
    );
    await tick();
    screen.handleInput('m', context);
    await tick();
    const last = ticketQueries(requests).at(-1) ?? '';
    expect(last).toContain('filter[assignee_user_id.id]=user-cw');
    expect(rendered(screen, context)).toContain('who: cw');
    expect(screen.present(context).meta ?? '').not.toContain('who:');
  });

  it('`c` after mine clears everything, the criterion included (AC-5)', async () => {
    const { screen, context, requests } = await open();
    screen.handleInput('m', context);
    await tick();
    screen.handleInput('c', context);
    await tick();
    const last = ticketQueries(requests).at(-1) ?? '';
    expect(last).not.toContain('filter[assignee_user_id.id]');
    expect(rendered(screen, context)).toContain('BB-400');
    expect(rendered(screen, context)).not.toContain('who:');
  });

  it('the mine criterion survives saveState/restoreState (AC-7)', async () => {
    const { screen, context } = await open();
    screen.handleInput('m', context);
    await tick();
    const token = screen.saveState();
    expect(token.criteria.who).toEqual(ME);
    const restored = new TicketsScreen();
    const { context: context2 } = harness({ currentUser: 'cw' });
    restored.restoreState(token);
    expect(rendered(restored, context2)).toContain('who: cw');
    expect(restored.present(context2).meta ?? '').not.toContain('who:');
  });

  it('no currentUser: a status, no read, no criterion (AC-8)', async () => {
    const { screen, context, requests } = await open({
      currentUser: undefined,
    });
    const before = requests.length;
    screen.handleInput('m', context);
    await tick();
    expect(requests).toHaveLength(before);
    expect(screen.present(context).status).toContain('mine: no current user');
    expect(rendered(screen, context)).toContain('BB-400');
  });

  it('a failing resolution is a status and is NOT cached — the next `m` retries (D5/D6)', async () => {
    const { screen, context, requests } = await open({ usersFail: true });
    screen.handleInput('m', context);
    await tick();
    expect(screen.present(context).status).toContain('mine: no user/user');
    expect(rendered(screen, context)).toContain('BB-400');
    screen.handleInput('m', context);
    await tick();
    expect(userReads(requests)).toHaveLength(2);
  });

  it('an unknown user is a status and IS cached — no second read (D5/D6)', async () => {
    const { screen, context, requests } = await open({ users: { data: [] } });
    screen.handleInput('m', context);
    await tick();
    expect(screen.present(context).status).toContain("mine: 'cw' not found");
    expect(rendered(screen, context)).toContain('BB-400');
    screen.handleInput('m', context);
    await tick();
    expect(userReads(requests)).toHaveLength(1);
  });

  it('the filter strip names `m mine` beside `w who`', async () => {
    const { screen, context } = await open();
    const shown = screen.present(context);
    const body = renderTree(shown.body).join('\n');
    expect(body).toContain('m mine');
    expect(body).toContain('w who');
    expect(shown.meta ?? '').not.toContain('m mine');
    expect(
      renderTree(nodeById(shown.body, 'tickets-filter-mine-chip')!).join(''),
    ).toBe('m mine');
    expect(
      renderTree(nodeById(shown.body, 'tickets-filter-who-chip')!).join(''),
    ).toBe('w who');
  });
});
