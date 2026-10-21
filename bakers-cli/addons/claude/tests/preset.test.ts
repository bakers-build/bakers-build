import { describe, expect, it } from 'vitest';
import { agents } from '../src/preset.js';

describe('Claude catalog', () => {
  it('offers reasoning and implementation variants with their bound models', async () => {
    const candidates = await agents([], undefined);
    expect(candidates.map(({ alias, model }) => ({ alias, model }))).toEqual([
      { alias: 'opus', model: 'opus' },
      { alias: 'sonnet', model: 'sonnet' },
    ]);
    expect(candidates.every((c) => Boolean(c.description))).toBe(true);
  });
});
