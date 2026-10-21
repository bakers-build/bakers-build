import { describe, expect, it, vi } from 'vitest';
import { formatActionLadder } from '../../../../src/Component/footer-actions/index.js';
import { loadProjectRuns } from '../../../../src/Entity/run/Data/runs.js';
import { RunsScreen } from '../../../../src/Entity/run/Screen/runs.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import { renderTree } from '../../../render-tree.js';

// BB-292 — the run list's paging half. It mirrors the ticket screen's cases
// deliberately: the two lists must not drift. The ARROW keys, the page size (20)
// and the under-table paging strip (BB-375) were all set by the operator's live
// review. A page that still offers a next page while showing few rows is correct
// rather than a bug — `links.next` is the end-of-collection signal, and a page
// can be full without being the last.

const PROJECT = { id: 'project-1', name: 'Bb', slug: 'bakers' };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Count/page live in header meta under the title (BB-375). */
const bodyText = (screen: RunsScreen, context: ScreenContext): string => {
  const shown = screen.present(context);
  return [shown.meta ?? '', renderTree(shown.body).join('\n')].join('\n');
};

type Get = (path: string, params?: unknown) => Promise<unknown>;

/**
 * The screen context with the client passed through verbatim.
 *
 * There is exactly ONE read per page since BB-292 D6e, so every case sees every
 * read the screen makes. The wrapper that used to answer the background count
 * walk locally is gone with the walk.
 */
function makeContext(client: { get: Get }): ScreenContext {
  return {
    sessionGeneration: 1,
    project: PROJECT,
    params: { projectId: PROJECT.id },
    services: { client: { get: client.get, collection: vi.fn() } },
    requestDraw: vi.fn(),
    isActive: () => true,
    navigate: vi.fn(),
  } as unknown as ScreenContext;
}

// Right/left as the kernel delivers them: it handles `\x1b[A`/`\x1b[B` as a
// fallback but `\x1b[C`/`\x1b[D` not at all, so the screen claims them outright.
const RIGHT = 'right';
const LEFT = 'left';

const queryOf = (params: unknown): string =>
  decodeURIComponent((params as { getQueryString(): string }).getQueryString());

describe('the run list loader returns a page', () => {
  // The ragged page is the run list's own behaviour, measured: same filter,
  // `page[limit]=15` (the cap at the time of that measurement) returned 6 rows
  // while 1340 were reachable. A short page must still offer the next one.
  it('a 6-row page still reports hasNext when links.next is present', async () => {
    const data = Array.from({ length: 6 }, (_, i) => ({
      id: `r${i}`,
      attributes: {},
    }));
    const client = { get: async () => ({ data, links: { next: {} } }) };
    const page = await loadProjectRuns(client as never, 'P1', {
      closed: false,
    });
    expect(page.rows).toHaveLength(6);
    expect(page.hasNext).toBe(true);
    expect(page.page).toBe(0);
  });

  it('a page with no links.next is the last page', async () => {
    const client = { get: async () => ({ data: [], links: { self: {} } }) };
    const page = await loadProjectRuns(client as never, 'P1', {
      closed: false,
    });
    expect(page.hasNext).toBe(false);
  });

  it('the page index reaches the query as an offset', async () => {
    const seen: string[] = [];
    const client = {
      get: async (_p: string, params?: unknown) => {
        seen.push(queryOf(params));
        return { data: [], links: {} };
      },
    };
    await loadProjectRuns(client as never, 'P1', { closed: false }, 3);
    expect(seen[0]).toMatch(/page\[limit\]=20/);
    expect(seen[0]).toMatch(/page\[offset\]=60/);
  });
});

describe('the run screen holds and moves the page', () => {
  it('→ advances the run page and the closed cycle returns to page one', async () => {
    const queries: string[] = [];
    const context = makeContext({
      get: async (_t: string, params?: unknown) => {
        queries.push(queryOf(params));
        return { data: [], links: { next: {} } };
      },
    });
    const screen = new RunsScreen();
    screen.enter(context);
    await tick();
    screen.handleInput(RIGHT, context);
    await tick();
    expect(queries.some((q) => q.includes('page[offset]=20'))).toBe(true);
    expect(bodyText(screen, context)).toMatch(/page 2/);
    // Count/page sit in header meta under the title (BB-375); ←/→ in actions.
    expect(screen.present(context).meta ?? '').toMatch(/page 2/);
    expect(formatActionLadder(screen.present(context).actions)).toMatch(
      /← prev/,
    );
    screen.handleInput('x', context);
    await tick();
    expect(bodyText(screen, context)).toMatch(/page 1/);
  });

  it('← never goes below page one', async () => {
    const queries: string[] = [];
    const context = makeContext({
      get: async (_t: string, params?: unknown) => {
        queries.push(queryOf(params));
        return { data: [], links: { next: {} } };
      },
    });
    const screen = new RunsScreen();
    screen.enter(context);
    await tick();
    screen.handleInput(LEFT, context);
    await tick();
    expect(queries.some((q) => q.includes('page[offset]'))).toBe(false);
    expect(formatActionLadder(screen.present(context).actions)).not.toMatch(
      /← prev/,
    );
  });

  it('advertises → only when a next page exists', async () => {
    const context = makeContext({
      get: async () => ({ data: [], links: { self: {} } }),
    });
    const screen = new RunsScreen();
    screen.enter(context);
    await tick();
    expect(formatActionLadder(screen.present(context).actions)).not.toMatch(
      /→ next/,
    );
  });

  it('saveState carries the run page', async () => {
    const context = makeContext({
      get: async () => ({ data: [], links: { next: {} } }),
    });
    const screen = new RunsScreen();
    screen.enter(context);
    await tick();
    screen.handleInput(RIGHT, context);
    await tick();
    expect(screen.saveState()).toMatchObject({ page: 1 });
  });

  // Symmetrical to the ticket list's case: `enter` resets on a new session,
  // loads page ONE, and the router restores the saved index only afterwards.
  it('the page label describes the rows on screen, not a restored index', async () => {
    const context = makeContext({
      get: async (_t: string, params?: unknown) => {
        const offset = /page\[offset\]=(\d+)/.exec(queryOf(params))?.[1] ?? '0';
        return {
          data: [
            {
              id: `r-${offset}`,
              attributes: { agent: `agent@offset${offset}` },
            },
          ],
          links: { next: {} },
        };
      },
    });
    const screen = new RunsScreen();
    screen.enter(context);
    await tick();
    screen.handleInput(RIGHT, context);
    await tick();
    const token = screen.saveState();
    expect(screen.rows[0]?.agent).toBe('agent@offset20');

    const bumped = { ...context, sessionGeneration: 2 } as ScreenContext;
    screen.enter(bumped);
    await tick();
    screen.restoreState(token);

    expect(screen.rows[0]?.agent).toBe('agent@offset0');
    const _status = screen.present(bumped).status;
    const body = bodyText(screen, bumped);
    expect(body).toMatch(/page 1/);
    expect(body).not.toMatch(/page 2/);
    expect(formatActionLadder(screen.present(bumped).actions)).not.toMatch(
      /← prev/,
    );
  });

  // BB-292 R1 — symmetrical to the ticket list, minus the search case: this
  // screen has no `/` field, so it has two of the three read sites. The page the
  // screen SHOWS and the page the pager ACTS ON must be the one derived value,
  // driven through the same reset-then-restore ordering as the label case above.
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
              id: `r-${offset}`,
              attributes: { agent: `agent@offset${offset}` },
            },
          ],
          links,
        };
      },
    });

  it('→ requests the page after the one on screen, not after the restored index', async () => {
    const offsets: string[] = [];
    const context = offsetLabelledContext(offsets);
    const screen = new RunsScreen();
    screen.enter(context);
    await tick();
    screen.handleInput(RIGHT, context);
    await tick();
    const token = screen.saveState();

    const bumped = { ...context, sessionGeneration: 2 } as ScreenContext;
    screen.enter(bumped);
    await tick();
    screen.restoreState(token);
    expect(screen.rows[0]?.agent).toBe('agent@offset0');
    expect(bodyText(screen, bumped)).toMatch(/page 1/);
    offsets.length = 0;
    screen.handleInput(RIGHT, bumped);
    await tick();
    expect(offsets).toHaveLength(1);
    expect(offsets[0]).toMatch(/page\[offset\]=20/);
    expect(screen.rows[0]?.agent).toBe('agent@offset20');
  });

  it('← requests nothing from a page-one frame, whatever index was restored', async () => {
    const offsets: string[] = [];
    const context = offsetLabelledContext(offsets);
    const screen = new RunsScreen();
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
    expect(formatActionLadder(screen.present(bumped).actions)).not.toMatch(
      /← prev/,
    );
    offsets.length = 0;
    screen.handleInput(LEFT, bumped);
    await tick();
    expect(offsets).toHaveLength(0);
    expect(screen.rows[0]?.agent).toBe('agent@offset0');
    expect(bodyText(screen, bumped)).toMatch(/page 1/);
  });

  it('the forward guard consults the loaded page, not the remembered index', async () => {
    const offsets: string[] = [];
    const context = offsetLabelledContext(offsets, { self: {} });
    const screen = new RunsScreen();
    screen.enter(context);
    await tick();
    screen.restoreState({ criteria: { closed: false }, page: 3 });
    expect(formatActionLadder(screen.present(context).actions)).not.toMatch(
      /→ next/,
    );
    offsets.length = 0;
    screen.handleInput(RIGHT, context);
    await tick();
    expect(offsets).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // BB-292 AC 8 (D6b) — mirrors the ticket list's cases, because the two lists
  // must not drift. `7 run(s)` beside a collection of 1340 was the worst of the
  // two wrong numbers.
  // ---------------------------------------------------------------------------
  const settle = async () => {
    for (let i = 0; i < 30; i++) await tick();
  };
  // `closed` is carried because the server carries it: it is in
  // `RUN_PREDICATE_ATTRIBUTES`, and the screen's own `filterRow` re-applies the
  // closed predicate to the page. A fixture omitting it reads as OPEN, so a
  // `filter[closed]=1` page was re-filtered down to nothing — invisible while the
  // meta line stated only the total, visible the moment it states the rows too.
  // `total` is the server's own `meta.count` (BB-292 D6e, BB-305); omit it and
  // the fixture is a control plane that reports no total, which is the dev2 case.
  const rowsPage = (
    rows: number,
    last = false,
    closed = false,
    total?: number,
  ) => ({
    data: Array.from({ length: rows }, (_, i) => ({
      id: `r${i}`,
      attributes: { agent: `agent-${i}`, closed },
    })),
    ...(total === undefined ? {} : { meta: { count: total } }),
    links: last ? { self: {} } : { next: {} },
  });

  it('states the rows on screen and the total the page reported, in ONE read', async () => {
    // The run collection is the one the walk cost most on: 1340 rows were 28
    // sequential reads over ~9.3 s. The page response now carries the number.
    // The list page here is short and still offers a next page, which is correct.
    let reads = 0;
    const context = makeContext({
      get: async () => {
        reads++;
        return rowsPage(7, false, false, 140);
      },
    });
    const screen = new RunsScreen();
    screen.enter(context);
    await settle();
    expect(screen.rows).toHaveLength(7);
    expect(bodyText(screen, context)).toMatch(/7 of 140 run\(s\)/);
    expect(reads).toBe(1);
  });

  it('a page reporting no total states the explicit unknown (AC 8.5/8.6)', async () => {
    const context = makeContext({ get: async () => rowsPage(7) });
    const screen = new RunsScreen();
    screen.enter(context);
    await settle();
    expect(screen.rows).toHaveLength(7);
    expect(screen.state).toBe('ready');
    expect(bodyText(screen, context)).toMatch(/7 of \? run\(s\)/);
    expect(bodyText(screen, context)).not.toMatch(/^7 run/);
  });

  it('paging costs exactly one read per page and re-states the total (AC 8.4)', async () => {
    let reads = 0;
    const context = makeContext({
      get: async () => {
        reads++;
        return rowsPage(7, false, false, 140);
      },
    });
    const screen = new RunsScreen();
    screen.enter(context);
    await settle();
    expect(bodyText(screen, context)).toMatch(/7 of 140 run\(s\)/);
    expect(reads).toBe(1);
    screen.handleInput(RIGHT, context);
    await settle();
    expect(bodyText(screen, context)).toMatch(/7 of 140 run\(s\)/);
    screen.handleInput(LEFT, context);
    await settle();
    expect(bodyText(screen, context)).toMatch(/7 of 140 run\(s\)/);
    expect(reads).toBe(3);
  });

  // `x` on this screen resets the page INLINE rather than through a `setCriteria`.
  // That used to matter because the count's invalidation had to be keyed on the
  // criteria themselves; with the total riding its own page response it cannot go
  // stale by any route.
  it('the closed cycle states the new collection total, never the old (AC 8.3)', async () => {
    const seen: string[] = [];
    const context = makeContext({
      get: async (_t: string, params?: unknown) => {
        const query = queryOf(params);
        seen.push(query);
        const closedOnly = query.includes('filter[closed]=1');
        return rowsPage(7, false, closedOnly, closedOnly ? 12 : 999);
      },
    });
    const screen = new RunsScreen();
    screen.enter(context);
    await settle();
    expect(seen[0]).toContain('filter[closed]=0');
    expect(bodyText(screen, context)).toMatch(/7 of 999 run\(s\)/);

    screen.handleInput('x', context);
    await settle();
    expect(seen[1]).toContain('filter[closed]=1');
    expect(bodyText(screen, context)).toMatch(/7 of 12 run\(s\)/);
    expect(screen.present(context).meta ?? '').not.toMatch(/999/);
  });

  it('drops the count segment while the page loads, leaving no dangling separator (D6c)', async () => {
    // The loading window. Nothing is on screen but `Loading runs…`, so the line
    // states no row count and implies no total — and the segment it opens with is
    // the next real one, not a separator.
    const context = makeContext({
      get: () => new Promise<unknown>(() => {}),
    });
    const screen = new RunsScreen();
    screen.enter(context);
    await tick();
    expect(screen.state).toBe('loading');
    const shown = screen.present(context);
    expect(shown.meta ?? '').not.toMatch(/run\(s\)/);
    // Closed lives in the badge strip; screen keys live in footer actions.
    expect(shown.meta ?? '').not.toContain('closed:');
    expect(formatActionLadder(shown.actions)).toContain('Enter ticket');
    expect(formatActionLadder(shown.actions)).toContain('Tab tabs');
  });

  it('a stale token cannot smuggle a negative page', async () => {
    const context = makeContext({
      get: async () => ({ data: [], links: {} }),
    });
    const screen = new RunsScreen();
    screen.enter(context);
    await tick();
    screen.restoreState({ criteria: { closed: false }, page: -7 });
    expect(bodyText(screen, context)).toMatch(/page 1/);
    expect(bodyText(screen, context)).not.toMatch(/page -/);
  });
});
