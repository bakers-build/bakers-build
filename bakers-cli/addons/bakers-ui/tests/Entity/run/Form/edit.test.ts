import { describe, expect, it } from 'vitest';
import {
  CANCELLABLE_RUN_STATES,
  cancelRunPayload,
  isRunCancellable,
} from '../../../../src/Entity/run/Form/edit.js';

describe('run cancellation rules', () => {
  it('offers cancel from the active states only', () => {
    expect(isRunCancellable('claimed')).toBe(true);
    expect(isRunCancellable('running')).toBe(true);
    for (const over of ['done', 'failed', 'expired', 'cancelled'])
      expect(isRunCancellable(over)).toBe(false);
  });

  it('mirrors the workflow transition source states exactly', () => {
    expect([...CANCELLABLE_RUN_STATES].sort()).toEqual(['claimed', 'running']);
  });

  it('writes only the state', () => {
    expect(cancelRunPayload()).toEqual({ attributes: { state: 'cancelled' } });
  });
});
