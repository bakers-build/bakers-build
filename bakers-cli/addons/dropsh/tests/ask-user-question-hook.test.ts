import { describe, expect, it, vi } from 'vitest';
import { askUserQuestionDecision } from '../src/ask-user-question-hook.js';

const ID = '11111111-1111-4111-8111-111111111111';
const reason = (output: unknown) =>
  (
    output as {
      hookSpecificOutput?: {
        permissionDecision?: string;
        permissionDecisionReason?: string;
      };
    } | null
  )?.hookSpecificOutput;

describe('bakers hook ask-user-question', () => {
  it('denies the terminal dialog on a ticket labelled Autopilot', async () => {
    const read = vi.fn(async () => ({ labels: ['Backend', 'Autopilot'] }));
    const output = await askUserQuestionDecision({ BB_ID: ID }, read);

    expect(read).toHaveBeenCalledWith(ID);
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: expect.any(String),
      },
    });
  });

  it('points the denied agent to the ticket question', async () => {
    const output = await askUserQuestionDecision({ BB_ID: ID }, async () => ({
      labels: ['Autopilot'],
    }));
    const text = reason(output)?.permissionDecisionReason ?? '';
    expect(text).toContain('# Question');
    expect(text).toContain('bakers_ticket_update');
    expect(text).toContain('labels_add: ["Question"]');
    expect(text).toContain('frozen: true');
    expect(text).toContain('publish-comment');
  });

  it('denies when the ticket of the run cannot be read', async () => {
    const output = await askUserQuestionDecision({ BB_ID: ID }, async () => {
      throw new Error('HTTP 503');
    });
    expect(reason(output)?.permissionDecision).toBe('deny');
    expect(reason(output)?.permissionDecisionReason).toMatch(/HTTP 503/);
  });

  it('lets a run on a ticket without the Autopilot label use the terminal dialog', async () => {
    const output = await askUserQuestionDecision({ BB_ID: ID }, async () => ({
      labels: ['Backend'],
    }));
    expect(output).toBeNull();
  });

  it('decides on the label alone, whatever else the ticket read returns', async () => {
    const output = await askUserQuestionDecision({ BB_ID: ID }, async () => ({
      approval: 'automatic',
      labels: [],
    }));
    expect(output).toBeNull();
  });

  it('lets a session outside a conductor run use the terminal dialog', async () => {
    const read = vi.fn();
    expect(await askUserQuestionDecision({}, read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});
