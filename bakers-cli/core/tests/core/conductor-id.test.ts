import { describe, expect, it } from 'vitest';
import { conductorId } from '../../src/core/conductor-id.js';

describe('conductorId', () => {
  it('is deterministic and stable for the same path', () => {
    expect(conductorId('/home/cw/projects/bakers')).toBe(
      conductorId('/home/cw/projects/bakers'),
    );
  });

  it('returns a 16-char hex string', () => {
    expect(conductorId('/some/path')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('differs for different paths', () => {
    expect(conductorId('/home/cw/projects/bakers')).not.toBe(
      conductorId('/home/cw/projects/other'),
    );
  });
});
