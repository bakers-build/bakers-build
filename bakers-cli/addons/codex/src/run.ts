import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  AgentRunContext,
  AgentRunPreparation,
  RunBind,
} from '@bakers-build/conductor/contract';

/**
 * Source directories shared read-only; everything else starts fresh and
 * writable in the private home, since Codex writes leftovers such as
 * thread-writer-locks at startup. Marketplace clones live in .tmp/marketplaces.
 */
const SHARED = ['plugins', 'skills', 'packages', '.tmp/marketplaces'];

/** The model credentials a Codex run may receive from the secrets file. */
export const CODEX_SECRET_ENV = ['CODEX_API_KEY', 'OPENAI_API_KEY'] as const;

/** Prepare Codex's files in the home supplied by any execution backend. */
export function prepareCodexRun(
  context: AgentRunContext,
  configDir: string,
  hostEnv: Readonly<Record<string, string | undefined>> = context.secrets ??
    process.env,
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
  // Shared directories are linked each on its own: the runtimes refuse a
  // write path inside a read path.
  // shortcut: files such as the state DB and history start empty in the
  // private home and are discarded with it; link one if it must persist.
  const readPaths: string[] = [];
  for (const name of SHARED) {
    const path = join(source, name);
    if (!existsSync(path) || !lstatSync(path).isDirectory()) continue;
    mkdirSync(dirname(join(home, name)), { recursive: true });
    symlinkSync(path, join(home, name));
    readPaths.push(path);
  }
  const keys = CODEX_SECRET_ENV;
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
