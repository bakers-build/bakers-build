import { describe, expect, it, vi } from 'vitest';
import { TicketsScreen } from '../../src/Entity/ticket/Screen/tickets.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import type { TuiOptions } from '../../src/types.js';
import { renderTree } from '../render-tree.js';

// BB-370 — `/` as a TICKET-ID FILTER.
//
// The OR group `buildTicketQueryParams` emits is correct, and so is the server:
// measured against dev2 this session, the byte-for-byte query the screen sends
// answers `identifier CONTAINS 73` with BB-73 the moment `filter[closed]=0`
// is dropped from it, and answers with nothing while it is there.
//
// So the defect is the CRITERIA, not the query: the shipped default hides closed
// rows (`DEFAULT_TICKET_CRITERIA.closed === false`, BB-282 D1) and that
// criterion ANDs with the search group. In project `bakers` 285 of 367 tickets are
// closed, so an operator who types a known `BB-N` lands on `No tickets.` about
// four times out of five — which is what "not usable as a ticket-id filter"
// means.
//
// THE CONFIRMED FIX DIRECTION IS LEGIBILITY, NOT INCLUSION.
//
// The operator's `closed: hidden` keeps ruling — the row does not arrive, the
// server stays authoritative and nothing is quietly un-filtered. What has to
// arrive is the REASON: when a search matches only rows the closed criterion is
// excluding, the screen states HOW MANY it is hiding, so `No tickets.` stops
// being indistinguishable from "no such ticket". That is why AC-1 and AC-2 below
// assert an empty list AND a count, and why they would both still fail against a
// fix that simply dropped `filter[closed]` — which was the other candidate.
//
// The cases drive the SCREEN and not the query builder because the count is a
// screen concern (it needs a second, unfiltered probe) and because `filterRow`
// re-applies the closed predicate to whatever the server returned, so no
// query-string assertion can see the behaviour the operator gets.

const PROJECT = { id: 'project-1', name: 'Bb', slug: 'bakers' };
const TICKETS = 'bb_ticket/bb_ticket';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => {
  for (let i = 0; i < 30; i++) await tick();
};

/** A debounce that fires synchronously — no test sleeps past a real timer. */
const immediate = (fn: () => void): (() => void) => {
  fn();
  return () => {};
};

interface Row {
  identifier: string;
  title: string;
  closed: boolean;
}

/**
 * The world the fixture control plane answers from: twenty open tickets whose
 * identifiers and titles carry no `73`, plus the one CLOSED ticket the operator
 * is looking for. `BB-173` is here so the numeric-fragment case has a second
 * match and cannot pass on an off-by-one.
 */
const WORLD: Row[] = [
  ...Array.from({ length: 20 }, (_, i) => ({
    identifier: `BB-${200 + i}`,
    title: `an open ticket number ${200 + i}`,
    closed: false,
  })),
  { identifier: 'BB-73', title: 'a delivered ticket', closed: true },
  { identifier: 'BB-173', title: 'another delivered ticket', closed: true },
];

/** `filter[search]=…` off the decoded query string. */
const searchValue = (query: string): string | undefined =>
  /filter\[search\]=([^&]*)/.exec(query)?.[1];

/**
 * A control plane that filters the way the real one measurably does: free text
 * in `filter[search]` is an OR over `identifier` / `title` CONTAINS, and `filter[closed]`
 * — when present — is an AND over the whole thing.
 */
function harness() {
  const queries: string[] = [];
  const context = {
    sessionGeneration: 1,
    project: PROJECT,
    params: { projectId: PROJECT.id },
    options: { debounce: immediate } as TuiOptions,
    services: {
      client: {
        get: async (path: string, params?: unknown) => {
          const query = decodeURIComponent(
            (params as { getQueryString(): string }).getQueryString(),
          );
          if (path !== TICKETS) return { data: [], links: {} };
          queries.push(query);
          const search = searchValue(query);
          // An unknown repository alias, rejected the way dropsh rejects a 400.
          if (search?.startsWith('foo%23') || search?.startsWith('foo#'))
            throw Object.assign(new Error('HTTP 400'), {
              status: 400,
              body: {
                errors: [
                  {
                    detail:
                      'No repository matches "foo". Known in your projects: bakers.',
                  },
                ],
              },
            });
          const closed = /filter\[closed\]=(0|1)/.exec(query)?.[1];
          const rows = WORLD.filter((row) => {
            if (closed !== undefined && row.closed !== (closed === '1'))
              return false;
            if (search === undefined) return true;
            const needle = search.toLocaleLowerCase();
            return (
              row.identifier.toLocaleLowerCase().includes(needle) ||
              row.title.toLocaleLowerCase().includes(needle)
            );
          });
          return {
            data: rows.map((row) => ({
              id: row.identifier,
              type: 'bb_ticket--bb_ticket',
              attributes: {
                identifier: row.identifier,
                title: row.title,
                state: 'done',
                closed: row.closed,
              },
            })),
            meta: { count: rows.length },
            links: { self: {} },
          };
        },
        collection: vi.fn(),
      },
    },
    requestDraw: vi.fn(),
    isActive: () => true,
    navigate: vi.fn(),
  } as unknown as ScreenContext;
  return { context, queries };
}

/**
 * Everything the operator can read on the screen, in one string.
 *
 * The cases below assert on THIS rather than on the meta line alone, because
 * where the hidden-count belongs — the count segment, the empty row, the status
 * line — is the fix's business and not the criterion's. What the criterion
 * requires is that the operator can read the number somewhere.
 */
const presented = (screen: TicketsScreen, context: ScreenContext): string => {
  const shown = screen.present(context);
  return [
    shown.meta,
    shown.status,
    shown.toast,
    ...renderTree(shown.body),
  ].join('\n');
};

/** Boot the list, open `/`, and type the query one character per keystroke —
 *  the way the kernel delivers it (`keyEventToKeys` yields one key per press). */
const search = async (text: string) => {
  const { context, queries } = harness();
  const screen = new TicketsScreen();
  screen.enter(context);
  await settle();
  screen.handleInput('/', context);
  for (const character of text) {
    screen.handleInput(character, context);
    await settle();
  }
  return { screen, context, queries };
};

describe('the tickets `/` search is a ticket-id filter', () => {
  it('boots on the shipped default, which hides closed rows', async () => {
    const { context, queries } = harness();
    const screen = new TicketsScreen();
    screen.enter(context);
    await settle();
    // The precondition the two cases below stand on: the closed ticket is in the
    // project and reachable, and it is the DEFAULT that leaves it out.
    expect(queries[0]).toContain('filter[closed]=0');
    expect(screen.rows.map((row) => row.identifier)).not.toContain('BB-73');
    expect(screen.rows).toHaveLength(20);
  });

  it('AC-1 — a full identifier whose ticket is closed says how many it is hiding', async () => {
    const { screen, context } = await search('BB-73');
    // The row deliberately does NOT arrive: the operator's `closed: hidden` still
    // rules, and this is the confirmed fix direction (server authority kept, and
    // nothing hidden silently). What must arrive is the REASON — `No tickets.`
    // beside a count the operator can act on.
    expect(screen.rows).toHaveLength(0);
    // Anchored so it cannot match ACROSS a `·` segment boundary or a line: the
    // meta line already carries the words `closed: hidden`, and a looser pattern
    // would pass on any frame that happens to state a 1 somewhere else.
    expect(presented(screen, context)).toMatch(/\b1\b[^·\n]{0,20}hidden/i);
  });

  it('AC-2 — an identifier fragment states the whole hidden count, not one of it', async () => {
    const { screen, context } = await search('73');
    // `73` is in no open identifier and in no title in this world, so BOTH matches
    // are closed ones — the case that catches a count reporting the page instead
    // of the collection.
    expect(screen.rows).toHaveLength(0);
    expect(presented(screen, context)).toMatch(/\b2\b[^·\n]{0,20}hidden/i);
  });

  it('AC-4 — the hidden count is the SERVER’s, measured without the closed filter', async () => {
    const { screen, context, queries } = await search('73');
    // The count is a real read of the collection, not a recount of the page the
    // screen happens to hold: the SAME search, with the one criterion that is
    // holding the rows back dropped from it. A `filter[closed]` on this query
    // would make it a count of what is SHOWN, which is the number the operator
    // can already read.
    const probe = queries.at(-1) ?? '';
    expect(searchValue(probe)).toBe('73');
    expect(probe).not.toContain('filter[closed]');
    // And the rows themselves are still the server's filtered page — the probe
    // explains the emptiness, it never fills it.
    expect(screen.rows).toHaveLength(0);
    expect(presented(screen, context)).toMatch(/\b2\b[^·\n]{0,20}hidden/i);
  });

  it('AC-3 — a title keyword still matches on title', async () => {
    const { screen } = await search('open ticket number 205');
    expect(screen.rows.map((row) => row.identifier)).toEqual(['BB-205']);
  });

  it('AC-6 — `/` says that search mode is open', async () => {
    // Measured on a real pty (`tests/pty/verify-id-search.mjs`, section 2): the
    // frame after `/` is BYTE-IDENTICAL to the frame before it, because the
    // `search:` segment appears only once the query is non-empty. An operator
    // cannot tell whether `/` registered — which is the other half of "not usable
    // as a ticket-id filter", and is in scope with the hidden-count copy (AC-6).
    const { context } = harness();
    const screen = new TicketsScreen();
    screen.enter(context);
    await settle();
    const before = presented(screen, context);
    screen.handleInput('/', context);
    expect(presented(screen, context)).not.toBe(before);
  });

  it("an unknown repository alias shows the server's message, not the status", async () => {
    const { screen, context } = await search('foo#1');
    const shown = presented(screen, context);
    expect(shown).toContain('No repository matches "foo"');
    expect(shown).not.toContain('HTTP 400');
  });

  it('a corrected search clears the refusal', async () => {
    const { screen, context } = await search('foo#1');
    for (const key of [
      'backspace',
      'backspace',
      'backspace',
      'backspace',
      'backspace',
    ]) {
      screen.handleInput(key, context);
      await settle();
    }
    screen.handleInput('2', context);
    await settle();
    expect(presented(screen, context)).not.toContain('No repository matches');
  });

  it('AC-5 — a query that matches nothing empties the list', async () => {
    const { screen } = await search('zzzz');
    expect(screen.rows).toHaveLength(0);
    expect(screen.state).toBe('ready');
  });

  it('AC-5 — a genuine no-match makes NO hidden-count claim', async () => {
    const { screen, context } = await search('zzzz');
    expect(screen.rows).toHaveLength(0);
    // Nothing is being held back, so nothing may be claimed. An `N hidden` here
    // would send the operator to press `x` for rows that do not exist anywhere,
    // which is the failure mode the legibility fix could introduce and the one
    // thing worse than today's bare `No tickets.`.
    //
    // The same anchor the two positive cases use, for the same reason: the meta
    // line carries the words `closed: hidden`, and only a `·`-free run of at
    // most twenty characters between a number and them is a CLAIM.
    expect(presented(screen, context)).not.toMatch(
      /\b\d+\b[^·\n]{0,20}hidden/i,
    );
  });
});
