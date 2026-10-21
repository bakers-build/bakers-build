import { describe, expect, it, vi } from 'vitest';
import { formatActionLadder } from '../../../../src/Component/footer-actions/index.js';
import type { PageWindow } from '../../../../src/Entity/collection.js';
import { DEFAULT_TICKET_CRITERIA } from '../../../../src/Entity/ticket/Data/query.js';
import { loadFilteredTickets } from '../../../../src/Entity/ticket/Data/tickets.js';
import { TicketsScreen } from '../../../../src/Entity/ticket/Screen/tickets.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import { nodeById, renderTree } from '../../../render-tree.js';

// BB-292 — the ticket list's paging half: the loader returns a PAGE (rows plus
// `hasNext` read off the document's `links.next`), the screen holds the page
// index, the ARROW KEYS move it, any criteria change resets it, and the STATUS
// line advertises only the moves that lead somewhere. Keys, page size (20) and
// the line the segment lives on were all set by the operator's live review.
//
// The kernel passes raw escape sequences through as `input` and handles
// `\x1b[A`/`\x1b[B` only as a fallback the screen pre-empts; `\x1b[C`/`\x1b[D`
// it does not handle at all, so the screen may claim them outright.
//
// The context harness mirrors `tests/Screen/tickets-parent-filter.test.ts`
// rather than introducing a second one, and takes the client `get` so a case can
// record the query string it was asked for.

const PROJECT = { id: 'project-1', name: 'Bb', slug: 'bakers' };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Count/page live in header meta under the title (BB-375). */
const bodyText = (screen: TicketsScreen, context: ScreenContext): string => {
  const shown = screen.present(context);
  return [shown.meta ?? '', renderTree(shown.body).join('\n')].join('\n');
};

type Get = (path: string, params?: unknown) => Promise<unknown>;

/**
 * The screen context with the client passed through verbatim.
 *
 * There is exactly ONE read per page since BB-292 D6e, so every case sees every
 * read the screen makes and no harness has to filter any of them out. The wrapper
 * that used to answer the background count walk locally is gone with the walk.
 */
function makeContext(client: { get: Get }): ScreenContext {
  return {
    sessionGeneration: 1,
    project: PROJECT,
    params: { projectId: PROJECT.id },
    services: {
      client: { get: client.get, collection: vi.fn() },
    },
    requestDraw: vi.fn(),
    isActive: () => true,
    navigate: vi.fn(),
  } as unknown as ScreenContext;
}

// Right/left as the kernel delivers them — one whole token, never split into
// `\x1b` + `[C` (`splitInput` holds a tail only once it commits to `\x1b[<`).
const RIGHT = 'right';
const LEFT = 'left';

const queryOf = (params: unknown): string =>
  decodeURIComponent((params as { getQueryString(): string }).getQueryString());

describe('the ticket list loader returns a page', () => {
  // Spec fact 6, measured: `page[limit]` bounds the QUERY, not the returned rows —
  // a run page asked for 15 and got 6 while more pages existed. So the end of the
  // list is `links.next`, and `rows.length === limit` is never a valid signal.
  it('reads hasNext from links.next, not from the row count', async () => {
    const doc = {
      data: [{ id: 'a', attributes: { identifier: 'BB-1' } }],
      links: { next: { href: 'https://example.test/next' }, self: {} },
    };
    const client = { get: async () => doc };
    const page = await loadFilteredTickets(
      client as never,
      'P1',
      DEFAULT_TICKET_CRITERIA,
    );
    expect(page.rows).toHaveLength(1);
    expect(page.hasNext).toBe(true);
    expect(page.page).toBe(0);
  });

  it('a full page with no links.next is the last page', async () => {
    const data = Array.from({ length: 20 }, (_, i) => ({
      id: `id-${i}`,
      attributes: { identifier: `bakers.build-${i}` },
    }));
    const client = { get: async () => ({ data, links: { self: {} } }) };
    const page = await loadFilteredTickets(
      client as never,
      'P1',
      DEFAULT_TICKET_CRITERIA,
    );
    expect(page.rows).toHaveLength(20);
    expect(page.hasNext).toBe(false);
  });

  it('the page index reaches the query as an offset', async () => {
    const seen: string[] = [];
    const client = {
      get: async (_path: string, params?: unknown) => {
        seen.push(queryOf(params));
        return { data: [], links: {} };
      },
    };
    await loadFilteredTickets(
      client as never,
      'P1',
      DEFAULT_TICKET_CRITERIA,
      2,
    );
    expect(seen[0]).toMatch(/page\[limit\]=20/);
    expect(seen[0]).toMatch(/page\[offset\]=40/);
  });
});

// BB-292 AC 8 (D6b) — the count read is the LIST read's own query with an
// identifier-only fieldset and no includes. A second copy of the filter
// construction would drift from the list's and silently count a different
// collection, so the assertions below pin it to the shared builder's output.
describe('the ticket screen holds and moves the page', () => {
  it('→ advances the page and ← goes back, never below page one (AC-3)', async () => {
    const offsets: string[] = [];
    const context = makeContext({
      get: async (_t: string, params?: unknown) => {
        offsets.push(queryOf(params));
        return {
          data: [{ id: 'a', attributes: { identifier: 'BB-1' } }],
          links: { next: {} },
        };
      },
    });
    const screen = new TicketsScreen();
    screen.enter(context);
    await tick();
    for (const key of [RIGHT, RIGHT, LEFT, LEFT, LEFT]) {
      screen.handleInput(key, context);
      await tick();
    }
    expect(
      offsets.filter((q) => q.includes('page[offset]=20')),
    ).not.toHaveLength(0);
    expect(
      offsets.filter((q) => q.includes('page[offset]=40')),
    ).not.toHaveLength(0);
    expect(offsets.filter((q) => q.includes('page[offset]=-20'))).toHaveLength(
      0,
    );
    // Back on page one, so the strip says so and actions offer no `← prev`.
    expect(bodyText(screen, context)).toMatch(/page 1/);
    expect(formatActionLadder(screen.present(context).actions)).not.toMatch(
      /← prev/,
    );
    expect(screen.present(context).status ?? '').not.toMatch(/page/);
  });

  // Count + page sit in header meta under the title (BB-375); ←/→ in actions.
  it('states the page in header meta and arrows in actions', async () => {
    const context = makeContext({
      get: async () => ({
        data: [{ id: 'a', attributes: { identifier: 'BB-1' } }],
        links: { next: {} },
      }),
    });
    const screen = new TicketsScreen();
    screen.enter(context);
    await tick();
    const frame = screen.present(context);
    const body = renderTree(frame.body).join('\n');
    expect(frame.meta ?? '').toMatch(/page 1/);
    expect(body).not.toMatch(/page 1/);
    expect(body).not.toMatch(/→ next/);
    expect(formatActionLadder(frame.actions)).toMatch(/→ next/);
    expect(frame.status ?? '').not.toMatch(/page/);
    expect(frame.meta ?? '').not.toMatch(/next|prev/);
  });

  // Count/page live in header meta (BB-375); a save message must not hide them.
  it('the paging segment survives a set status message', async () => {
    const context = makeContext({
      get: async () => ({
        data: [{ id: 'a', attributes: { identifier: 'BB-1' } }],
        links: { next: {} },
      }),
    });
    const screen = new TicketsScreen();
    screen.enter(context);
    await tick();
    screen.handleInput(RIGHT, context);
    await tick();
    screen.receiveResult(
      { type: 'ticket-assignment-updated', ticketId: 'a' },
      context,
    );
    const shown = screen.present(context);
    const status = shown.status;
    const body = bodyText(screen, context);
    expect(status).toMatch(/saved/);
    expect(status).not.toMatch(/page/);
    expect(body).toMatch(/page 2/);
    expect(formatActionLadder(shown.actions)).toMatch(/→ next/);
    expect(formatActionLadder(shown.actions)).toMatch(/← prev/);
  });

  // Otherwise narrowing a filter while on page 4 lands on an empty page with no
  // rows and no explanation (D5).
  it('any criteria change returns to page one (D5)', async () => {
    const context = makeContext({
      get: async () => ({ data: [], links: { next: {} } }),
    });
    const screen = new TicketsScreen();
    screen.enter(context);
    await tick();
    for (const key of ['s', 'x', 'c']) {
      screen.handleInput(RIGHT, context);
      await tick();
      expect(bodyText(screen, context)).toMatch(/page 2/);
      screen.handleInput(key, context);
      await tick();
      expect(bodyText(screen, context)).not.toMatch(/page [2-9]/);
    }
  });

  it('advertises → only when a next page exists and ← only past page one', async () => {
    const screen = new TicketsScreen();
    const last = makeContext({
      get: async () => ({ data: [], links: { self: {} } }),
    });
    screen.enter(last);
    await tick();
    expect(formatActionLadder(screen.present(last).actions)).not.toMatch(
      /→ next/,
    );
    expect(formatActionLadder(screen.present(last).actions)).not.toMatch(
      /← prev/,
    );
  });

  // The `/` field is an append/backspace buffer with no cursor to move, so the
  // arrows are INERT while it is open: consumed (they reach the searchMode
  // branch first), not appended as text — its text branch takes single
  // characters only — and above all they do not page underneath the field.
  it('the arrows are inert in search mode: no text, no paging', async () => {
    const queries: string[] = [];
    const context = makeContext({
      get: async (_t: string, params?: unknown) => {
        queries.push(queryOf(params));
        return { data: [], links: { next: {} } };
      },
    });
    const screen = new TicketsScreen();
    screen.enter(context);
    await tick();
    screen.handleInput('/', context);
    for (const key of [RIGHT, LEFT]) {
      expect(screen.handleInput(key, context)).toBe(true);
    }
    await tick();
    expect(renderTree(screen.present(context).body).join('\n')).not.toMatch(
      /search: ./,
    );
    expect(screen.present(context).meta ?? '').not.toMatch(/search: ./);
    expect(bodyText(screen, context)).toMatch(/page 1/);
    expect(queries.some((q) => q.includes('page[offset]'))).toBe(false);
  });

  it('saveState carries the page so a round trip returns to it', async () => {
    // The ordering is the ROUTER's: `back()` calls `navigate` (hence `enter`,
    // which resets a screen whose context key changed) and only then
    // `restoreState` — so a page restored before `enter` would be reset away.
    const queries: string[] = [];
    const context = makeContext({
      get: async (_t: string, params?: unknown) => {
        queries.push(queryOf(params));
        return { data: [], links: { next: {} } };
      },
    });
    const screen = new TicketsScreen();
    screen.enter(context);
    await tick();
    screen.handleInput(RIGHT, context);
    await tick();
    const token = screen.saveState();
    expect(token).toMatchObject({ page: 1 });

    const returned = new TicketsScreen();
    returned.enter(context);
    await tick();
    returned.restoreState(token);
    // The restored index is load-bearing, and the label follows the ROWS: until
    // the reload it triggers has landed, the rows on screen are still page one
    // and the label has to say so (BB-292 review, defect 1).
    queries.length = 0;
    returned.reload(context);
    await tick();
    expect(queries[0]).toMatch(/page\[offset\]=20/);
    expect(bodyText(returned, context)).toMatch(/page 2/);
  });

  // The reset-then-restore ordering is `enter`'s: a changed contextKey or
  // sessionGeneration resets the screen, `start()` loads page ONE, and the
  // router restores the saved index only afterwards. The label must describe
  // the rows that were actually loaded, never the index alone.
  it('the page label describes the rows on screen, not a restored index', async () => {
    const context = makeContext({
      get: async (_t: string, params?: unknown) => {
        const offset = /page\[offset\]=(\d+)/.exec(queryOf(params))?.[1] ?? '0';
        return {
          data: [
            {
              id: `row-${offset}`,
              attributes: { identifier: `ROW@offset${offset}` },
            },
          ],
          links: { next: {} },
        };
      },
    });
    const screen = new TicketsScreen();
    screen.enter(context);
    await tick();
    screen.handleInput(RIGHT, context);
    await tick();
    const token = screen.saveState();
    expect(screen.rows[0]?.identifier).toBe('ROW@offset20');

    // A new session resets the screen through `enter`; the restore lands after.
    const bumped = { ...context, sessionGeneration: 2 } as ScreenContext;
    screen.enter(bumped);
    await tick();
    screen.restoreState(token);

    expect(screen.rows[0]?.identifier).toBe('ROW@offset0');
    const _status = screen.present(bumped).status;
    const body = bodyText(screen, bumped);
    expect(body).toMatch(/page 1/);
    expect(body).not.toMatch(/page 2/);
    // Page one has no previous page, whatever the restored index claims.
    expect(formatActionLadder(screen.present(bumped).actions)).not.toMatch(
      /← prev/,
    );
  });

  // BB-292 R1 — the page the screen SHOWS, the page the pager ACTS ON and the
  // page the search overlay WRITES BACK are one derived value. The cases below
  // drive the same reset-then-restore ordering as the label case above, which is
  // the only state in which the remembered index and the loaded page come apart,
  // and read what the KEY does rather than what the line says.
  //
  // Rows are labelled by the offset they came from, so the assertions name the
  // page a row is drawn from rather than trusting the screen's own arithmetic.
  const offsetLabelledContext = (
    offsets: string[],
    links: Record<string, unknown> = { next: {} },
  ) =>
    makeContext({
      get: async (_t: string, params?: unknown) => {
        const query = queryOf(params);
        offsets.push(query);
        const offset = /page\[offset\]=(\d+)/.exec(query)?.[1] ?? '0';
        return {
          data: [
            {
              id: `row-${offset}`,
              attributes: { identifier: `ROW@offset${offset}` },
            },
          ],
          links,
        };
      },
    });

  it('→ requests the page after the one on screen, not after the restored index', async () => {
    const offsets: string[] = [];
    const context = offsetLabelledContext(offsets);
    const screen = new TicketsScreen();
    screen.enter(context);
    await tick();
    screen.handleInput(RIGHT, context);
    await tick();
    const token = screen.saveState();

    // `enter` resets on the new session and loads page ONE; the router restores
    // the remembered index (1) only afterwards. Page one is what is on screen.
    const bumped = { ...context, sessionGeneration: 2 } as ScreenContext;
    screen.enter(bumped);
    await tick();
    screen.restoreState(token);
    expect(screen.rows[0]?.identifier).toBe('ROW@offset0');
    expect(bodyText(screen, bumped)).toMatch(/page 1/);
    offsets.length = 0;
    screen.handleInput(RIGHT, bumped);
    await tick();
    // Page TWO, and exactly one request for it. Reading the remembered index
    // instead asks for page three and steps over page two entirely (AC-3).
    expect(offsets).toHaveLength(1);
    expect(offsets[0]).toMatch(/page\[offset\]=20/);
    expect(screen.rows[0]?.identifier).toBe('ROW@offset20');
  });

  it('← requests nothing from a page-one frame, whatever index was restored', async () => {
    const offsets: string[] = [];
    const context = offsetLabelledContext(offsets);
    const screen = new TicketsScreen();
    screen.enter(context);
    await tick();
    for (const _ of [0, 1]) {
      screen.handleInput(RIGHT, context);
      await tick();
    }
    const token = screen.saveState();
    expect(token).toMatchObject({ page: 2 });

    const bumped = { ...context, sessionGeneration: 2 } as ScreenContext;
    screen.enter(bumped);
    await tick();
    screen.restoreState(token);
    // Actions offer no `← prev`, so the key must lead nowhere. Acting on the
    // remembered index would send `←` FORWARDS, to page two.
    expect(formatActionLadder(screen.present(bumped).actions)).not.toMatch(
      /← prev/,
    );
    offsets.length = 0;
    screen.handleInput(LEFT, bumped);
    await tick();
    expect(offsets).toHaveLength(0);
    expect(screen.rows[0]?.identifier).toBe('ROW@offset0');
    expect(bodyText(screen, bumped)).toMatch(/page 1/);
  });

  // The guard that decides whether `→` leads anywhere has to read the same page
  // the affordance was derived from. This case pins the two together: the loaded
  // page is the last one (`hasNext: false`) while the remembered index is higher,
  // so a guard comparing against that index would wave the request through.
  it('the forward guard consults the loaded page, not the remembered index', async () => {
    const offsets: string[] = [];
    const context = offsetLabelledContext(offsets, { self: {} });
    const screen = new TicketsScreen();
    screen.enter(context);
    await tick();
    screen.restoreState({ criteria: DEFAULT_TICKET_CRITERIA, page: 3 });
    expect(formatActionLadder(screen.present(context).actions)).not.toMatch(
      /→ next/,
    );
    offsets.length = 0;
    screen.handleInput(RIGHT, context);
    await tick();
    expect(offsets).toHaveLength(0);
  });

  // One keystroke in the `/` field used to renumber the list: the optimistic
  // narrowing wrote the REQUESTED index into the loaded page it was narrowing,
  // so a page-one frame relabelled itself `page 2` over page-one rows.
  it('/ plus one character does not renumber the page it narrows', async () => {
    const offsets: string[] = [];
    const context = offsetLabelledContext(offsets);
    const screen = new TicketsScreen();
    screen.enter(context);
    await tick();
    screen.handleInput(RIGHT, context);
    await tick();
    const token = screen.saveState();

    const bumped = {
      ...context,
      sessionGeneration: 2,
      // The debounced reload is not what this case is about; hold it off so the
      // assertion reads the optimistic narrowing alone.
      options: { debounce: () => () => {} },
    } as unknown as ScreenContext;
    screen.enter(bumped);
    await tick();
    screen.restoreState(token);
    expect(bodyText(screen, bumped)).toMatch(/page 1/);
    screen.handleInput('/', bumped);
    screen.handleInput('R', bumped);
    const _status = screen.present(bumped).status;
    const body = bodyText(screen, bumped);
    expect(body).toMatch(/page 1/);
    expect(body).not.toMatch(/page 2/);
    expect(formatActionLadder(screen.present(bumped).actions)).not.toMatch(
      /← prev/,
    );
    expect(screen.rows[0]?.identifier).toBe('ROW@offset0');
  });

  // ---------------------------------------------------------------------------
  // BB-292 AC 8 (D6b) — the meta line states the size of the FILTERED
  // COLLECTION, not the size of the page. `20 ticket(s)` beside a collection of
  // 105 is wrong by more than an order of magnitude, and it is the one number on
  // that line an operator reads as a total.
  //
  // The count is a background walk, so every case below distinguishes the LIST
  // read (`page[limit]=20`) from the COUNT reads (`page[limit]=50`, the server's
  // cap) and asserts on the number the line actually states.
  // ---------------------------------------------------------------------------
  const settle = async () => {
    for (let i = 0; i < 30; i++) await tick();
  };
  // `closed` is carried because the server carries it: it is in
  // `TICKET_PREDICATE_ATTRIBUTES`, and the screen's own `filterRow` re-applies the
  // closed predicate to the page. A fixture omitting it reads as OPEN, so a
  // `filter[closed]=1` page was re-filtered down to nothing — invisible while the
  // meta line stated only the total, visible the moment it states the rows too.
  // `total` is the server's own `meta.count` (BB-292 D6e, BB-305): omit it and
  // the fixture is a control plane that reports no total, which is the dev2 case.
  const rowsPage = (
    rows: number,
    last = false,
    closed = false,
    total?: number,
  ) => ({
    data: Array.from({ length: rows }, (_, i) => ({
      id: `t${i}`,
      attributes: { identifier: `bakers.build-${i}`, closed },
    })),
    ...(total === undefined ? {} : { meta: { count: total } }),
    links: last ? { self: {} } : { next: {} },
  });

  it('states the rows on screen and the total the page reported, in ONE read', async () => {
    // BB-292 D6e / AC 8.1-8.2: the total rides `meta.count` on the page
    // response, so it cannot arrive after the rows and cannot cost a read of its
    // own. The walk this replaces cost 3 reads for this collection and 28 for the
    // open runs.
    let reads = 0;
    const context = makeContext({
      get: async () => {
        reads++;
        return rowsPage(20, false, false, 105);
      },
    });
    const screen = new TicketsScreen();
    screen.enter(context);
    await settle();
    expect(screen.rows).toHaveLength(20);
    // BB-312: the twenty rows fill the window the read asked for, so the line
    // states WHERE they sit as well as how many there are.
    expect(bodyText(screen, context)).toMatch(/1–20 of 105 ticket\(s\)/);
    expect(reads).toBe(1);
  });

  it('a page reporting no total states the explicit unknown (AC 8.5/8.6)', async () => {
    // Measured on dev2 this session, which still runs `develop`: the document
    // carries a `meta` with only `omitted` and no `count`. The rows are
    // unaffected, and the line says it does not know rather than presenting the
    // twenty rows on screen as the collection's size.
    const context = makeContext({ get: async () => rowsPage(20) });
    const screen = new TicketsScreen();
    screen.enter(context);
    await settle();
    expect(screen.rows).toHaveLength(20);
    expect(screen.state).toBe('ready');
    expect(bodyText(screen, context)).toMatch(/1–20 of \? ticket\(s\)/);
    expect(bodyText(screen, context)).not.toMatch(/^1–20 ticket/);
  });

  it('a meta.count that is not a usable number is never shown as a total (AC 8.5)', async () => {
    const context = makeContext({
      get: async () => ({ ...rowsPage(20), meta: { count: 'lots' } }),
    });
    const screen = new TicketsScreen();
    screen.enter(context);
    await settle();
    expect(screen.rows).toHaveLength(20);
    expect(bodyText(screen, context)).toMatch(/1–20 of \? ticket\(s\)/);
  });

  it('paging costs exactly one read per page and re-states the total (AC 8.4)', async () => {
    let reads = 0;
    const context = makeContext({
      get: async () => {
        reads++;
        return rowsPage(20, false, false, 42);
      },
    });
    const screen = new TicketsScreen();
    screen.enter(context);
    await settle();
    expect(bodyText(screen, context)).toMatch(/1–20 of 42 ticket\(s\)/);
    expect(reads).toBe(1);
    screen.handleInput(RIGHT, context);
    await settle();
    // BB-312: the total is re-stated per page AND the position moves with it —
    // the defect was this line reading `20 of 42` on both pages alike.
    expect(bodyText(screen, context)).toMatch(/21–40 of 42 ticket\(s\)/);
    expect(reads).toBe(2);
    screen.handleInput(LEFT, context);
    await settle();
    expect(bodyText(screen, context)).toMatch(/1–20 of 42 ticket\(s\)/);
    // One read per page and not one more — the assertion that the walk is GONE
    // rather than merely quiet.
    expect(reads).toBe(3);
  });

  it('a criteria change states the new collection total, never the old (AC 8.3)', async () => {
    // Structural since D6e: the number the line states is read off the same
    // response the rows travelled on, so a superseded total has no path onto the
    // screen at all. The walk needed a criteria-key check to achieve this.
    const seen: string[] = [];
    const context = makeContext({
      get: async (_t: string, params?: unknown) => {
        const query = queryOf(params);
        seen.push(query);
        const closedOnly = query.includes('filter[closed]=1');
        return rowsPage(20, false, closedOnly, closedOnly ? 7 : 999);
      },
    });
    const screen = new TicketsScreen();
    screen.enter(context);
    await settle();
    expect(seen[0]).toContain('filter[closed]=0');
    expect(bodyText(screen, context)).toMatch(/1–20 of 999 ticket\(s\)/);

    screen.handleInput('x', context);
    await settle();
    expect(seen[1]).toContain('filter[closed]=1');
    expect(bodyText(screen, context)).toMatch(/20 of 7 ticket\(s\)/);
    expect(screen.present(context).meta ?? '').not.toMatch(/999/);
  });

  it("every criteria change re-reads, and the total stated is that read's (AC 8.3)", async () => {
    const seen: string[] = [];
    const context = makeContext({
      get: async (_t: string, params?: unknown) => {
        const query = queryOf(params);
        seen.push(query);
        return rowsPage(
          20,
          false,
          query.includes('filter[closed]=1'),
          seen.length,
        );
      },
    });
    const screen = new TicketsScreen();
    screen.enter(context);
    await settle();
    expect(seen).toHaveLength(1);
    for (const key of ['s', 's', 'x']) {
      screen.handleInput(key, context);
      await settle();
    }
    expect(seen).toHaveLength(4);
    expect(seen[1]).toContain('filter[state]=triage');
    expect(seen[2]).toContain('filter[state]=backlog');
    expect(seen[3]).toContain('filter[closed]=1');
    // BB-299 AC-2: `t` is a no-op since the type filter is gone — no re-read.
    screen.handleInput('t', context);
    await settle();
    expect(seen).toHaveLength(4);
    // The fourth read reported 4, and that is the number on the line — never the
    // 1 the first read reported.
    expect(bodyText(screen, context)).toMatch(/of 4 ticket\(s\)/);
  });

  it('drops the count segment while the page loads, leaving no dangling separator (D6c)', async () => {
    const context = makeContext({
      get: () => new Promise<unknown>(() => {}),
    });
    const screen = new TicketsScreen();
    screen.enter(context);
    await tick();
    expect(screen.state).toBe('loading');
    const shown = screen.present(context);
    expect(shown.meta ?? '').not.toMatch(/ticket\(s\)/);
    // BB-375 — filter keys in badge strip; short actions in footer.
    expect(formatActionLadder(shown.actions)).toContain('n new · e edit');
    expect(shown.meta ?? '').not.toContain('/ search');
    expect(renderTree(screen.present(context).body).join('\n')).toContain(
      'closed: hidden',
    );
    expect(
      renderTree(
        nodeById(screen.present(context).body, 'tickets-filter-closed-chip')!,
      ).join(''),
    ).toBe('x closed: hidden');
  });

  it('a search keystroke drops the old total instead of stating it beside narrowed rows', async () => {
    const context = makeContext({
      get: async () => rowsPage(20, false, false, 42),
    });
    // The debounced reload is not what this case is about; hold it off so the
    // assertion reads the OPTIMISTIC narrowing alone.
    const held = {
      ...context,
      options: { debounce: () => () => {} },
    } as unknown as ScreenContext;
    const screen = new TicketsScreen();
    screen.enter(held);
    await settle();
    expect(bodyText(screen, held)).toMatch(/1–20 of 42 ticket\(s\)/);

    screen.handleInput('/', held);
    screen.handleInput('G', held);
    const meta = screen.present(held).meta;
    expect(meta).not.toMatch(/42/);
    // Nothing is established for the narrowed collection yet, so the line states
    // the explicit unknown rather than the superseded 42 (D6d). `G` matches every
    // fixture identifier, so the narrowing dropped nothing and the window still
    // positions the rows (BB-312 D4) — only the TOTAL is unknown.
    expect(bodyText(screen, held)).toMatch(/1–20 of \? ticket\(s\)/);
  });

  // BB-312 D4 — the optimistic narrowing runs on the loaded page while the
  // debounced reload is in flight, so it states its window by the same rule
  // `ListScreen.load()` uses: a narrowing that DROPPED rows scatters the
  // survivors through the window the server was asked for, one that dropped
  // nothing changes no position. Asserted on the window itself rather than on the
  // rendered line, because the line is `countLabel`'s subject and this is the
  // page's.
  class WindowProbe extends TicketsScreen {
    windowForTest(): PageWindow | null {
      return this.readyValue?.window ?? null;
    }
  }

  /** The screen on a full loaded page, with the debounced reload held off so the
   *  assertion reads the OPTIMISTIC narrowing alone. */
  const narrowingProbe = async (): Promise<{
    screen: WindowProbe;
    held: ScreenContext;
  }> => {
    const context = makeContext({
      get: async () => rowsPage(20, false, false, 42),
    });
    const held = {
      ...context,
      options: { debounce: () => () => {} },
    } as unknown as ScreenContext;
    const screen = new WindowProbe();
    screen.enter(held);
    await settle();
    return { screen, held };
  };

  it('the optimistic search narrowing KEEPS the window when it drops nothing (BB-312 D4)', async () => {
    const { screen, held } = await narrowingProbe();
    expect(screen.windowForTest()).toEqual({ offset: 0, limit: 20 });
    // Every fixture identifier is `bakers.build-<n>`, so `G` matches all twenty: the rows
    // on screen are still the whole window and still sit where it says.
    screen.handleInput('/', held);
    screen.handleInput('G', held);
    expect(screen.rows).toHaveLength(20);
    expect(screen.windowForTest()).toEqual({ offset: 0, limit: 20 });
  });

  it('the optimistic search narrowing DROPS the window when it drops rows (BB-312 D4)', async () => {
    const { screen, held } = await narrowingProbe();
    // `1` matches BB-1 and BB-10..19 — eleven of the twenty. The survivors are
    // scattered through the window, so the window no longer positions them.
    screen.handleInput('/', held);
    screen.handleInput('1', held);
    expect(screen.rows).toHaveLength(11);
    expect(screen.windowForTest()).toBe(null);
  });

  it('a stale token cannot smuggle a negative page', async () => {
    const queries: string[] = [];
    const context = makeContext({
      get: async (_t: string, params?: unknown) => {
        queries.push(queryOf(params));
        return { data: [], links: {} };
      },
    });
    const screen = new TicketsScreen();
    screen.enter(context);
    await tick();
    // Restored AFTER enter, the way the router does it — so the clamp is what
    // stands between a stale token and `page[offset]=-60`.
    screen.restoreState({ criteria: DEFAULT_TICKET_CRITERIA, page: -4 });
    expect(bodyText(screen, context)).not.toMatch(/page -/);
    expect(bodyText(screen, context)).toMatch(/page 1/);
    queries.length = 0;
    screen.reload(context);
    await tick();
    expect(queries[0]).not.toMatch(/page\[offset\]/);
  });
});
