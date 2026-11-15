import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
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

/** Entries prepared below, and those Codex writes while it runs. */
const NOT_LINKED = new Set([
  'auth.json',
  'sessions',
  'config.toml',
  'rules',
  'log',
  'shell_snapshots',
  'tmp',
]);

/** Prepare Codex's files in the home supplied by any execution backend. */
export function prepareCodexRun(
  context: AgentRunContext,
  configDir: string,
  hostEnv: Readonly<Record<string, string | undefined>> = process.env,
): AgentRunPreparation {
  const source = context.env.CODEX_HOME ?? configDir;
  const home = join(context.homePath, '.codex');
  mkdirSync(home, { recursive: true });
  // Transcripts land in the source home, where the conductor reads them.
  const sessions = join(source, 'sessions');
  mkdirSync(sessions, { recursive: true });
  symlinkSync(sessions, join(home, 'sessions'));
  // Writable copies: Codex records project trust in config.toml, skips linked
  // .rules files, and the trusted-commands launcher adds a rule beside them.
  if (existsSync(join(source, 'config.toml')))
    copyFileSync(join(source, 'config.toml'), join(home, 'config.toml'));
  if (existsSync(join(source, 'rules')))
    cpSync(join(source, 'rules'), join(home, 'rules'), {
      recursive: true,
      dereference: true,
    });
  // Directories (plugins, marketplaces, skills) are shared read-only, each on
  // its own: the runtimes refuse a write path inside a read path.
  // shortcut: files such as the state DB and history start empty in the
  // private home and are discarded with it; link one if it must persist.
  const readPaths: string[] = [];
  for (const name of readdirSync(source)) {
    const path = join(source, name);
    if (NOT_LINKED.has(name) || !lstatSync(path).isDirectory()) continue;
    symlinkSync(path, join(home, name));
    readPaths.push(path);
  }
  const keys = ['CODEX_API_KEY', 'OPENAI_API_KEY'];
  const env: Record<string, string> = { CODEX_HOME: home };
  const bindPaths: RunBind[] = [];
  if (!keys.some((key) => context.env[key])) {
    const key = keys.find((name) => hostEnv[name]);
    if (key) env[key] = hostEnv[key] as string;
    else if (existsSync(join(source, 'auth.json'))) {
      // The run shares the host's login file, never a copy: a refresh in one
      // copy rotates the token and logs every other copy out.
      const login = join(home, 'auth.json');
      writeFileSync(login, '', { mode: 0o600 });
      bindPaths.push({
        source: realpathSync(join(source, 'auth.json')),
        target: login,
      });
    }
  }
  return {
    env,
    readPaths,
    writePaths: [sessions],
    ...(bindPaths.length ? { bindPaths } : {}),
  };
}
