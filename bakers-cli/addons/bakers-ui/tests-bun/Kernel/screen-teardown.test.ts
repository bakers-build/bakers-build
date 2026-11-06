import { afterEach, describe, expect, it } from 'bun:test';
import type {
  Collection,
  DropshClient,
  RendererServices,
} from '../../src/types.js';
import { type BootedTui, bootTui } from '../tui-harness.js';

/**
 * BB-340 spec F2 — `leave()` must DESTROY the departed screen's subtree.
 *
 * The obligation F2 states in as many words, and the one the review of
 * 2026-08-13 found unimplemented: `patchTree`'s surplus pass PARKS every id the
 * next tree stops wanting (`visible = false`, `height = 0`) and leaves it in
 * `byId` and in its parent's child list. That is right for a RESIZE, where the
 * ids come back; it is wrong for a NAVIGATION with entity-derived ids, because a
 * `ticket-row-<uuid>` on a screen you have left never becomes wanted again.
 *
 * IT HAS TO BE THE RENDERABLE TREE, not a captured frame. A parked node is
 * invisible and zero rows tall, so every picture of the terminal agrees with
 * every picture a destroy would produce — which is exactly why no check in this
 * suite saw it. The cases below ask the renderer what is still standing.
 *
 * Driven through the REAL kernel, in a file of its own: this is a property of the
 * kernel's navigation handling, not of `mountTree`/`patchTree`, whose parking is
 * deliberate and unchanged (`mount.test.ts` pins it).
 *
 * NEVER PASS A `Renderable` TO `expect` — the rule `row-reconciliation.test.ts`
 * already states beside `reusedCount`, re-met here the hard way while writing the
 * first RED. A renderable is an object graph hanging off FFI pointers, so when an
 * assertion over one FAILS, Bun's diff formatter walks it and the process dies
 * with SIGABRT: no failure message, no file name, the other 25 files unreported.
 * A guard that can only report its own RED by aborting the run is not a guard, so
 * every assertion here is over a `string | undefined` id or a boolean.
 */
describe('a departed screen leaves nothing standing (BB-340 F2)', () => {
  const PROJECT = 'ffff0000-0000-0000-0000-0000000000f2';
  const TICKET = 'ffff0000-0000-0000-0000-000000000001';
  const OTHER = 'ffff0000-0000-0000-0000-000000000002';
  /** The id `Entity/collection.ts`'s `rowNodeId` gives a ticket list row. */
  const rowId = (id: string): string => `ticket-row-${id}`;

  const listRow = (id: string, identifier: string) => ({
    id,
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier,
      title: `${identifier} title`,
      state: 'coding',
      derived_status: 'idle',
      workflow: 'bb_work',
    },
    relationships: { labels: { data: [] } },
  });

  const services = (): RendererServices => {
    const empty = (): Collection => {
      const c: Collection = {
        where: () => c,
        sort: () => c,
        page: () => c,
        first: async () => null,
        list: async () => [],
      };
      return c;
    };
    const client: DropshClient = {
      collection: () => empty(),
      get: async (path: string) => {
        if (path === 'bb_ticket/bb_ticket')
          return {
            data: [listRow(TICKET, 'BB-340'), listRow(OTHER, 'BB-341')],
            included: [],
          };
        if (path.startsWith(`bb_ticket/bb_ticket/${TICKET}`))
          return {
            data: {
              id: TICKET,
              type: 'bb_ticket--bb_ticket',
              attributes: {
                identifier: 'BB-340',
                title: 'BB-340 title',
                state: 'coding',
                derived_status: 'idle',
                workflow: 'bb_work',
                description: 'The description body.',
              },
              relationships: { labels: { data: [] }, runs: { data: [] } },
            },
            included: [],
          };
        return { data: [] };
      },
    };
    return { client, writeClient: client, baseUrl: 'https://bakers.example' };
  };

  const booted: BootedTui[] = [];
  afterEach(async () => {
    for (const tui of booted.splice(0)) {
      tui.mockInput.pressKey('q');
      await tui.running;
      await tui.stop();
    }
  });

  /** The ticket list, reached the way the cockpit reaches it: Tab off the
   *  project Overview. */
  const openList = async (): Promise<BootedTui> => {
    const tui = await bootTui({
      services: services(),
      columns: 120,
      rows: 40,
      tui: {
        route: { screen: 'project', projectId: PROJECT, projectName: 'bakers' },
      },
    });
    booted.push(tui);
    await tui.press('\t');
    return tui;
  };

  /** The id of the node still standing under that id, or `undefined`. A string,
   *  never the renderable — see the file header. */
  const standingId = (tui: BootedTui, id: string): string | undefined =>
    tui.renderer.root.findDescendantById(id)?.id;

  /** Whether the node standing under `id` is the very object `was`. A boolean,
   *  for the same reason. */
  const isSameNode = (tui: BootedTui, id: string, was: unknown): boolean =>
    tui.renderer.root.findDescendantById(id) === was;

  it('frees the rows of the list it navigated away from', async () => {
    const tui = await openList();
    expect(standingId(tui, rowId(TICKET)), 'the list is showing').toBe(
      rowId(TICKET),
    );

    await tui.press('\r'); // Enter — open the selected ticket's detail
    expect(tui.frame()).toContain('BB-340 title');

    expect(
      standingId(tui, rowId(TICKET)),
      "the departed list's selected row is destroyed, not parked",
    ).toBeUndefined();
    expect(
      standingId(tui, rowId(OTHER)),
      'and so is every other row of it',
    ).toBeUndefined();
  });

  it('rebuilds the list on the way back rather than un-parking it', async () => {
    const tui = await openList();
    const first = tui.renderer.root.findDescendantById(rowId(TICKET));
    await tui.press('\r'); // into the detail
    await tui.press('\x1b'); // Esc — back to the list

    expect(standingId(tui, rowId(TICKET)), 'the rows are on screen again').toBe(
      rowId(TICKET),
    );
    expect(
      isSameNode(tui, rowId(TICKET), first),
      'and are new renderables, not the parked originals',
    ).toBe(false);
    expect(tui.frame(), 'the list really is painted').toContain('BB-341 title');
  });
});
