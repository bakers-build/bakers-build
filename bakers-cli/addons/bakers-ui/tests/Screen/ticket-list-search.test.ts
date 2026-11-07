import { describe, expect, it, vi } from 'vitest';
import { ConductorTicketsScreen } from '../../src/Entity/ticket/Screen/conductor-tickets.js';
import { MyWorkScreen } from '../../src/Entity/ticket/Screen/my-work.js';
import { TicketsScreen } from '../../src/Entity/ticket/Screen/tickets.js';
import { WorkspaceMemberTicketsScreen } from '../../src/Entity/ticket/Screen/user-tickets.js';
import type { Screen, ScreenContext } from '../../src/Screen/screen.js';
import type { TuiOptions } from '../../src/types.js';
import { renderTree } from '../render-tree.js';

// Every terminal ticket list opens the SAME `/` search: the typed line goes to
// the server as `filter[search]`, and a refusal (an unknown origin alias) is
// the server's sentence with no rows beneath it — on every list, not only on
// Project → Tickets.

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => {
  for (let i = 0; i < 30; i++) await tick();
};
const immediate = (fn: () => void): (() => void) => {
  fn();
  return () => {};
};

const USER = 'user-1';
const REFUSAL = 'No repository matches "foo". Known in your projects: bakers.';

/** `crash after foo#1` survives a local narrowing on `foo#1`, so only an
 *  emptied list proves the refusal replaced the optimistic rows. */
const WORLD = [
  { id: 't1', identifier: 'BB-201', title: 'an open ticket' },
  { id: 't2', identifier: 'BB-202', title: 'another open ticket' },
  { id: 't9', identifier: 'BB-9', title: 'crash after foo#1' },
];

/** Server match for `bakers#19` whose identifier and title omit that text, so a
 *  client re-filter on the typed line cannot reproduce the hit. */
const ORIGIN = { id: 't7', identifier: 'BB-7', title: 'from origin 19' };

const searchValue = (query: string): string | undefined =>
  /filter\[search\]=([^&]*)/.exec(query)?.[1];

function harness(params: Record<string, string>) {
  const ticketQueries: string[] = [];
  const get = async (path: string, request?: unknown) => {
    const query = decodeURIComponent(
      (
        request as { getQueryString?(): string } | undefined
      )?.getQueryString?.() ?? '',
    );
    if (path === 'user/user')
      return {
        data: [{ id: USER, attributes: { name: 'cw', display_name: 'cw' } }],
      };
    if (path === 'og_membership/default')
      return {
        data: [
          {
            id: 'm1',
            attributes: { entity_id: '7' },
            relationships: { uid: { data: { id: USER } } },
          },
        ],
      };
    if (path === 'bb_project/bb_project') return { data: [{ id: 'p1' }] };
    if (path !== 'bb_ticket/bb_ticket') return { data: [] };
    ticketQueries.push(query);
    const search = searchValue(query);
    if (search?.startsWith('foo#'))
      throw Object.assign(new Error('HTTP 400'), {
        status: 400,
        body: { errors: [{ detail: REFUSAL }] },
      });
    const rows =
      search === 'bakers#19' || search === '#19'
        ? [ORIGIN]
        : WORLD.filter(
            (row) =>
              !search ||
              row.identifier.toLowerCase().includes(search.toLowerCase()) ||
              row.title.toLowerCase().includes(search.toLowerCase()),
          );
    return {
      data: rows.map((row) => ({
        id: row.id,
        type: 'bb_ticket--bb_ticket',
        attributes: {
          identifier: row.identifier,
          title: row.title,
          state: 'coding',
          closed: false,
          derived_status: 'running',
        },
        relationships: {
          labels: { data: [] },
          assignee_user_id: { data: { id: USER } },
        },
      })),
      meta: { count: rows.length },
      links: { self: {} },
    };
  };
  const first = { attr: () => 7 };
  const collection = {
    where: () => collection,
    sort: () => collection,
    page: () => collection,
    first: async () => first,
    list: async () => [],
  };
  const context = {
    sessionGeneration: 1,
    project: { id: 'p1', name: 'Bb', slug: 'bakers' },
    params,
    options: { debounce: immediate } as TuiOptions,
    services: {
      client: { get, collection: () => collection },
      currentUser: 'cw',
      workspaceId: 'ws-1',
    },
    requestDraw: vi.fn(),
    isActive: () => true,
    navigate: vi.fn(),
  } as unknown as ScreenContext;
  return { context, ticketQueries };
}

const LISTS: {
  name: string;
  make: () => Screen;
  params: Record<string, string>;
}[] = [
  {
    name: 'Project → Tickets',
    make: () => new TicketsScreen(),
    params: { projectId: 'p1' },
  },
  { name: 'My work', make: () => new MyWorkScreen(), params: {} },
  {
    name: 'Conductor → Assigned',
    make: () => new ConductorTicketsScreen(),
    params: { conductorId: 'c1' },
  },
  {
    name: 'workspace member → Tickets',
    make: () => new WorkspaceMemberTicketsScreen(),
    params: { workspaceId: 'ws-1', userId: USER },
  },
];

const type = async (screen: Screen, context: ScreenContext, keys: string[]) => {
  for (const key of keys) {
    screen.handleInput(key, context);
    await settle();
  }
};

const open = async (list: (typeof LISTS)[number]) => {
  const { context, ticketQueries } = harness(list.params);
  const screen = list.make();
  screen.enter(context);
  await settle();
  return { screen, context, ticketQueries };
};

const body = (screen: Screen, context: ScreenContext) =>
  renderTree(screen.present(context).body).join('\n');

describe.each(LISTS)('the `/` search on $name', (list) => {
  it('opens a search field on `/`', async () => {
    const { screen, context } = await open(list);
    const before = screen.present(context).meta;
    expect(screen.handleInput('/', context)).toBe(true);
    expect(screen.present(context).meta).not.toBe(before);
  });

  it('sends the typed line to the server as filter[search]', async () => {
    const { screen, context, ticketQueries } = await open(list);
    await type(screen, context, ['/', ...'BB-2']);
    expect(searchValue(ticketQueries.at(-1) ?? '')).toBe('BB-2');
    expect(body(screen, context)).toContain('BB-201');
    expect(body(screen, context)).not.toContain('BB-9 ');
  });

  it("shows a refusal as the server's sentence, with no rows", async () => {
    const { screen, context } = await open(list);
    await type(screen, context, ['/', ...'foo#1']);
    const shown = screen.present(context);
    expect([shown.status, shown.toast].join('\n')).toContain(REFUSAL);
    expect(JSON.stringify(shown)).not.toContain('HTTP 400');
    expect(body(screen, context)).not.toContain('BB-');
  });

  it('clears the refusal on the next successful search', async () => {
    const { screen, context } = await open(list);
    await type(screen, context, [
      '/',
      ...'foo#1',
      ...Array(5).fill('backspace'),
      ...'bakers.build',
    ]);
    const shown = screen.present(context);
    expect([shown.status, shown.toast].join('\n')).not.toContain(
      'No repository matches',
    );
  });

  it('keeps a server origin match whose identifier and title omit the typed line', async () => {
    const { screen, context, ticketQueries } = await open(list);
    await type(screen, context, ['/', ...'bakers#19']);
    expect(searchValue(ticketQueries.at(-1) ?? '')).toBe('bakers#19');
    expect(body(screen, context)).toContain('BB-7');
  });
});

const CLEARS: (typeof LISTS)[number][] = LISTS.filter(
  (list) => list.name === 'Project → Tickets' || list.name === 'My work',
);

describe.each(CLEARS)('clearing a refused search on $name', (list) => {
  it('drops the refusal when the query is cleared', async () => {
    const { screen, context } = await open(list);
    await type(screen, context, ['/', ...'foo#1', 'enter', 'c']);
    const shown = screen.present(context);
    expect([shown.status, shown.toast].join('\n')).not.toContain(
      'No repository matches',
    );
    expect(body(screen, context)).toContain('BB-201');
  });
});
