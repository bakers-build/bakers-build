import { describe, expect, it } from 'vitest';
import {
  CANCEL_RUN_ACTION_ID,
  CANCELLABLE_RUN_STATES,
  cancelRunPayload,
  isRunCancellable,
} from '../../../../src/Entity/run/Form/edit.js';

describe('run edit form declaration', () => {
  it('offers cancel from the active states only', () => {
    expect(isRunCancellable('claimed')).toBe(true);
    expect(isRunCancellable('running')).toBe(true);
    for (const over of ['done', 'failed', 'expired', 'cancelled'])
      expect(isRunCancellable(over)).toBe(false);
  });

  it('mirrors the workflow transition source states exactly', () => {
    expect([...CANCELLABLE_RUN_STATES].sort()).toEqual(['claimed', 'running']);
  });

  it('never names the action "cancel", which already means close', () => {
    expect(CANCEL_RUN_ACTION_ID).not.toBe('cancel');
  });

  it('writes only the state', () => {
    expect(cancelRunPayload()).toEqual({ attributes: { state: 'cancelled' } });
  });
});
