import { describe, expect, it, vi } from 'vitest';
import { TicketsScreen } from '../../src/Entity/ticket/Screen/tickets.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import { renderTree } from '../render-tree.js';

// BB-299 D3–D5 — the ticket list's half of the Who filter: `w` opens the
// picker, the picker's result reloads the list through the same
// `receiveResult` channel as the parent filter (BB-284 F4), the summary
// names the picked user, and `c` clears the criterion. Driven directly the way
// `tickets-parent-filter.test.ts` drives the parent filter.

const PROJECT = { id: 'project-1', name: 'Bb', slug: 'bakers' };
const WHO = { id: 'user-cw', label: 'cw' };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A raw JSON:API ticket row; `assigneeId` links it to the assigned user. */
const ticket = (id: string, identifier: string, assigneeId?: string) => ({
  type: 'bb_ticket--bb_ticket',
  id,
  attributes: { identifier, title: `title of ${identifier}`, state: 'coding' },
  relationships: {
    assignee_user_id: {
      data: assigneeId === undefined ? null : { id: assigneeId },
    },
  },
});

// BB-300 and BB-301 are cw's; BB-400 is someone else's, BB-401 nobody's.
const DOCUMENT = {
  data: [
    ticket('t1', 'BB-300', 'user-cw'),
    ticket('t2', 'BB-301', 'user-cw'),
    ticket('t3', 'BB-400', 'user-tm'),
    ticket('t4', 'BB-401'),
  ],
  included: [],
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

describe('Tickets screen — the who filter (BB-299)', () => {
  it('`w` navigates to the who-filter picker with the current params', async () => {
    const { screen, context } = await open();
    expect(screen.handleInput('w', context)).toBe(true);
    expect(context.navigate).toHaveBeenCalledWith(
      'project.tickets.who-filter',
      { projectId: PROJECT.id },
    );
  });

  it('a who-filter-set result reloads through the who criterion (AC-4)', async () => {
    const { screen, context, requests } = await open();
    expect(requests).toHaveLength(1);
    screen.receiveResult({ type: 'who-filter-set', who: WHO }, context);
    await tick();
    // The reload's query filters by the user's UUID, top level.
    expect(requests).toHaveLength(2);
    const s = queryOf(requests[1]?.params);
    expect(s).toContain('filter[assignee_user_id.id]=user-cw');
    // …and the rendered rows are exactly that user's tickets (AC-4).
    const frame = rendered(screen, context);
    expect(frame).toContain('BB-300');
    expect(frame).toContain('BB-301');
    expect(frame).not.toContain('BB-400');
    expect(frame).not.toContain('BB-401');
  });

  it('the filter section names the user by LABEL, never the uuid', async () => {
    const { screen, context } = await open();
    screen.receiveResult({ type: 'who-filter-set', who: WHO }, context);
    await tick();
    const body = rendered(screen, context);
    const meta = screen.present(context).meta ?? '';
    expect(body).toContain('who: cw');
    expect(body).not.toContain('user-cw');
    expect(meta).not.toContain('who:');
    // Idle key hint lives in the badge strip, not meta (BB-375).
    expect(body).toMatch(/w who|who: cw/);
    expect(meta).not.toContain('w who');
  });

  it('`c` after a pick clears the criterion — the unfiltered list returns', async () => {
    const { screen, context, requests } = await open();
    screen.receiveResult({ type: 'who-filter-set', who: WHO }, context);
    await tick();
    expect(rendered(screen, context)).not.toContain('BB-400');
    expect(screen.handleInput('c', context)).toBe(true);
    await tick();
    const s = queryOf(requests[requests.length - 1]?.params);
    expect(s).not.toContain('filter[assignee_user_id.id]');
    const frame = rendered(screen, context);
    expect(frame).toContain('BB-400');
    expect(frame).toContain('BB-401');
    expect(rendered(screen, context)).not.toContain('who:');
  });

  it('the client-side guard drops a row whose assignee differs, even if a double returns it (D4)', async () => {
    // The server is authoritative; the guard only protects a cached re-entry
    // from clients/test doubles that ignore query parameters — the same rule
    // the existing predicates declare. The uuid comparison needs no sideload:
    // the relationship linkage is already on every resource.
    const { screen, context } = await open();
    screen.receiveResult({ type: 'who-filter-set', who: WHO }, context);
    await tick();
    const frame = rendered(screen, context);
    expect(frame).toContain('BB-300');
    expect(frame).not.toContain('BB-400');
    expect(frame).not.toContain('BB-401');
  });

  it('an unrelated result type leaves the criteria untouched', async () => {
    const { screen, context, requests } = await open();
    screen.receiveResult({ type: 'something-else' }, context);
    await tick();
    expect(requests).toHaveLength(1);
    expect(rendered(screen, context)).toContain('BB-400');
  });

  it('restoreState normalizes a missing who to null (R3 — a pre-BB-299 token)', async () => {
    const { screen, context } = await open();
    screen.restoreState({
      criteria: {
        query: '',
        state: null,
        closed: false,
        parent: null,
        // no who key — a token saved before BB-299
      },
      selectedTicketId: null,
    });
    // Null, never undefined: a stale token cannot smuggle undefined into a
    // predicate testing `=== null` (the BB-282 `closed` precedent).
    expect(screen.saveState().criteria.who).toBe(null);
    const frame = rendered(screen, context);
    expect(frame).toContain('BB-300');
    expect(frame).toContain('BB-400');
  });
});
