import { describe, expect, it, vi } from 'vitest';
import { askUserQuestionDecision } from '../src/ask-user-question-hook.js';

const ID = '11111111-1111-4111-8111-111111111111';
const denied = (output: unknown) =>
  (output as { hookSpecificOutput?: { permissionDecision?: string } } | null)
    ?.hookSpecificOutput?.permissionDecision === 'deny';

describe('bakers hook ask-user-question', () => {
  it('denies the terminal dialog when the ticket state approves automatically', async () => {
    const read = vi.fn(async () => ({ approval: 'automatic', labels: [] }));
    const output = await askUserQuestionDecision({ BB_ID: ID }, read);

    expect(read).toHaveBeenCalledWith(ID);
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('bakers ticket ask'),
      },
    });
  });

  it('denies the terminal dialog on a ticket labelled Autopilot', async () => {
    const output = await askUserQuestionDecision({ BB_ID: ID }, async () => ({
      approval: 'human',
      labels: ['Backend', 'Autopilot'],
    }));
    expect(denied(output)).toBe(true);
  });

  it('denies when the ticket of the run cannot be read', async () => {
    const output = await askUserQuestionDecision({ BB_ID: ID }, async () => {
      throw new Error('HTTP 503');
    });
    expect(denied(output)).toBe(true);
    expect(JSON.stringify(output)).toMatch(/HTTP 503/);
  });

  it('lets a human-approved run use the terminal dialog', async () => {
    const output = await askUserQuestionDecision({ BB_ID: ID }, async () => ({
      approval: 'human',
      labels: ['Backend'],
    }));
    expect(output).toBeNull();
  });

  it('lets a session outside a conductor run use the terminal dialog', async () => {
    const read = vi.fn();
    expect(await askUserQuestionDecision({}, read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('names the ask-human reference in the deny reason', async () => {
    const output = await askUserQuestionDecision({ BB_ID: ID }, async () => ({
      approval: 'automatic',
    }));
    expect(JSON.stringify(output)).toMatch(/ask-human/);
  });
});
