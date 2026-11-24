import { describe, expect, it } from 'vitest';
import { offersCancelRun } from '../../../../src/Entity/run/Form/edit.js';

describe('run cancellation offer', () => {
  it('offers cancel on an active run and on the newest failed run', () => {
    expect(offersCancelRun('claimed', false)).toBe(true);
    expect(offersCancelRun('running', false)).toBe(true);
    expect(offersCancelRun('failed', true)).toBe(true);
    expect(offersCancelRun('failed', false)).toBe(false);
    for (const over of ['done', 'expired', 'cancelled'])
      expect(offersCancelRun(over, true)).toBe(false);
  });
});
