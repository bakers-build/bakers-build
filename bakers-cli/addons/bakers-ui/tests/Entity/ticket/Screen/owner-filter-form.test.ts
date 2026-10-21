import { describe, expect, it, vi } from 'vitest';
import { buildTicketQueryParams } from '../../../../src/Entity/ticket/Data/query.js';
import { TicketsScreen } from '../../../../src/Entity/ticket/Screen/tickets.js';
import { WhoFilterScreen } from '../../../../src/Entity/ticket/Screen/who-filter-form.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import type { TuiOptions } from '../../../../src/types.js';
import { fakeClient } from '../../../test-support.js';

// BB-416 — the SAME who picker (`WhoFilterScreen`), parameterised over which
// filter it sets via `context.params.filterTarget`. The assignee path (no
// target named, or `'assignee'`) must keep emitting exactly
// `{ type: 'who-filter-set', who }`; opened with `filterTarget: 'owner'` it
// emits `{ type: 'owner-filter-set', who }` instead — same field, same
// candidates (`whoOptionSource` untouched), only the result's name differs.

const PROJECT = { id: 'proj-1', name: 'bakers', slug: 'bakers' };
const USERS = 'user/user';

const user = (id: string, name: string, uid: number) => ({
  type: 'user--user',
  id,
  attributes: { name, display_name: name, drupal_internal__uid: uid },
});

const doc = {
  [USERS]: {
    data: [user('u1', 'cwiedemann', 3)],
  },
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

/** A debounce that fires synchronously — no test sleeps past a real timer. */
const immediate = (fn: () => void): (() => void) => {
  fn();
  return () => {};
};

function context(overrides: Partial<ScreenContext> = {}): ScreenContext {
  return {
    sessionGeneration: 1,
    requestDraw: vi.fn(),
    isActive: () => true,
    options: { debounce: immediate } as TuiOptions,
    ...overrides,
  };
}

async function pickThroughModal(params: Record<string, string> | undefined) {
  const client = fakeClient({ documents: doc });
  const back = vi.fn(() => true);
  const screen = new WhoFilterScreen();
  const ctx = context({
    services: { client } as ScreenContext['services'],
    project: PROJECT,
    params,
    back,
  });
  screen.enter(ctx);
  await tick();
  for (const char of 'cw') screen.handleInput(char, ctx);
  await tick();
  screen.handleInput('enter', ctx);
  return { back };
}

describe('the shared who picker, targeted at the owner filter (BB-416)', () => {
  it('opened with no target (or "assignee") still emits who-filter-set', async () => {
    const { back } = await pickThroughModal(undefined);
    expect(back).toHaveBeenCalledWith({
      type: 'who-filter-set',
      who: { id: 'u1', label: 'cwiedemann' },
    });
  });

  it('opened in owner mode emits owner-filter-set, not who-filter-set', async () => {
    const { back } = await pickThroughModal({ filterTarget: 'owner' });
    expect(back).toHaveBeenCalledWith({
      type: 'owner-filter-set',
      who: { id: 'u1', label: 'cwiedemann' },
    });
    expect(back).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'who-filter-set' }),
    );
  });
});

function ticketsHarness() {
  const context: ScreenContext = {
    sessionGeneration: 1,
    project: PROJECT,
    params: { projectId: PROJECT.id },
    services: {
      client: {
        get: async () => ({ data: [], included: [] }),
        collection: vi.fn(),
      },
    } as ScreenContext['services'],
    requestDraw: vi.fn(),
    isActive: () => true,
    navigate: vi.fn(),
  };
  return context;
}

describe('the ticket list holds the owner filter independently of the assignee filter (BB-416)', () => {
  it('`o` navigates to the who-filter picker in owner mode', async () => {
    const screen = new TicketsScreen();
    const context = ticketsHarness();
    screen.enter(context);
    await tick();
    expect(screen.handleInput('o', context)).toBe(true);
    expect(context.navigate).toHaveBeenCalledWith(
      'project.tickets.who-filter',
      { projectId: PROJECT.id, filterTarget: 'owner' },
    );
  });

  it('setting the owner filter leaves an already-set assignee filter untouched — both present', async () => {
    const screen = new TicketsScreen();
    const context = ticketsHarness();
    screen.enter(context);
    await tick();
    const who = { id: 'user-assignee', label: 'assignee-person' };
    const owner = { id: 'user-owner', label: 'owner-person' };
    screen.receiveResult({ type: 'who-filter-set', who }, context);
    await tick();
    screen.receiveResult({ type: 'owner-filter-set', who: owner }, context);
    await tick();
    const saved = screen.saveState().criteria;
    expect(saved.who).toEqual(who);
    expect(saved.owner).toEqual(owner);
  });

  it('the built query carries an owner_user_id condition when the owner filter is set', () => {
    const owner = { id: 'user-owner', label: 'owner-person' };
    const params = buildTicketQueryParams(PROJECT.id, {
      query: '',
      state: null,
      closed: null,
      parent: null,
      who: null,
      owner,
    });
    const qs = decodeURIComponent(params.getQueryString());
    expect(qs).toContain('filter[owner_user_id.id]=user-owner');
  });
});
