import { describe, expect, it } from 'vitest';
import {
  isMine,
  logBlockFor,
} from '../../../../src/Entity/conductor/Data/log-block.js';

const detail = {
  id: 'C1',
  label: 'cw-framework',
  workspaceRoot: '/tmp/does-not-exist',
  machineId: 'host-a',
} as never;

describe('the log block', () => {
  it('is mine only when the machine UUID matches, never on an absent one', () => {
    expect(isMine(detail, 'host-a')).toBe(true);
    expect(isMine(detail, 'host-b')).toBe(false);
    expect(
      isMine(
        { ...(detail as object), machineId: undefined } as never,
        'host-a',
      ),
    ).toBe(false);
    expect(isMine(detail, undefined)).toBe(false);
  });
  it('states where the log is when it is ours', () => {
    expect(logBlockFor(detail, true).heading).toContain('/tmp/does-not-exist');
  });
  it('says there is no log here when it is not ours, and shows no lines', () => {
    const block = logBlockFor(detail, false);
    expect(block.heading).toContain('runs on another machine; no log here');
    expect(block.lines).toEqual([]);
  });
});
