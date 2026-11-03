import { describe, expect, it, vi } from 'vitest';
import { ConductorsScreen } from '../../../../src/Entity/conductor/Screen/conductors.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import type {
  Collection,
  DropshClient,
  Resource,
} from '../../../../src/types.js';
import {
  cellValues,
  idsOf,
  nodeById,
  renderTree,
} from '../../../render-tree.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const conductor = (over: Record<string, unknown> = {}) => ({
  id: 'c-1',
  label: 'cw-framework',
  status: 'online',
  workspace_root: '/nowhere/.bakers',
  last_seen: Math.floor(Date.now() / 1000),
  lease_expires_at: Math.floor(Date.now() / 1000) + 300,
  last_pid: 4242,
  conductor_name: 'conductor',
  ...over,
});

// BB-450 B12 (regression fix, not this file's own concern): `activate()`
// now refuses on `!row.mine`, so every row this harness answers must sideload
// a `machine` whose UUID matches the process host's `thisMachineId()` below.
const MACHINE = 'machine-1';

function harness(rows: ReturnType<typeof conductor>[] = [conductor()]) {
  const collection = (type: string): Collection => {
    const c = {
      where: () => c,
      sort: () => c,
      page: () => c,
      first: async () => null,
      list: async () =>
        type === 'bb_conductor'
          ? rows.map(
              (row) =>
                ({
                  id: row.id,
                  type: 'bb_conductor--bb_conductor',
                  attr: (name: string) =>
                    (row as Record<string, unknown>)[name],
                  rel: () => null,
                }) as unknown as Resource,
            )
          : [],
    } as unknown as Collection;
    return c;
  };
  const context: ScreenContext = {
    sessionGeneration: 1,
    services: {
      client: {
        collection,
        // listConductorRowPage (BB-353, BB-460) reads via client.get + include=machine.
        get: async (path: string, params?: unknown) => {
          if (path === 'user/user')
            return {
              data: [
                {
                  id: 'user-cw',
                  type: 'user--user',
                  attributes: { name: 'cw', display_name: 'cw' },
                },
              ],
            };
          if (path.startsWith('bb_project')) return { data: [] };
          if (!path.startsWith('bb_conductor/bb_conductor')) return {};
          const query = params
            ? decodeURIComponent(
                (params as { getQueryString(): string }).getQueryString(),
              )
            : '';
          if (query.includes('page[limit]=1'))
            return { data: [], meta: { count: rows.length } };
          return {
            data: rows.map((row) => ({
              id: row.id,
              type: 'bb_conductor--bb_conductor',
              attributes: row,
              relationships: {
                machine: { data: { id: MACHINE, type: 'bb_machine' } },
                // BB-460 — every row this harness answers is the current
                // user's own, so the list's default `mine` filter never hides
                // it: these tests exercise the table and the log, not the
                // filter itself (that is `tests/Screen/conductors-mine-filter.test.ts`).
                owner_user_id: { data: { id: 'user-cw' } },
              },
            })),
            included: [
              {
                id: MACHINE,
                type: 'bb_machine--bb_machine',
                attributes: { name: 'test-host', max_parallel: 5 },
              },
            ],
            meta: { count: rows.length },
          };
        },
      } as unknown as DropshClient,
      baseUrl: 'http://web',
      // BB-450 B10: `load()` now resolves THIS machine's machine UUID through
      // the process host before every read. Faked so the suite never touches
      // the real `~/.bakers/machine.config.js` — the same hazard
      // `conductor/tests/config.test.ts` already names for the CLI side.
      conductorProcess: {
        start: async () => ({ ok: true, message: 'not exercised here' }),
        stop: async () => ({ ok: true, message: 'not exercised here' }),
        thisMachineId: async () => MACHINE,
      },
      currentUser: 'cw',
    },
    requestDraw: () => {},
    isActive: () => true,
    nowSeconds: () => Math.floor(Date.now() / 1000),
  };
  return context;
}

describe('the Conductors screen', () => {
  /**
   * BB-375 — conductors refresh through the shared ui-refresh / `R` path, not
   * a screen-private 5 s timer. Enter must not arm an interval of its own.
   */
  it('does not arm a private refresh timer on enter or re-enter', () => {
    vi.useFakeTimers();
    try {
      const screen = new ConductorsScreen();
      const context = harness();
      screen.enter(context);
      expect(vi.getTimerCount()).toBe(0);
      screen.enter(context);
      expect(vi.getTimerCount()).toBe(0);
      screen.leave();
      screen.reset();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands over the conductor rows as a keyed tree', async () => {
    const screen = new ConductorsScreen();
    const context = harness();
    screen.enter(context);
    await tick();
    await tick();

    const body = screen.present(context).body;
    expect(cellValues(body)).toContain('cw-framework');
    expect(idsOf(body)).toContain('conductor-row-c-1');
    screen.leave();
  });

  it('states an explicit empty line rather than a blank body', async () => {
    const screen = new ConductorsScreen();
    const context = harness([]);
    screen.enter(context);
    await tick();
    await tick();

    // BB-345 D6 — THE HEADER STAYS WHEN THE ROWS ARE GONE, and that is why
    // this expectation grew nine entries rather than being loosened to a
    // `toContain`. An empty list still has columns, and a header that vanished
    // with the last row would make the empty state a different table.
    expect(cellValues(screen.present(context).body)).toEqual([
      // BB-460 — the badge strip above the table: the `mine` filter is
      // ACTIVE by default, with its shortcut kept beside the value.
      'm',
      'mine',
      '',
      'c clear',
      'NAME',
      ' MACHINE',
      ' PROJECT',
      ' STATUS',
      ' AGE',
      ' WORKSPACE',
      ' PID',
      ' MARKS',
      ' LOAD',
      'No conductors on this control plane.',
    ]);
    screen.leave();
  });

  // BB-345 AC 1/2 — the screen renders through the ONE table, and what is not
  // a row of that list stays outside it.
  it('renders its rows through the shared table, header included', async () => {
    const screen = new ConductorsScreen();
    const context = harness();
    screen.enter(context);
    await tick();
    await tick();

    const body = screen.present(context).body;
    // The table's own node, keyed by the configuration's noun — evidence that
    // the rows come from `listTableTree` and not from a conductor-local
    // renderer, which is what AC 1 asks for.
    expect(idsOf(body)).toContain('conductor-table');
    expect(idsOf(body)).toContain('conductor-header-name');
    expect(
      renderTree(nodeById(body, 'conductors-filter-mine-chip')!).join(''),
    ).toBe('m mine');
    expect(cellValues(body).slice(4, 13)).toEqual([
      'NAME',
      ' MACHINE',
      ' PROJECT',
      ' STATUS',
      ' AGE',
      ' WORKSPACE',
      ' PID',
      ' MARKS',
      ' LOAD',
    ]);
    screen.leave();
  });

  it('activate navigates to the conductor detail scope, for every row', async () => {
    // The log no longer opens inline: `activate()` always opens the conductor
    // detail scope now, and its Log tab (a separate screen) is where a
    // foreign conductor's "no log here" is now said.
    const screen = new ConductorsScreen();
    const context = harness();
    screen.enter(context);
    await tick();
    await tick();

    const navigate = vi.fn();
    const navigated = screen.activate(0, {
      ...context,
      navigate,
    } as ScreenContext);

    expect(navigated).toBe(true);
    expect(navigate).toHaveBeenCalledWith('conductor.overview', {
      conductorId: 'c-1',
    });
    screen.leave();
  });
});
