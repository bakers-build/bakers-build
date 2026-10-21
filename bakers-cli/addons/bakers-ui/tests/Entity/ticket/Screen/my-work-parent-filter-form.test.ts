import { describe, expect, it, vi } from 'vitest';
import { MyWorkParentFilterScreen } from '../../../../src/Entity/ticket/Screen/my-work-parent-filter-form.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import type { TuiOptions } from '../../../../src/types.js';
import { fakeClient } from '../../../test-support.js';

const TICKETS = 'bb_ticket/bb_ticket';

const ticket = (id: string, identifier: string, title: string) => ({
  type: 'bb_ticket--bb_ticket',
  id,
  attributes: { identifier, title },
});

const doc = {
  [TICKETS]: {
    data: [
      ticket('t1', 'BB-236', 'a declared form kernel'),
      ticket('t2', 'BB-257', 'the New-ticket popup'),
    ],
  },
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

const immediate = (fn: () => void): (() => void) => {
  fn();
  return () => {};
};

function context(overrides: Partial<ScreenContext> = {}): ScreenContext {
  return {
    sessionGeneration: 1,
    requestDraw: vi.fn(),
    isActive: () => true,
    options: { debounce: immediate } as unknown as TuiOptions,
    ...overrides,
  };
}

async function openWithSuggestions() {
  const client = fakeClient({ documents: doc });
  const back = vi.fn(() => true);
  const screen = new MyWorkParentFilterScreen();
  const ctx = context({
    services: { client } as ScreenContext['services'],
    back,
  });
  screen.enter(ctx);
  await tick();
  for (const char of 'BB-2') screen.handleInput(char, ctx);
  await tick();
  await tick();
  return { client, back, screen, ctx };
}

describe('MyWorkParentFilterScreen', () => {
  it('opens as a modal under my.work', () => {
    const route = MyWorkParentFilterScreen.route;
    expect(route.presentation).toBe('modal');
    expect(route.parent).toBe('my.work');
  });

  it('does not require a project context (BB-540 lift)', async () => {
    const client = fakeClient({ documents: doc });
    const screen = new MyWorkParentFilterScreen();
    const ctx = context({
      services: { client } as ScreenContext['services'],
      project: undefined,
    });
    screen.enter(ctx);
    await tick();
    // The screen accepted the no-project context.
    expect(screen.present(ctx).body).toBeDefined();
  });

  it('Enter on a pick backs with parent-filter-set carrying id + identifier', async () => {
    const { back, screen, ctx } = await openWithSuggestions();
    screen.handleInput('right', ctx);
    screen.handleInput('enter', ctx);
    expect(back).toHaveBeenCalled();
    const call = back.mock.calls[0]?.[0] as {
      type?: string;
      parent?: unknown;
    };
    expect(call.type).toBe('parent-filter-set');
    expect(call.parent).toEqual({ id: 't2', identifier: 'BB-257' });
  });

  it('Del on an empty query commits the null payload (AC-3 mirror)', async () => {
    const client = fakeClient({ documents: doc });
    const back = vi.fn(() => true);
    const screen = new MyWorkParentFilterScreen();
    const ctx = context({
      services: { client } as ScreenContext['services'],
      back,
    });
    screen.enter(ctx);
    await tick();
    screen.handleInput('delete', ctx);
    expect(back).toHaveBeenCalled();
    const call = back.mock.calls[0]?.[0] as {
      type?: string;
      parent?: unknown;
    };
    expect(call.type).toBe('parent-filter-set');
    expect(call.parent).toBeNull();
  });
});
