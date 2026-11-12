import type { AgentModelApi } from '@bakers-build/conductor/contract';

export const claudeInstallCommand =
  'npm install -g @anthropic-ai/claude-code@latest';

export const claudeModelApi: AgentModelApi = {
  target: 'https://api.anthropic.com',
  baseUrlEnv: 'ANTHROPIC_BASE_URL',
  keyEnv: 'ANTHROPIC_API_KEY',
  auth: {
    CLAUDE_CODE_OAUTH_TOKEN: {
      set: { authorization: 'Bearer {value}' },
      append: { 'anthropic-beta': 'oauth-2025-04-20' },
    },
    ANTHROPIC_API_KEY: { set: { 'x-api-key': '{value}' } },
  },
  credentialHint:
    'set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) or ANTHROPIC_API_KEY in the conductor environment',
};
