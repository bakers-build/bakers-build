import { describe, expect, it } from 'vitest';
import { agents } from '../src/preset.js';

describe('codex catalog', () => {
  it('advertises its alias, suitability and model binding', async () => {
    const candidates = await agents([], undefined);
    expect(candidates.map((c) => ({ alias: c.alias, model: c.model }))).toEqual(
      [
        { alias: 'codex', model: undefined },
        { alias: 'astra', model: 'gpt-6-astra' },
        { alias: 'sol', model: 'gpt-5.6-sol' },
        { alias: 'terra', model: 'gpt-5.6-terra' },
        { alias: 'luna', model: 'gpt-5.6-luna' },
      ],
    );
    for (const candidate of candidates) {
      expect(candidate.description).toBeTruthy();
      const agent = await candidate.agent.createAgent({} as never);
      expect(agent.id).toBe('codex');
      if (candidate.model) {
        expect(agent.launchCommand('')).toContain(
          `--model '${candidate.model}'`,
        );
      } else {
        expect(agent.launchCommand('')).not.toContain('--model');
      }
    }
  });
  it('keeps custom model options in the catalog', async () => {
    expect(await agents([], { model: 'custom-model' })).toMatchObject([
      { model: 'custom-model' },
    ]);
  });
});
