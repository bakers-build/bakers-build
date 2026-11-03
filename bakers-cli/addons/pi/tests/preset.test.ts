import { describe, expect, it } from 'vitest';
import { agents } from '../src/preset.js';

describe('pi catalog', () => {
  it('advertises its alias, suitability and model binding', async () => {
    const candidates = await agents([], undefined);
    expect(candidates.map((c) => ({ alias: c.alias, model: c.model }))).toEqual(
      [{ alias: 'pi', model: undefined }],
    );
    expect(candidates[0]?.description).toBeTruthy();
  });
  it('keeps custom model options in the catalog', async () => {
    expect(await agents([], { model: 'custom-model' })).toMatchObject([
      { model: 'custom-model' },
    ]);
  });
  it('rejects sandbox mode passed through addon options', () => {
    expect(() => agents([], { security: 'sandbox' })).toThrow(
      "Pi does not support security: 'sandbox'",
    );
  });
});
