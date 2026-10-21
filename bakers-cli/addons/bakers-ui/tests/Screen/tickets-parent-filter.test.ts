import { describe, expect, it, vi } from 'vitest';
import { TicketsScreen } from '../../src/Entity/ticket/Screen/tickets.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import { renderTree } from '../render-tree.js';

// BB-284 D6 — the ticket list's half of the parent filter: `p` opens the
// picker, the picker's result reloads the list through the existing
// `receiveResult` channel (F4), and `c` clears all four criteria (AC-3).
// The screen-level cases the plan names, driven directly the way
// `project-screens.test.ts` drives the other project tab screens.

const PROJECT = { id: 'project-1', name: 'Bb', slug: 'bakers' };
const PARENT = { id: 'parent-1', identifier: 'BB-273' };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A raw JSON:API ticket row; `parentId` links it under the parent ticket. */
const ticket = (id: string, identifier: string, parentId?: string) => ({
  type: 'bb_ticket--bb_ticket',
  id,
  attributes: { identifier, title: `title of ${identifier}`, state: 'coding' },
  relationships: {
    parent_id: { data: parentId === undefined ? null : { id: parentId } },
  },
});

// BB-300 and BB-301 are BB-273's children; BB-400 is not. The parent
// itself is sideloaded so the mapper can resolve the identifier (BB-193 AC-5).
const DOCUMENT = {
  data: [
    ticket('parent-1', 'BB-273'),
    ticket('child-1', 'BB-300', 'parent-1'),
    ticket('child-2', 'BB-301', 'parent-1'),
    ticket('other-1', 'BB-400'),
  ],
  included: [
    {
      type: 'bb_ticket--bb_ticket',
      id: 'parent-1',
      attributes: { identifier: 'BB-273' },
    },
  ],
};

interface RecordedGet {
  path: string;
  params: unknown;
}

function harness() {
  const requests: RecordedGet[] = [];
  const context: ScreenContext = {
    sessionGeneration: 1,
    project: PROJECT,
    params: { projectId: PROJECT.id },
    services: {
      client: {
        get: async (path: string, params?: unknown) => {
          requests.push({ path, params });
          return DOCUMENT;
        },
        collection: vi.fn(),
      },
    },
    requestDraw: vi.fn(),
    isActive: () => true,
    navigate: vi.fn(),
  };
  return { context, requests };
}

const queryOf = (params: unknown): string =>
  decodeURIComponent((params as { getQueryString(): string }).getQueryString());

// BB-340 Task 7 — the list hands over a renderable TREE, so the text it shows
// is read out of the tree rather than off a row surface it no longer has.
const rendered = (screen: TicketsScreen, context: ScreenContext): string =>
  renderTree(screen.present(context).body).join('\n');

async function open() {
  const screen = new TicketsScreen();
  const { context, requests } = harness();
  screen.enter(context);
  await tick();
  return { screen, context, requests };
}

describe('Tickets screen — the parent filter (BB-284)', () => {
  it('`p` navigates to the parent-filter picker with the current params', async () => {
    const { screen, context } = await open();
    expect(screen.handleInput('p', context)).toBe(true);
    expect(context.navigate).toHaveBeenCalledWith(
      'project.tickets.parent-filter',
      { projectId: PROJECT.id },
    );
  });

  it('a parent-filter-set result reloads through the parent criterion (AC-1)', async () => {
    const { screen, context, requests } = await open();
    expect(requests).toHaveLength(1);
    screen.receiveResult(
      { type: 'parent-filter-set', parent: PARENT },
      context,
    );
    await tick();
    // The reload's query filters by the parent's UUID, top level.
    expect(requests).toHaveLength(2);
    const s = queryOf(requests[1]?.params);
    expect(s).toContain('filter[parent_id.id]=parent-1');
    // …and the rendered rows are exactly that parent's children (AC-1).
    const frame = rendered(screen, context);
    expect(frame).toContain('BB-300');
    expect(frame).toContain('BB-301');
    expect(frame).not.toContain('BB-273 ·');
    expect(frame).not.toContain('BB-400');
  });

  it('the filter section names the parent by IDENTIFIER, never the uuid (AC-2)', async () => {
    const { screen, context } = await open();
    screen.receiveResult(
      { type: 'parent-filter-set', parent: PARENT },
      context,
    );
    await tick();
    const body = rendered(screen, context);
    const meta = screen.present(context).meta ?? '';
    expect(body).toContain('parent: BB-273');
    expect(body).not.toContain('parent-1');
    expect(meta).not.toContain('parent:');
    // Idle key hint lives in the badge strip, not meta (BB-375).
    expect(body).toMatch(/p parent|parent: BB-273/);
    expect(meta).not.toContain('p parent');
  });

  it('`c` after a pick clears all four criteria — the unfiltered list returns (AC-3)', async () => {
    const { screen, context, requests } = await open();
    screen.receiveResult(
      { type: 'parent-filter-set', parent: PARENT },
      context,
    );
    await tick();
    expect(rendered(screen, context)).not.toContain('BB-400');
    expect(screen.handleInput('c', context)).toBe(true);
    await tick();
    const s = queryOf(requests[requests.length - 1]?.params);
    expect(s).not.toContain('filter[parent_id.id]');
    const frame = rendered(screen, context);
    expect(frame).toContain('BB-273');
    expect(frame).toContain('BB-400');
    expect(rendered(screen, context)).not.toContain('parent:');
  });

  it('the client-side guard drops a row whose parent differs, even if a double returns it', async () => {
    // The server is authoritative; the guard only protects a cached re-entry
    // from clients/test doubles that ignore query parameters — the same rule
    // the existing three predicates declare.
    const { screen, context } = await open();
    screen.receiveResult(
      { type: 'parent-filter-set', parent: PARENT },
      context,
    );
    await tick();
    // DOCUMENT contains BB-400 (no parent) and BB-273 (the parent itself):
    // both came back from the double, neither may render.
    const frame = rendered(screen, context);
    expect(frame).toContain('BB-300');
    expect(frame).not.toContain('BB-400');
    expect(frame).not.toContain('BB-273 ·');
  });

  it('a parent-filter-set result with parent null clears ONLY the parent criterion (BB-300 D2, AC-3)', async () => {
    const { screen, context, requests } = await open();
    // Two OTHER criteria activated by hand, then a picked parent. The second
    // one used to be the type filter (`t`); BB-299 dropped that filter, so
    // the key is inert and `filter[workflow]` is no longer emitted at all. The
    // closed toggle (`x`) replaces it: what this case guards is that clearing
    // the parent leaves EVERY other active criterion standing, and that needs a
    // criterion the product still has.
    screen.handleInput('s', context);
    await tick();
    screen.handleInput('x', context);
    await tick();
    screen.receiveResult(
      { type: 'parent-filter-set', parent: PARENT },
      context,
    );
    await tick();
    const before = queryOf(requests[requests.length - 1]?.params);
    expect(before).toContain('filter[parent_id.id]=parent-1');
    expect(before).toContain('filter[state]');
    screen.receiveResult({ type: 'parent-filter-set', parent: null }, context);
    await tick();
    const s = queryOf(requests[requests.length - 1]?.params);
    expect(s).not.toContain('filter[parent_id.id]');
    // …while the state/closed criteria ride along untouched. The closed value
    // is asserted as the TOGGLED one: `filter[closed]` is in every query, so
    // only `=1` proves the criterion the `x` press set actually survived.
    expect(s).toContain('filter[state]');
    expect(s).toContain('filter[closed]=1');
    const body = rendered(screen, context);
    const meta = screen.present(context).meta ?? '';
    expect(body).not.toContain('parent:');
    expect(body).toContain('state:');
    expect(body).toContain('closed: only');
    expect(meta).not.toContain('parent:');
    expect(meta).not.toContain('state:');
    expect(meta).not.toContain('closed:');
  });

  it('an unrelated result type leaves the criteria untouched', async () => {
    const { screen, context, requests } = await open();
    screen.receiveResult({ type: 'something-else' }, context);
    await tick();
    expect(requests).toHaveLength(1);
    expect(rendered(screen, context)).toContain('BB-400');
  });
});
