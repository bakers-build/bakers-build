import { describe, expect, it, vi } from 'vitest';
import { ProjectFilterScreen } from '../../../../src/Entity/ticket/Screen/project-filter-form.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import type { TuiOptions } from '../../../../src/types.js';
import { renderTree } from '../../../render-tree.js';
import { fakeClient } from '../../../test-support.js';

const PROJECTS = 'bb_project/bb_project';

const project = (id: string, name: string) => ({
  type: 'bb_project--bb_project',
  id,
  attributes: { name },
});

const doc = {
  [PROJECTS]: {
    data: [project('p1', 'Alpha'), project('p2', 'Alpine')],
  },
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

const immediate = (fn: () => void): (() => void) => {
  fn();
  return () => {};
};

function context(overrides: Partial<ScreenContext> = {}): ScreenContext {
  const options = { debounce: immediate };
  return {
    sessionGeneration: 1,
    requestDraw: vi.fn(),
    isActive: () => true,
    options: options as unknown as TuiOptions,
    ...overrides,
  };
}

async function openWithSuggestions() {
  const client = fakeClient({ documents: doc });
  const back = vi.fn(() => true);
  const screen = new ProjectFilterScreen();
  const ctx = context({
    services: { client } as ScreenContext['services'],
    back,
  });
  screen.enter(ctx);
  await tick();
  for (const char of 'al') screen.handleInput(char, ctx);
  await tick();
  await tick();
  return { client, back, screen, ctx };
}

const frameOf = (screen: ProjectFilterScreen, ctx: ScreenContext): string =>
  renderTree(screen.present(ctx).body).join('\n');
void frameOf;

describe('ProjectFilterScreen', () => {
  it('opens as a modal under the my.work parent', () => {
    const route = ProjectFilterScreen.route;
    expect(route.presentation).toBe('modal');
    expect(route.parent).toBe('my.work');
  });

  it('routes a pick back through context.back with the picked project', async () => {
    const { back, screen, ctx } = await openWithSuggestions();
    // Move the cursor to the second suggestion, then pick — confirms the
    // cursor mechanism AND the pick dispatch both work.
    screen.handleInput('right', ctx);
    screen.handleInput('enter', ctx);
    expect(back).toHaveBeenCalled();
    const call = back.mock.calls[0]?.[0] as {
      type?: string;
      project?: unknown;
    };
    expect(call.type).toBe('project-filter-set');
    expect(call.project).toEqual({ id: 'p2', label: 'Alpine' });
  });

  it('Del on an empty query commits the null payload (AC-3)', async () => {
    const client = fakeClient({ documents: doc });
    const back = vi.fn(() => true);
    const screen = new ProjectFilterScreen();
    const ctx = context({
      services: { client } as ScreenContext['services'],
      back,
    });
    screen.enter(ctx);
    await tick();
    // No typing — the query stays empty. Delete is the clear path.
    screen.handleInput('delete', ctx);
    expect(back).toHaveBeenCalled();
    const call = back.mock.calls[0]?.[0] as {
      type?: string;
      project?: unknown;
    };
    expect(call.type).toBe('project-filter-set');
    expect(call.project).toBeNull();
  });

  it('Esc cancels without a result', async () => {
    const { back, screen, ctx } = await openWithSuggestions();
    back.mockClear();
    screen.handleInput('escape', ctx);
    // The screen calls context.back() with no payload on Esc.
    expect(back).toHaveBeenCalled();
    const call = back.mock.calls[0]?.[0];
    expect(call).toBeUndefined();
  });

  it('does not require a project context (My work)', async () => {
    const client = fakeClient({ documents: doc });
    const screen = new ProjectFilterScreen();
    const ctx = context({
      services: { client } as ScreenContext['services'],
      project: undefined,
    });
    screen.enter(ctx);
    await tick();
    // No throw — the screen accepted the no-project context.
    const presentation = screen.present(ctx);
    expect(presentation.body).toBeDefined();
  });
});
