import { describe, expect, it } from 'bun:test';
import type {
  Collection,
  DropshClient,
  RendererServices,
  Resource,
} from '../../src/types.js';
import { type BootedTui, bootTui } from '../tui-harness.js';

/**
 * BB-375 — user lists share the same content FRAME as Projects/Conductors.
 * Without FullScreen's inlined FRAME, `footerNotice` was not the only
 * gap: the body sat flush under the tab bar with no rounded border.
 */

const asResource = (over: Record<string, unknown>): Resource =>
  ({
    id: String(over.id),
    type: 'user--user',
    attr: (name: string) => over[name],
    rel: () => null,
  }) as unknown as Resource;

function services(): RendererServices {
  const users = [
    asResource({
      id: 'u-cw',
      display_name: 'cw',
      name: 'cw',
      drupal_internal__uid: 2,
    }),
  ];
  const collection = (type: string): Collection => {
    const c: Collection = {
      where: () => c,
      sort: () => c,
      page: () => c,
      first: async () => null,
      // `Collection.list()` resolves an ARRAY (`src/types.ts`), and this fixture
      // used to resolve `{ rows, hasNext }` — a shape `listOutcome`'s `.map`
      // throws on, which the root Users list swallowed into an empty table. The
      // crew list reports a refused read instead of drawing an empty crew, so the
      // fixture's shape is now load-bearing rather than merely wrong.
      list: async () =>
        type === 'user' || type.startsWith('user') ? users : [],
    };
    return c;
  };
  const stats = {
    data: {
      type: 'bakers-statistics',
      id: 'root',
      attributes: {
        generated: '2026-08-18T12:00:00+00:00',
        windows: { day: 86400, week: 604800, month: 2592000 },
        tickets: {
          total: { day: 1, week: 2, month: 3 },
          by_user: [{ id: 'u-cw', label: 'cw', day: 1, week: 2, month: 30 }],
          by_project: [
            { id: 'p1', label: 'bakers', day: 1, week: 2, month: 3 },
          ],
          by_day: Array.from({ length: 7 }, (_, i) => ({
            date: `2026-08-${12 + i}`,
            label: ['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'][i],
            count: i % 2,
          })),
        },
        runs: {
          total: { day: 1, week: 2, month: 3 },
          by_user: [{ id: 'u-cw', label: 'cw', day: 1, week: 2, month: 10 }],
          by_project: [
            { id: 'p1', label: 'bakers', day: 1, week: 2, month: 3 },
          ],
          by_day: Array.from({ length: 7 }, (_, i) => ({
            date: `2026-08-${12 + i}`,
            label: ['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'][i],
            count: (i + 1) % 2,
          })),
        },
      },
    },
  };
  const client: DropshClient = {
    collection,
    get: async (path: string) => {
      if (path.includes('statistics')) return stats;
      if (path.startsWith('bb_conductor/')) return { data: [], included: [] };
      if (path === 'user/user') {
        return {
          data: [
            {
              id: 'u-cw',
              attributes: {
                display_name: 'cw',
                name: 'cw',
                drupal_internal__uid: 2,
              },
            },
          ],
          links: {},
        };
      }
      // BB-391 AC4 — the users LIST is the team level's Users tab now, so the
      // crew and its membership are part of this fixture's world: without them
      // there is no route to a users list at all.
      if (path.startsWith('bb_team/'))
        return {
          data: [
            {
              id: 't-1',
              attributes: { name: 'Platform', drupal_internal__id: 7 },
            },
          ],
          included: [],
          links: {},
        };
      if (path.startsWith('og_membership/'))
        return {
          data: [
            {
              id: 'm1',
              attributes: { entity_id: '7' },
              relationships: { uid: { data: { id: 'u-cw' } } },
            },
          ],
          links: {},
        };
      return { data: [], meta: { count: 0 }, links: {} };
    },
  };
  return { client, baseUrl: 'https://bakers.example' };
}

async function quit(tui: BootedTui): Promise<void> {
  tui.mockInput.pressKey('q');
  await tui.running;
  await tui.stop();
}

/** First body-window row after chrome header + gap + tab bar. */
const BODY_TOP = 6;

describe('BB-375 — user screens paint the shared content FRAME', () => {
  // BB-391 AC4 — the users list moved under the crew by operator ruling, so the
  // route to it is Teams → one crew → Users rather than a fourth root tab. The
  // FRAME property this case exists for is unchanged; only the way there is.
  it('the crew’s Users list: frame top sits flush under the tab bar', async () => {
    const tui = await bootTui({
      services: services(),
      columns: 100,
      rows: 30,
    });
    // Dashboard → Projects → Teams.
    await tui.press('\t');
    await tui.press('\t');
    expect(tui.rows()[5], 'Teams tab bracketed').toMatch(/\[Teams\]/);

    // Enter opens the crew on Work, which draws the TEAM level's own bar.
    await tui.press('\r');
    expect(tui.rows()[5], 'team Work bracketed').toMatch(/\[Work\]/);

    // …and two Tabs within that level reach the crew's people.
    await tui.press('\t');
    await tui.press('\t');
    expect(tui.rows()[5], 'Members tab bracketed').toMatch(/\[Members\]/);
    expect(tui.rows()[BODY_TOP], 'body FRAME top').toMatch(/╭/);
    expect(tui.rows().join('\n')).toMatch(/USER/);

    await quit(tui);
  });

  it('the team roster opens a contextual member and keeps its body FRAME', async () => {
    const tui = await bootTui({
      services: services(),
      columns: 100,
      rows: 30,
    });
    // BB-456 D6 dropped the root Dashboard's PER-USER cursor: the new
    // discovery-plus-values contract carries no per-row target type, and the
    // shipped root/user-scope figures carry no breakdown axis at all (that
    // now lives at TEAM scope only — see `dashboard.ts`'s own comment). A
    // user's overview is reached the same way the sibling test above reaches
    // the crew's Users list: Dashboard → Projects → Teams, open the crew,
    // move from Work through Overview to Users, Enter the (only) row.
    await tui.press('\t'); // -> projects
    await tui.press('\t'); // -> teams
    await tui.press('\r'); // open the crew
    await tui.press('\t'); // -> Overview tab
    await tui.press('\t'); // -> Members tab
    expect(tui.rows()[1] ?? '', 'roster title').toMatch(/Platform · members/);
    expect(tui.rows()[BODY_TOP], 'roster FRAME').toMatch(/╭/);

    await tui.press('\r');
    expect(tui.rows()[1] ?? '', 'Enter opens the member overview').toMatch(
      /cw · overview/,
    );
    expect(tui.rows()[5] ?? '', 'member Overview tab bracketed').toMatch(
      /\[Overview\]/,
    );

    await tui.press('\x1b');
    expect(tui.rows()[1] ?? '', 'Esc returns to the roster').toMatch(
      /Platform · members/,
    );

    await quit(tui);
  });
});
