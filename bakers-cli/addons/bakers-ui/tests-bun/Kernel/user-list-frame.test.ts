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
      first: async () =>
        type === 'bb_workspace'
          ? ({
              attr: (key: string) =>
                key === 'drupal_internal__id' ? 7 : undefined,
            } as unknown as Resource)
          : null,
      // `Collection.list()` resolves an ARRAY (`src/types.ts`), and this fixture
      // used to resolve `{ rows, hasNext }` — a shape `listOutcome`'s `.map`
      // throws on, which the root Users list swallowed into an empty table, so
      // the fixture's shape is load-bearing rather than merely wrong.
      list: async () =>
        type === 'user' || type.startsWith('user') ? users : [],
    };
    return c;
  };
  const client: DropshClient = {
    collection,
    get: async (path: string) => {
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
      // The workspace roster is read through its memberships.
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

const LEAD = {
  isWorkspaceAdmin: true,
  workspaceId: 'workspace-1',
  workspace: 'Bb',
} as const;

describe('BB-375 — user screens paint the shared content FRAME', () => {
  it('the workspace Members list: frame top sits flush under the tab bar', async () => {
    const tui = await bootTui({
      services: services(),
      columns: 100,
      rows: 30,
      tui: LEAD,
    });
    // My work → Projects → Members (workspace leads only).
    await tui.press('\t');
    await tui.press('\t');
    expect(tui.rows()[5], 'Members tab bracketed').toMatch(/\[Members\]/);
    expect(tui.rows()[BODY_TOP], 'body FRAME top').toMatch(/╭/);
    expect(tui.rows().join('\n')).toMatch(/MEMBER/);

    await quit(tui);
  });

  it('the workspace roster opens a contextual member and keeps its body FRAME', async () => {
    const tui = await bootTui({
      services: services(),
      columns: 100,
      rows: 30,
      tui: LEAD,
    });
    await tui.press('\t'); // -> projects
    await tui.press('\t'); // -> members
    expect(tui.frame(), 'roster title').toContain('Workspace members');
    expect(tui.rows()[BODY_TOP], 'roster FRAME').toMatch(/╭/);

    await tui.press('\r');
    expect(tui.rows()[1] ?? '', 'Enter opens the member overview').toMatch(
      /cw · overview/,
    );
    expect(tui.rows()[5] ?? '', 'member Overview tab bracketed').toMatch(
      /\[Overview\]/,
    );

    await tui.press('\x1b');
    expect(tui.frame(), 'Esc returns to the roster').toContain(
      'Workspace members',
    );

    await quit(tui);
  });
});
