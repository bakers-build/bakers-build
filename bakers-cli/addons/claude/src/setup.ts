import { execFileSync } from 'node:child_process';
import type { AgentModelApi } from '@bakers-build/conductor/contract';

/** The install for the version `claude --version` printed; `@latest` when none is readable. */
export function claudeInstallCommandFor(versionOutput?: string): string {
  // Strict semver only: the command runs through a shell in the image build.
  const version = /^\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)(?:\s|$)/.exec(
    versionOutput ?? '',
  )?.[1];
  return `npm install -g @anthropic-ai/claude-code@${version ?? 'latest'}`;
}

let hostInstall: string | undefined;
/** The host's Claude, read once, so an isolated run's image carries the same version. */
export function claudeInstallCommand(): string {
  if (hostInstall === undefined) {
    let output: string | undefined;
    try {
      output = execFileSync('claude', ['--version'], {
        encoding: 'utf8',
        timeout: 10_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      // Not installed or not runnable: the unpinned install, logged by the runtime.
    }
    hostInstall = claudeInstallCommandFor(output);
  }
  return hostInstall;
}

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
