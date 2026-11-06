import { describe, expect, it, vi } from 'vitest';
import { ProjectsScreen } from '../../src/Entity/project/Screen/projects-screen.js';
import { RunsScreen } from '../../src/Entity/run/Screen/runs.js';
import { TicketAgentsScreen } from '../../src/Entity/ticket/Screen/ticket-agents.js';
import { TicketsScreen } from '../../src/Entity/ticket/Screen/tickets.js';
import type { Screen, ScreenContext } from '../../src/Screen/screen.js';
import type { DropshClient, RendererServices } from '../../src/types.js';
import { idsOf, nodeById, renderTree } from '../render-tree.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The text a screen's body carries, whichever surface it hands over.
 *
 * BB-340 Task 7 — the two list screens return a renderable TREE and the other
 * three still compose rows; `present().body` is the one place both arrive, so
 * these cases read the same thing off either.
 */
const bodyRows = (screen: Screen, context: ScreenContext): string[] =>
  screen.renderNonInteractive?.(context) ??
  renderTree(screen.present(context).body);

function harness(
  screen: Screen,
  get: DropshClient['get'],
  agents?: RendererServices['agents'],
) {
  const events: string[] = [];
  const context: ScreenContext = {
    sessionGeneration: 1,
    project: { id: 'project-1', name: 'Bb', slug: 'bakers' },
    services: {
      client: {
        get: async (...args) => {
          events.push('load');
          return get(...args);
        },
        collection: vi.fn(),
      },
      ...(agents ? { agents } : {}),
    },
    requestDraw: () => events.push(`draw:${bodyRows(screen, context)[0]}`),
    isActive: () => true,
    nowSeconds: () => 1_700_000_000,
  };
  return { context, events };
}

describe('project tab screens own their asynchronous lifecycle', () => {
  it('Projects saves and restores its destination-owned selection', () => {
    const screen = new ProjectsScreen();
    screen.selectedIndex = 3;
    const token = screen.saveState();
    screen.selectedIndex = 0;
    screen.restoreState(token);
    expect(screen.selectedIndex).toBe(3);
  });
  it('Projects offers no way to create a ticket', () => {
    const screen = new ProjectsScreen();
    const { context } = harness(
      screen,
      async () => ({ data: [] }),
      {} as never,
    );
    expect(screen.present(context).actions?.map((a) => a.label)).not.toContain(
      'new',
    );
    expect(screen.actionForInput?.('n', context)).toBeUndefined();
  });

  it('Projects owns cursor movement and routed project activation', async () => {
    const screen = new ProjectsScreen();
    const navigate = vi.fn();
    const collection = {
      where: vi.fn(),
      sort: vi.fn(),
      page: vi.fn(),
      first: vi.fn(),
      list: vi.fn().mockResolvedValue([
        {
          id: 'membership-1',
          type: 'bb_project_membership--bb_project_membership',
          attr: vi.fn(() => null),
          rel: vi.fn(() => 'project-1'),
          rels: vi.fn(() => []),
        },
      ]),
    };
    collection.where.mockReturnValue(collection);
    collection.sort.mockReturnValue(collection);
    collection.page.mockReturnValue(collection);
    const context: ScreenContext = {
      sessionGeneration: 1,
      services: {
        client: {
          get: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'conductor-1',
                attributes: { status: 'ready' },
                relationships: { project_id: { data: { id: 'project-1' } } },
              },
            ],
          }),
          // The project names are their own bb_project read.
          collection: vi.fn((type: string) =>
            type === 'bb_project'
              ? {
                  whereIn() {
                    return this;
                  },
                  list: vi.fn().mockResolvedValue([
                    {
                      id: 'project-1',
                      type: 'bb_project--bb_project',
                      attr: vi.fn((key: string) =>
                        key === 'name' ? 'Bb' : null,
                      ),
                      rel: vi.fn(() => null),
                      rels: vi.fn(() => []),
                    },
                  ]),
                }
              : collection,
          ),
        },
      },
      requestDraw: vi.fn(),
      isActive: () => true,
      navigate,
    };
    screen.enter(context);
    await tick();
    expect(screen.handleInput('enter', context)).toBe(true);
    expect(navigate).toHaveBeenCalledWith('project.overview', {
      projectId: 'project-1',
      projectName: 'Bb',
      projectSlug: 'Bb',
    });
  });

  it('Tickets draws loading before its filtered list I/O and renders empty ready state', async () => {
    const screen = new TicketsScreen();
    const { context, events } = harness(screen, async () => ({
      data: [],
      included: [],
    }));
    screen.enter(context);
    await tick();
    // BB-375 — the filter section leads the body, so the draw probe's first
    // row is a chip (or hint), not the loading line. Load still happens first.
    expect(events[0]).toMatch(/^draw:/);
    expect(events).toContain('load');
    const body = bodyRows(screen, context).join('\n');
    expect(body).toContain('No tickets.');
    expect(body).toContain('closed: hidden');
  });

  it('Tickets owns filter reload and routes its selected row', async () => {
    const get = vi.fn().mockResolvedValue({
      data: [
        { id: 'ticket-1', attributes: { identifier: 'BB-1' } },
        { id: 'ticket-2', attributes: { identifier: 'BB-2' } },
        {
          id: 'ticket-3',
          attributes: { identifier: 'BB-3', closed: true },
        },
      ],
      included: [],
    });
    const screen = new TicketsScreen();
    const { context } = harness(screen, get);
    const navigate = vi.fn();
    const routed = { ...context, navigate };
    screen.enter(routed);
    await tick();
    // The default hides closed rows even though this fake client ignores
    // the query params (the client-side double-check, spec D5 / AC-1).
    expect(screen.rows.map((r) => r.id)).toEqual(['ticket-1', 'ticket-2']);
    expect(screen.handleInput('s', routed)).toBe(true);
    await tick();
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.handleInput('c', routed)).toBe(true);
    await tick();
    expect(screen.handleInput('j', routed)).toBe(true);
    expect(screen.handleInput('enter', routed)).toBe(true);
    expect(navigate).toHaveBeenCalledWith('ticket.detail', {
      ticketId: 'ticket-2',
    });
  });

  it('Tickets cycles the closed filter on x and reloads', async () => {
    const get = vi.fn().mockResolvedValue({ data: [], included: [] });
    const screen = new TicketsScreen();
    const { context } = harness(screen, get);
    screen.enter(context);
    await tick();
    expect(screen.handleInput('x', context)).toBe(true);
    await tick();
    expect(get).toHaveBeenCalledTimes(2); // reload with closed-only
  });

  it('Tickets states the closed mode in the filter section at all times (AC-4)', async () => {
    const get = vi.fn().mockResolvedValue({ data: [], included: [] });
    const screen = new TicketsScreen();
    const { context } = harness(screen, get);
    screen.enter(context);
    await tick();
    // BB-375 — filter chips live in the body section, not header meta.
    expect(renderTree(screen.present(context).body).join('\n')).toContain(
      'closed: hidden',
    );
    expect(
      renderTree(
        nodeById(screen.present(context).body, 'tickets-filter-closed-chip')!,
      ).join(''),
    ).toBe('x closed: hidden');
    expect(screen.present(context).meta).not.toContain('closed:');
    screen.handleInput('x', context);
    await tick();
    expect(renderTree(screen.present(context).body).join('\n')).toContain(
      'closed: only',
    );
    expect(
      renderTree(
        nodeById(screen.present(context).body, 'tickets-filter-closed-chip')!,
      ).join(''),
    ).toBe('x closed: only');
    screen.handleInput('x', context);
    await tick();
    const body = renderTree(screen.present(context).body).join('\n');
    expect(body).not.toContain('closed: hidden');
    expect(body).not.toContain('closed: only');
    expect(
      renderTree(
        nodeById(screen.present(context).body, 'tickets-filter-closed-chip')!,
      ).join(''),
    ).toBe('x closed');
  });

  it('Tickets states the active search chip in the filter section (BB-299 D1/AC-1)', async () => {
    const get = vi.fn().mockResolvedValue({ data: [], included: [] });
    const screen = new TicketsScreen();
    const { context } = harness(screen, get);
    screen.enter(context);
    await tick();

    // No query: no search segment in meta or the filter line.
    const plain = screen.present(context).meta ?? '';
    expect(plain).not.toContain('search:');
    expect(plain).not.toContain('\x1b[');
    expect(renderTree(screen.present(context).body).join('\n')).not.toContain(
      'search:',
    );

    screen.previewCriteria({
      query: 'filter',
      state: null,
      closed: false,
      parent: null,
      who: null,
    });
    const shown = screen.present(context);
    const meta = shown.meta ?? '';
    const body = renderTree(shown.body).join('\n');
    // BB-375 — chips left the meta row for the bordered filter section.
    expect(meta).not.toContain('search:');
    expect(body).toContain('search: filter');
    expect(body).not.toContain('\x1b');
  });

  it('Runs draws loading before run I/O and renders empty ready state', async () => {
    const screen = new RunsScreen();
    const { context, events } = harness(screen, async () => ({
      data: [],
      included: [],
    }));
    screen.enter(context);
    await tick();
    // BB-375 A′ — badge strip leads the body, so the draw probe's first row
    // is a chip, not the loading line. Load still happens.
    expect(events[0]).toMatch(/^draw:/);
    expect(events).toContain('load');
    expect(bodyRows(screen, context).join('\n')).toContain(
      'No runs for this project.',
    );
  });

  it('Runs hides closed runs by default, cycles on x, and states the mode', async () => {
    const get = vi.fn().mockResolvedValue({
      data: [
        { id: 'r1', type: 'bb_run--bb_run', attributes: {} },
        { id: 'r2', type: 'bb_run--bb_run', attributes: { closed: true } },
      ],
      included: [],
    });
    const screen = new RunsScreen();
    const { context } = harness(screen, get);
    screen.enter(context);
    await tick();
    // The default hides closed runs even though this fake client ignores
    // the query params (the client-side double-check, spec D5 / AC-2).
    expect(screen.rows.map((r) => r.id)).toEqual(['r1']);
    // Closed mode lives in the badge strip (BB-375 A′), not meta.
    expect(bodyRows(screen, context).join('\n')).toContain('closed: hidden');
    expect(
      renderTree(
        nodeById(screen.present(context).body, 'runs-filter-closed-chip')!,
      ).join(''),
    ).toBe('x closed: hidden');
    expect(screen.present(context).meta ?? '').not.toContain('closed:');
    expect(screen.handleInput('x', context)).toBe(true);
    await tick();
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.rows.map((r) => r.id)).toEqual(['r2']);
    expect(bodyRows(screen, context).join('\n')).toContain('closed: only');
    expect(
      renderTree(
        nodeById(screen.present(context).body, 'runs-filter-closed-chip')!,
      ).join(''),
    ).toBe('x closed: only');
    expect(screen.handleInput('x', context)).toBe(true);
    await tick();
    expect(get).toHaveBeenCalledTimes(3);
    expect(screen.rows.map((r) => r.id)).toEqual(['r1', 'r2']);
    const body = bodyRows(screen, context).join('\n');
    expect(body).not.toContain('closed: hidden');
    expect(body).not.toContain('closed: only');
    expect(body).toContain('x closed');
    expect(
      renderTree(
        nodeById(screen.present(context).body, 'runs-filter-closed-chip')!,
      ).join(''),
    ).toBe('x closed');
  });

  it('Ticket-Agents draws loading before list and retries an isolated error', async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('host down'))
      .mockResolvedValueOnce([]);
    const agents = {
      list,
      focus: vi.fn(),
      hide: vi.fn(),
      kill: vi.fn(),
      launch: vi.fn(),
    };
    const screen = new TicketAgentsScreen();
    const { context, events } = harness(screen, async () => ({}), agents);
    screen.enter(context);
    await tick();
    expect(events[0]).toBe('draw:Loading ticket agents…');
    expect(bodyRows(screen, context)[0]).toBe('host down');
    screen.retry(context);
    await tick();
    expect(list).toHaveBeenCalledTimes(2);
    expect(bodyRows(screen, context)).toContain('No ticket agents.');
  });

  it('Runs owns cursor movement and routes activation through screen context', async () => {
    const screen = new RunsScreen();
    const { context } = harness(screen, async () => ({
      data: [
        {
          type: 'bb_run--bb_run',
          id: 'run-1',
          attributes: {},
          relationships: { ticket_id: { data: { id: 'ticket-1' } } },
        },
        {
          type: 'bb_run--bb_run',
          id: 'run-2',
          attributes: {},
          relationships: { ticket_id: { data: { id: 'ticket-2' } } },
        },
      ],
      included: [],
    }));
    const navigate = vi.fn();
    const routed = { ...context, navigate };
    screen.enter(routed);
    await tick();

    expect(screen.handleInput('j', routed)).toBe(true);
    expect(screen.selectedIndex).toBe(1);
    const shown = screen.present(routed);
    expect(shown).toMatchObject({ selectable: 2, selectedIndex: 1 });
    // The successor of the `selectedRow: 2` this used to assert (BB-340 Task
    // 12): the selected entry is named by its NODE, and the row it sits on is
    // the layout's answer. The identity is what the kernel routes and scrolls
    // by, and it is the entity's own id rather than a position.
    expect(shown.rowIds?.[shown.selectedIndex]).toBe('run-row-run-2');
    // The populated half of `no-line-surface.test.ts`'s A1 exemption. `rowIds` is
    // the one `readonly string[]` the presentation keeps, and what makes it
    // identity rather than the row surface A1 forbids is this: every entry names a
    // node of the very body it was published with. The enumeration in that file
    // asserts the same thing, but every screen it can construct is empty.
    const nodes = new Set(idsOf(shown.body));
    for (const id of shown.rowIds ?? [])
      expect(nodes.has(id), `${id} names a node of the body`).toBe(true);
    expect(screen.handleInput('enter', routed)).toBe(true);
    expect(navigate).toHaveBeenCalledWith('ticket.runs', {
      ticketId: 'ticket-2',
    });
  });

  it('Ticket-Agents owns cursor, focus, hide and kill actions', async () => {
    const agents = {
      list: vi.fn().mockResolvedValue([
        { id: 'agent-1', group: 'bakers', label: 'One' },
        { id: 'agent-2', group: 'bakers', label: 'Two' },
      ]),
      focus: vi.fn().mockResolvedValue(undefined),
      hide: vi.fn().mockResolvedValue(undefined),
      kill: vi.fn().mockResolvedValue(undefined),
      launch: vi.fn(),
    };
    const screen = new TicketAgentsScreen();
    const { context } = harness(screen, async () => ({}), agents);
    screen.enter(context);
    await tick();

    expect(screen.handleInput('j', context)).toBe(true);
    expect(screen.selectedIndex).toBe(1);
    expect(screen.handleInput('enter', context)).toBe(true);
    expect(screen.handleInput('h', context)).toBe(true);
    expect(screen.handleInput('x', context)).toBe(true);
    expect(agents.focus).toHaveBeenCalledWith('agent-2');
    expect(agents.hide).toHaveBeenCalledWith('bakers');
    expect(agents.kill).toHaveBeenCalledWith('agent-2');
  });
});
