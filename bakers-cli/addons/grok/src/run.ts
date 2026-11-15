import {
  copyFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type {
  AgentRunContext,
  AgentRunPreparation,
  RunBind,
} from '@bakers-build/conductor/contract';

export function encodeGrokSessionCwd(cwd: string): string {
  return encodeURIComponent(cwd);
}

/** Prepare Grok's files in the home supplied by any execution backend. */
export function prepareGrokRun(
  context: AgentRunContext,
  grokHome: string,
  hostEnv: Readonly<Record<string, string | undefined>> = process.env,
): AgentRunPreparation {
  const home = join(context.homePath, '.grok');
  mkdirSync(join(home, 'sessions'), { recursive: true });
  // Writable copies: a managed launch writes its profile into sandbox.toml;
  // requirements.toml keeps an enterprise policy in force.
  for (const name of ['config.toml', 'sandbox.toml', 'requirements.toml'])
    if (existsSync(join(grokHome, name)))
      copyFileSync(join(grokHome, name), join(home, name));
  // Transcripts land in the user Grok home, where the conductor reads them.
  const key = encodeGrokSessionCwd(context.workspacePath);
  const transcripts = join(grokHome, 'sessions', key);
  mkdirSync(transcripts, { recursive: true });
  symlinkSync(transcripts, join(home, 'sessions', key));
  const env: Record<string, string> = { GROK_HOME: home };
  const bindPaths: RunBind[] = [];
  if (!context.env.XAI_API_KEY) {
    if (hostEnv.XAI_API_KEY) env.XAI_API_KEY = hostEnv.XAI_API_KEY;
    else if (existsSync(join(grokHome, 'auth.json'))) {
      // The run shares the host's login file, never a copy: a refresh in one
      // copy rotates the token and logs every other copy out.
      const login = join(home, 'auth.json');
      writeFileSync(login, '', { mode: 0o600 });
      bindPaths.push({
        source: realpathSync(join(grokHome, 'auth.json')),
        target: login,
      });
    }
  }
  return {
    env,
    readPaths: [],
    writePaths: [transcripts],
    ...(bindPaths.length ? { bindPaths } : {}),
  };
}
