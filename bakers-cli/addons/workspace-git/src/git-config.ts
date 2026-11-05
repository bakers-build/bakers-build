import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Set `branch.autoSetupMerge=false` in the checkout's repository unless it
 * already is. `git worktree add -b <branch> <path> origin/<base>` then writes
 * no upstream into the shared `.git/config`, so it no longer fails while a
 * sandbox holds a placeholder `config.lock`. Throws when the write fails.
 */
export async function setNoAutoSetupMerge(
  root: string,
): Promise<'set' | 'unchanged'> {
  const current = await run('git', [
    '-C',
    root,
    'config',
    '--get',
    'branch.autoSetupMerge',
  ]).then(
    ({ stdout }) => stdout.trim(),
    () => '', // exit 1: unset
  );
  if (current === 'false') return 'unchanged';
  await run('git', ['-C', root, 'config', 'branch.autoSetupMerge', 'false']);
  return 'set';
}

/**
 * Run env that makes a plain `git push` go to the same-name remote branch
 * (`push.default=current`): run branches have no upstream, and a per-run entry
 * in the shared `.git/config` fails while a sandbox holds `config.lock`. It
 * appends after the inherited `GIT_CONFIG_COUNT` and copies those entries, so
 * it stays valid where the run does not inherit the conductor's env.
 */
export function pushCurrentEnv(
  inherited: NodeJS.ProcessEnv,
): Record<string, string> {
  const n = Number.parseInt(inherited.GIT_CONFIG_COUNT ?? '', 10) || 0;
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(n + 1) };
  for (let i = 0; i < n; i++) {
    for (const name of [`GIT_CONFIG_KEY_${i}`, `GIT_CONFIG_VALUE_${i}`]) {
      env[name] = inherited[name] ?? '';
    }
  }
  env[`GIT_CONFIG_KEY_${n}`] = 'push.default';
  env[`GIT_CONFIG_VALUE_${n}`] = 'current';
  return env;
}

/**
 * The Git setup of a workspace backend before it creates or reuses a run
 * worktree: `branch.autoSetupMerge=false` in `root`, then the run env from
 * {@link pushCurrentEnv}. Best-effort: when the write fails (a held
 * `config.lock`), `git worktree add` reports the real error.
 */
export async function runBranchGit(
  root: string,
): Promise<Record<string, string>> {
  await setNoAutoSetupMerge(root).catch(() => undefined);
  return pushCurrentEnv(process.env);
}
