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
