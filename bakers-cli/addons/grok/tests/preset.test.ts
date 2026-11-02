import { describe, expect, it } from 'vitest';
import { agents } from '../src/preset.js';

describe('grok catalog', () => {
  it('advertises its alias, suitability and model binding', async () => {
    const candidates = await agents([], undefined);
    expect(candidates.map((c) => ({ alias: c.alias, model: c.model }))).toEqual(
      [{ alias: 'grok', model: undefined }],
    );
    expect(candidates[0]?.description).toBeTruthy();
  });
  it('keeps custom model options in the catalog', async () => {
    expect(await agents([], { model: 'custom-model' })).toMatchObject([
      { model: 'custom-model' },
    ]);
  });
  it('passes optional model selection through to the created agent', async () => {
    for (const options of [undefined, {}, { model: 'grok-4.5' }]) {
      const candidates = await agents([], options);
      const candidate = candidates[0]!;
      expect(candidate.model).toBe(options?.model);
      const agent = await candidate.agent.createAgent({} as never);
      expect(agent.launchCommand('x')).toBe(
        "grok 'x' --sandbox workspace --permission-mode acceptEdits --allow 'Bash(*)' --deny 'MCPTool(*)'" +
          (options?.model === undefined ? '' : " -m 'grok-4.5'"),
      );
    }
  });
});
