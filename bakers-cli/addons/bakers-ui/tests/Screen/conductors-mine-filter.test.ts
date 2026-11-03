import { describe, expect, it, vi } from 'vitest';
import { ConductorsScreen } from '../../src/Entity/conductor/Screen/conductors.js';
import { ProjectConductorsScreen } from '../../src/Entity/conductor/Screen/project-conductors.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import { nodeById, renderTree } from '../render-tree.js';

// BB-460 — the list opens FILTERED (D1). These cases assert the emitted query
// (D3/AC-4), the hidden count (AC-2) and the two fallbacks (D5), because a
// filter proven only by the rows on screen is a filter that could equally have
// been applied to a truncated page.

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const conductor = (id: string, owner: string, machineId?: string) => ({
  type: 'bb_conductor--bb_conductor',
  id,
  attributes: { label: id, conductor_id: `${owner}-box-bakers` },
  relationships: {
    owner_user_id: { data: { id: owner } },
    ...(machineId
      ? {
          machine: {
            data: { id: machineId, type: 'bb_machine--bb_machine' },
          },
        }
      : {}),
  },
});

// The D5 fallback cases select row 0 while the owner filter is absent, so its
// machine must genuinely be THIS host — otherwise a spurious foreign-row
// warning (BB-450 B10) would compete with the identity reason under test,
// which is not what those cases are about.
const THIS_MACHINE = 'machine-host-a';
const includedMachine = {
  type: 'bb_machine--bb_machine',
  id: THIS_MACHINE,
  attributes: { host_key: 'host-a', max_parallel: 5 },
};

const queryOf = (params: unknown): string =>
  decodeURIComponent((params as { getQueryString(): string }).getQueryString());

interface Recorded {
  path: string;
  query: string;
}

function harness(options: { currentUser?: string; users?: unknown } = {}) {
  const requests: Recorded[] = [];
  const context = {
    sessionGeneration: 1,
    services: {
      client: {
        get: async (path: string, params?: unknown) => {
          const query = params ? queryOf(params) : '';
          requests.push({ path, query });
          if (path === 'user/user') {
            return (
              options.users ?? {
                data: [
                  {
                    id: 'user-cw',
                    type: 'user--user',
                    attributes: { name: 'cw', display_name: 'cw' },
                  },
                ],
              }
            );
          }
          if (path.startsWith('bb_project')) return { data: [] };
          // The unfiltered probe asks for one row; the list asks for twenty.
          if (query.includes('page[limit]=1'))
            return { data: [], meta: { count: 8 } };
          return {
            data: query.includes('owner_user_id')
              ? [
                  conductor('c1', 'user-cw', THIS_MACHINE),
                  conductor('c2', 'user-cw'),
                ]
              : [
                  conductor('c1', 'user-cw', THIS_MACHINE),
                  conductor('c2', 'user-cw'),
                  conductor('c3', 'user-tm'),
                ],
            included: [includedMachine],
            meta: { count: query.includes('owner_user_id') ? 2 : 8 },
          };
        },
        collection: vi.fn(),
      },
      conductorProcess: { thisHostKey: async () => 'host-a' },
      ...(options.currentUser === undefined
        ? {}
        : { currentUser: options.currentUser }),
    },
    requestDraw: vi.fn(),
    isActive: () => true,
    navigate: vi.fn(),
  } as unknown as ScreenContext;
  return { context, requests };
}

const listReads = (requests: Recorded[]) =>
  requests.filter(
    (r) =>
      r.path.startsWith('bb_conductor') && !r.query.includes('page[limit]=1'),
  );

async function open(options: Parameters<typeof harness>[0] = {}) {
  const screen = new ConductorsScreen();
  const { context, requests } = harness({ currentUser: 'cw', ...options });
  screen.enter(context);
  await tick();
  await tick();
  return { screen, context, requests };
}

describe('ConductorsScreen mine filter', () => {
  it('opens filtered by OWNER, at the query (AC-1, AC-4)', async () => {
    const { requests } = await open();
    const read = listReads(requests).at(-1);
    expect(read?.query).toContain('filter[owner_user_id.id]=user-cw');
    expect(read?.query).toContain('sort=-last_seen,-drupal_internal__id');
    expect(read?.query).toContain('page[limit]=20');
  });

  it('states the mode and the rows it hides (AC-2)', async () => {
    const { screen, context } = await open();
    const shown = screen.present(context);
    const body = renderTree(shown.body).join('\n');
    expect(body).toContain('mine');
    expect(
      renderTree(nodeById(shown.body, 'conductors-filter-mine-chip')!).join(''),
    ).toBe('m mine');
    const meta = shown.meta ?? '';
    expect(meta).toContain('6 hidden by mine — press m');
  });

  it('m drops the owner filter and re-reads (D2)', async () => {
    const { screen, context, requests } = await open();
    const before = listReads(requests).length;
    screen.handleInput('m', context);
    await tick();
    const read = listReads(requests).at(-1);
    expect(listReads(requests).length).toBeGreaterThan(before);
    expect(read?.query).not.toContain('owner_user_id');
    expect(
      renderTree(
        nodeById(screen.present(context).body, 'conductors-filter-mine-chip')!,
      ).join(''),
    ).toBe('m mine');
  });

  it('c returns to the default (D2)', async () => {
    const { screen, context, requests } = await open();
    screen.handleInput('m', context);
    await tick();
    screen.handleInput('c', context);
    await tick();
    expect(listReads(requests).at(-1)?.query).toContain(
      'filter[owner_user_id.id]=user-cw',
    );
    expect(
      renderTree(
        nodeById(screen.present(context).body, 'conductors-filter-mine-chip')!,
      ).join(''),
    ).toBe('m mine');
  });

  it('no currentUser: the FULL list plus a stated reason, never empty (D5)', async () => {
    const { screen, context, requests } = await open({
      currentUser: undefined,
    });
    expect(listReads(requests).at(-1)?.query).not.toContain('owner_user_id');
    expect(screen.rows).toHaveLength(3);
    expect(screen.present(context).status).toContain('mine: no current user');
  });

  it('an unresolvable name: the FULL list plus the reason (D5)', async () => {
    const { screen, context, requests } = await open({ users: { data: [] } });
    expect(listReads(requests).at(-1)?.query).not.toContain('owner_user_id');
    expect(screen.rows).toHaveLength(3);
    expect(screen.present(context).status).toContain("'cw' not found");
  });
});

describe('ProjectConductorsScreen mine filter (AC-3, AC-13)', () => {
  it('ANDs both narrowings in one query, and probes with the project kept', async () => {
    const screen = new ProjectConductorsScreen();
    const { context, requests } = harness({ currentUser: 'cw' });
    (context as { project?: unknown }).project = {
      id: 'p1',
      name: 'Bb',
      slug: 'bakers',
    };
    (context as { params?: unknown }).params = { projectId: 'p1' };
    screen.enter(context);
    await tick();
    await tick();
    const list = listReads(requests).at(-1);
    expect(list?.query).toContain('filter[owner_user_id.id]=user-cw');
    expect(list?.query).toContain('filter[project_id.id]=p1');
    expect(list?.query).toContain('page[limit]=20');
    const probe = requests
      .filter((r) => r.query.includes('page[limit]=1'))
      .at(-1);
    expect(probe?.query).toContain('filter[project_id.id]=p1');
    expect(probe?.query).not.toContain('owner_user_id');
    expect(
      renderTree(
        nodeById(
          screen.present(context).body,
          'project-conductors-filter-mine-chip',
        )!,
      ).join(''),
    ).toBe('m mine');
  });
});
