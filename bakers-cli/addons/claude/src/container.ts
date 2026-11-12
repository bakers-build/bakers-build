import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type {
  AgentContainer,
  ContainerMount,
} from '@bakers-build/conductor/contract';

/**
 * Encode an absolute cwd the way Claude Code names its per-project transcript
 * directory under `~/.claude/projects/`: every non-alphanumeric char → `-`.
 */
export function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/** What a Claude run needs in an isolating container runtime. */
export const claudeContainer: AgentContainer = {
  install: 'npm install -g @anthropic-ai/claude-code@latest',
  credentialHint:
    'set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) or ANTHROPIC_API_KEY in the conductor environment; a container cannot use the host login',
  api: {
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
  },
  prepare({
    runHome,
    containerHome,
    workspacePath,
    env,
    hostHome,
    keyPlaceholder,
  }) {
    const agentHome = env.CLAUDE_CONFIG_DIR;
    const runClaude = join(runHome, '.claude');
    const inRun = `${containerHome}/.claude`;
    mkdirSync(runClaude, { recursive: true });
    // Settings travel; the login (.credentials.json) never does.
    for (const file of ['settings.json', '.claude.json'])
      if (agentHome && existsSync(join(agentHome, file)))
        copyFileSync(join(agentHome, file), join(runClaude, file));
    // A fresh home would stop Claude at its first-run setup screen.
    const stateFile = agentHome
      ? join(runClaude, '.claude.json')
      : join(runHome, '.claude.json');
    const state = existsSync(stateFile)
      ? (JSON.parse(readFileSync(stateFile, 'utf8')) as object)
      : {};
    writeFileSync(
      stateFile,
      JSON.stringify({
        ...state,
        hasCompletedOnboarding: true,
        // Claude asks before using a custom API key; the run's placeholder is pre-approved.
        ...(keyPlaceholder
          ? {
              customApiKeyResponses: {
                approved: [keyPlaceholder.slice(-20)],
                rejected: [],
              },
            }
          : {}),
      }),
      { mode: 0o600 },
    );
    const key = encodeClaudeProjectDir(workspacePath);
    const transcripts = join(
      agentHome ?? join(hostHome, '.claude'),
      'projects',
      key,
    );
    const mounts: ContainerMount[] = [];
    if (agentHome) {
      const plugins = join(agentHome, 'plugins');
      mounts.push(
        { host: plugins, container: plugins, readOnly: true },
        { host: plugins, container: `${inRun}/plugins`, readOnly: true },
      );
    }
    mounts.push({ host: transcripts, container: `${inRun}/projects/${key}` });
    // Mount points docker would otherwise create root-owned, so cleanup could not delete the home.
    for (const dir of [
      transcripts,
      join(runClaude, 'projects', key),
      ...(agentHome ? [join(runClaude, 'plugins')] : []),
    ])
      mkdirSync(dir, { recursive: true });
    return {
      env: agentHome ? { CLAUDE_CONFIG_DIR: inRun } : {},
      mounts,
    };
  },
};
