import { expect, it } from 'vitest';
import {
  ClaudeAgent,
  claudeInstallCommand,
  claudeModelApi,
} from '../src/index.js';

it('declares neutral setup facts without a container adapter', () => {
  const agent = new ClaudeAgent();
  expect(agent.installCommand).toBe(claudeInstallCommand);
  expect(agent.installCommand).toContain('@anthropic-ai/claude-code');
  expect(agent.modelApi).toBe(claudeModelApi);
  expect(agent).not.toHaveProperty('container');
});
it('prefers the OAuth token and sends each credential its own way', () => {
  const { auth } = claudeModelApi;
  expect(Object.keys(auth)).toEqual([
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY',
  ]);
  expect(auth.CLAUDE_CODE_OAUTH_TOKEN).toEqual({
    set: { authorization: 'Bearer {value}' },
    append: { 'anthropic-beta': 'oauth-2025-04-20' },
  });
  expect(auth.ANTHROPIC_API_KEY).toEqual({
    set: { 'x-api-key': '{value}' },
  });
  expect(claudeModelApi.credentialHint).toMatch(/claude setup-token/);
});
