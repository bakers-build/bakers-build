import { describe, expect, it, vi } from 'vitest';
import { WorkspacePickerScreen } from '../../../../src/Entity/workspace/Screen/workspace-picker.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import { renderTree } from '../../../render-tree.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const WORKSPACES = [
  { id: 'ws-1', name: 'keytec' },
  { id: 'ws-2', name: 'acme' },
];

function makeContext(overrides: Partial<ScreenContext> = {}): ScreenContext {
  const client = {
    collection: vi.fn(() => ({
      list: vi.fn(async () => WORKSPACES.map((w) => toResource(w))),
    })),
  };
  return {
    sessionGeneration: 1,
    services: {
      client,
      workspaceId: 'ws-1',
      workspace: 'keytec',
      configPath: '/tmp/bakers.config.js',
      bakersDir: '/work/.bakers',
      selectWorkspace: vi.fn(async () => {}),
      restartProcess: vi.fn(),
    },
    requestDraw: vi.fn(),
    isActive: () => true,
    navigate: vi.fn(),
    ...overrides,
  } as unknown as ScreenContext;
}

function toResource(w: { id: string; name: string }) {
  return {
    id: w.id,
    type: 'bb_workspace',
    attr: (key: string) => (key === 'name' ? w.name : undefined),
    rel: () => null,
    rels: () => [],
  };
}

describe('WorkspacePickerScreen', () => {
  it('lists the reachable workspaces and marks the active one', async () => {
    const context = makeContext();
    const screen = new WorkspacePickerScreen();
    screen.enter(context);
    await tick();
    const shown = screen.present(context);
    const text = renderTree(shown.body).join('\n');
    expect(text).toContain('keytec');
    expect(text).toContain('acme');
    expect(text).toMatch(/●\s*keytec/);
  });

  it('choosing a DIFFERENT workspace writes the selection then restarts', async () => {
    const context = makeContext();
    const screen = new WorkspacePickerScreen();
    screen.enter(context);
    await tick();
    // Move selection onto 'acme' (index 1) and confirm.
    screen.select(1, context);
    screen.handleInput('enter', context);
    await tick();
    expect(context.services?.selectWorkspace).toHaveBeenCalledWith('acme');
    expect(context.services?.restartProcess).toHaveBeenCalledTimes(1);
  });

  it('choosing the ALREADY-active workspace is a no-op that says so', async () => {
    const context = makeContext();
    const screen = new WorkspacePickerScreen();
    screen.enter(context);
    await tick();
    screen.select(0, context); // ws-1, already active
    screen.handleInput('enter', context);
    await tick();
    expect(context.services?.selectWorkspace).not.toHaveBeenCalled();
    expect(context.services?.restartProcess).not.toHaveBeenCalled();
    expect(screen.present(context).status ?? '').toMatch(/already/i);
  });
});
