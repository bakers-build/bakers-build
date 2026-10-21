import { describe, expect, it, vi } from 'vitest';
import {
  ProjectPickerScreen,
  projectPickerInputContext,
} from '../../src/Entity/project/Screen/project-picker.js';
import {
  RunDetailScreen,
  runDetailInputContext,
} from '../../src/Entity/run/Screen/run-detail.js';
import { ContextBag } from '../../src/Routing/context.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import type { TicketDetailDocument } from '../../src/types.js';
import { renderTree } from '../render-tree.js';

const document: TicketDetailDocument = {
  data: { id: 'ticket-1', attributes: { identifier: 'BB-1' } },
  included: [
    {
      type: 'bb_run--bb_run',
      id: 'run-1',
      attributes: { status: 'running' },
    },
  ],
};

const context = (contexts: ContextBag): ScreenContext => ({
  sessionGeneration: 1,
  requestDraw: vi.fn(),
  isActive: () => true,
  contexts,
});

describe('detail and picker typed route input ownership', () => {
  it('renders run detail from its typed input context', async () => {
    const screen = new RunDetailScreen();
    const ctx = {
      ...context(ContextBag.empty().set(runDetailInputContext, { document })),
      params: { runId: 'run-1' },
    };

    screen.enter(ctx);
    await vi.waitFor(() =>
      expect(renderTree(screen.present(ctx).body).join('\n')).toContain(
        'run-1',
      ),
    );
    expect('setDocument' in screen).toBe(false);
  });

  it('renders and activates picker candidates from its typed input context', async () => {
    const navigate = vi.fn();
    const screen = new ProjectPickerScreen();
    const ctx = {
      ...context(
        ContextBag.empty().set(projectPickerInputContext, {
          candidates: [{ id: 'project-1', name: 'Bb' }],
          repo: 'bakers-build/bakers-build',
        }),
      ),
      navigate,
    };

    screen.enter(ctx);
    await vi.waitFor(() =>
      expect(renderTree(screen.present(ctx).body).join('\n')).toContain('Bb'),
    );
    expect(screen.activate(0, ctx)).toBe(true);
    expect(navigate).toHaveBeenCalledWith('project.overview', {
      projectId: 'project-1',
      projectName: 'Bb',
      projectSlug: 'Bb',
    });
    expect('configure' in screen).toBe(false);
  });
});
