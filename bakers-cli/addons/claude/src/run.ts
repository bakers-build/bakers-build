import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type {
  AgentRunContext,
  AgentRunPreparation,
} from '@bakers-build/conductor/contract';

export function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Prepare Claude's files in the home supplied by any execution backend. */
export function prepareClaudeRun(
  context: AgentRunContext,
  configDir: string,
  hostEnv: Readonly<Record<string, string | undefined>> = process.env,
): AgentRunPreparation {
  const source = context.env.CLAUDE_CONFIG_DIR ?? configDir;
  const config = join(context.homePath, '.claude');
  mkdirSync(config, { recursive: true });
  // Bypass consent is a user setting. A new private home has none, so a
  // `yolo` run would stop at Claude Code's bypass permissions dialog.
  const settings = existsSync(join(source, 'settings.json'))
    ? JSON.parse(readFileSync(join(source, 'settings.json'), 'utf8'))
    : {};
  writeFileSync(
    join(config, 'settings.json'),
    JSON.stringify({ ...settings, skipDangerousModePermissionPrompt: true }),
  );
  const state = existsSync(join(source, '.claude.json'))
    ? JSON.parse(readFileSync(join(source, '.claude.json'), 'utf8'))
    : {};
  delete state.primaryApiKey;
  const keys = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'];
  const env: Record<string, string> = { CLAUDE_CONFIG_DIR: config };
  const supplied = keys.some((key) => context.env[key]);
  if (!supplied) {
    const key = keys.find((name) => hostEnv[name]);
    if (key) env[key] = hostEnv[key] as string;
    else if (existsSync(join(source, '.credentials.json'))) {
      const login = join(config, '.credentials.json');
      copyFileSync(join(source, '.credentials.json'), login);
      chmodSync(login, 0o600);
    }
  }
  const apiKey = context.env.ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY;
  writeFileSync(
    join(config, '.claude.json'),
    JSON.stringify({
      ...state,
      hasCompletedOnboarding: true,
      ...(apiKey
        ? {
            customApiKeyResponses: {
              approved: [apiKey.slice(-20)],
              rejected: [],
            },
          }
        : {}),
    }),
    { mode: 0o600 },
  );
  const readPaths: string[] = [];
  const plugins = join(source, 'plugins');
  if (existsSync(plugins)) {
    symlinkSync(plugins, join(config, 'plugins'));
    readPaths.push(plugins);
  }
  const key = encodeClaudeProjectDir(context.workspacePath);
  const transcripts = join(source, 'projects', key);
  mkdirSync(transcripts, { recursive: true });
  mkdirSync(join(config, 'projects'), { recursive: true });
  symlinkSync(transcripts, join(config, 'projects', key));
  return { env, readPaths, writePaths: [transcripts] };
}
