import { describe, expect, it, vi } from 'vitest';
import { EditAssignmentFormScreen } from '../../src/Entity/ticket/Screen/edit-assignment-form.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import { renderTree } from '../render-tree.js';
import { fakeClient, toResource } from '../test-support.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function context(overrides: Partial<ScreenContext> = {}): ScreenContext {
  const value: ScreenContext = {
    sessionGeneration: 1,
    requestDraw: vi.fn(),
    isActive: () => true,
    ...overrides,
  };
  return value;
}

describe('form screens own their complete interaction', () => {
  it('loads current assignment, owns write errors, and retries submission', async () => {
    const read = fakeClient({
      rows: {
        'user--user': [
          toResource({
            id: 'u1',
            type: 'user--user',
            attributes: { name: 'Ada', drupal_internal__uid: 1 },
          }),
        ],
        bb_conductor: [],
      },
    });
    vi.spyOn(read, 'get').mockResolvedValue({
      data: {
        id: 't1',
        relationships: {
          assignee_user_id: { data: { id: 'u1' } },
          project_id: { data: { id: 'p1' } },
        },
      },
    });
    const write = {
      ...read,
      update: vi
        .fn()
        .mockRejectedValueOnce(new Error('forbidden'))
        .mockResolvedValueOnce({}),
    };
    const screen = new EditAssignmentFormScreen();
    const ctx = context({
      params: { ticketId: 't1' },
      services: { client: read, writeClient: write },
    });

    screen.enter(ctx);
    await tick();
    expect(screen.options?.users[0]?.id).toBe('u1');
    expect(screen.handleInput('ctrl+s', ctx)).toBe(true);
    await tick();
    // BB-340 Task 9 — the popup hands over a TREE, so the server's own
    // refusal is read back off the nodes it is drawn as rather than off an
    // array of rows. The claim is unchanged: what the write was refused with
    // reaches the screen the writer is looking at.
    expect(renderTree(screen.present(ctx).body)).toContain('forbidden');
    expect(screen.handleInput('ctrl+s', ctx)).toBe(true);
    await tick();
    expect(write.update).toHaveBeenCalledTimes(2);
    expect(screen.takeAction()).toEqual({
      type: 'back',
      result: {
        type: 'ticket-assignment-updated',
        ticketId: 't1',
        assigneeId: 'u1',
      },
    });
  });
});

// ---- BB-309: what the direct-create path HANDS BACK ------------------------
//
// Driven against the screen rather than through the kernel harness of
// `tests/Kernel/create-form-direct.test.ts`, for one reason: the value under
// test is the RESULT the popup passes to `context.back(...)`, and the kernel
// routes that straight into the destination screen's `receiveResult` where no
// assertion can reach it. Here `back` is a spy, so the result is observable —
// which is what makes "the created ticket's id" an observation rather than a
// claim. Everything the kernel CAN see stays in that file.

describe("a closed ticket's edit popup", () => {
  it('is read-only: no Save, no value changes, and Ctrl+S writes nothing', async () => {
    const read = fakeClient({
      rows: {
        'user--user': [
          toResource({
            id: 'u1',
            type: 'user--user',
            attributes: { name: 'Ada' },
          }),
        ],
        bb_conductor: [],
      },
    });
    vi.spyOn(read, 'get').mockResolvedValue({
      data: { id: 't1', attributes: { state: 'done', closed: true } },
    });
    const write = { ...read, update: vi.fn().mockResolvedValue({}) };
    const screen = new EditAssignmentFormScreen();
    const ctx = context({
      params: { ticketId: 't1' },
      services: { client: read, writeClient: write },
    });

    screen.enter(ctx);
    await tick();
    const lines = renderTree(screen.present(ctx).body).join('\n');
    expect(screen.handleInput('right', ctx)).toBe(true); // Assignee → Ada
    expect(renderTree(screen.present(ctx).body).join('\n')).toBe(lines);
    expect(lines).not.toContain('←→');
    expect(lines).not.toContain('[ Save ]');
    expect(lines).not.toContain('[ Cancel ticket ]');
    expect(screen.handleInput('ctrl+s', ctx)).toBe(true);
    await tick();
    expect(write.update).not.toHaveBeenCalled();
    expect(renderTree(screen.present(ctx).body).join('\n')).toContain(
      'closed and read-only',
    );
  });
});
