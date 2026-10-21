import { describe, expect, it } from 'vitest';
import {
  classifyWorkload,
  type WorkloadTicket,
} from '../../../../src/Entity/ticket/Data/workload.js';

const ticket = (
  id: string,
  overrides: Partial<WorkloadTicket> = {},
): WorkloadTicket => ({
  id,
  closed: false,
  derivedStatus: 'idle',
  assigneeId: 'user-1',
  ...overrides,
});

describe('classifyWorkload', () => {
  it('excludes closed tickets from every current-work bucket', () => {
    const result = classifyWorkload([
      ticket('closed', {
        closed: true,
        derivedStatus: 'running',
        assigneeId: null,
      }),
    ]);

    expect(result).toEqual({
      open: [],
      running: [],
      waiting: [],
      unassigned: [],
    });
  });

  it.each([
    ['idle'],
    ['queued'],
    [''],
  ])('classifies non-running status %j as waiting', (derivedStatus) => {
    const row = ticket(`ticket-${derivedStatus || 'empty'}`, { derivedStatus });
    const result = classifyWorkload([row]);

    expect(result.running).toEqual([]);
    expect(result.waiting).toEqual([row]);
  });

  it('classifies running tickets separately from waiting tickets', () => {
    const running = ticket('running', { derivedStatus: 'running' });
    const waiting = ticket('waiting', { derivedStatus: 'idle' });

    const result = classifyWorkload([running, waiting]);

    expect(result.running).toEqual([running]);
    expect(result.waiting).toEqual([waiting]);
  });

  it('keeps unassigned tickets in open and exactly one status bucket', () => {
    const running = ticket('running-unassigned', {
      derivedStatus: 'running',
      assigneeId: null,
    });
    const waiting = ticket('waiting-unassigned', { assigneeId: null });

    const result = classifyWorkload([running, waiting]);

    expect(result.open).toEqual([running, waiting]);
    expect(result.running).toEqual([running]);
    expect(result.waiting).toEqual([waiting]);
    expect(result.unassigned).toEqual([running, waiting]);
    expect(result.open).toHaveLength(
      result.running.length + result.waiting.length,
    );
  });
});
