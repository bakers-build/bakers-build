import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';

/** Git metadata a sandboxed agent run may write, and what inside it stays read-only. */
export interface GitSandboxPaths {
  write: string[];
  protect: string[];
}

/** Code an unsandboxed Git command later runs, or a redirect it follows to such code. */
const PROTECTED = [
  'config',
  'config.worktree',
  'hooks',
  'commondir',
  'gitdir',
  'modules',
  'worktrees',
];

/** What a commit, fetch or push from a linked worktree writes in the shared Git dir. */
const SHARED_WRITES = ['objects', 'refs', 'logs'];

function revParse(workspacePath: string, option: string): string | null {
  const git = spawnSync(
    'git',
    ['-C', workspacePath, 'rev-parse', '--path-format=absolute', option],
    { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } },
  );
  if (git.error) throw git.error;
  if (git.status !== 0) {
    if (git.stderr.includes('not a git repository')) return null;
    throw new Error(
      `Cannot resolve workspace Git directories: ${git.stderr.trim()}`,
    );
  }
  return git.stdout.replace(/\r?\n$/, '');
}

/**
 * With an isolated runtime, only the private overlay at the original git dir is writable.
 * The Git paths to grant a sandboxed run in `workspacePath`. A linked worktree
 * gets its own git dir and the shared objects, refs and reflogs, never the
 * shared dir itself, so its config, hooks and lock files stay unwritable.
 * Only existing paths are named: a sandbox mounts over a missing protected
 * path by creating an empty placeholder in the real repository.
 */
export function gitSandboxPaths(
  workspacePath: string,
  isolated = false,
): GitSandboxPaths {
  const gitDir = revParse(workspacePath, '--git-dir');
  if (gitDir === null) return { write: [], protect: [] };
  if (isolated) return { write: [gitDir], protect: [] };
  const common = revParse(workspacePath, '--git-common-dir') ?? gitDir;
  const shared =
    common === gitDir ? [] : SHARED_WRITES.map((name) => join(common, name));
  return {
    write: [gitDir, ...shared.filter((path) => existsSync(path))],
    protect: PROTECTED.map((name) => join(gitDir, name)).filter((path) =>
      existsSync(path),
    ),
  };
}

/**
 * `allow_write` without entries that are, or lie inside, a `.git` directory:
 * granting one whole makes the sandbox protect metadata inside it, which it
 * materialises as placeholders. Git metadata comes from `gitSandboxPaths`.
 */
export function withoutGitDirs(
  paths: readonly string[],
  warn: (message: string) => void = console.warn,
): string[] {
  return paths.filter((path) => {
    const inGit = path.split(sep).includes('.git');
    if (inGit) {
      warn(
        `sandbox.allow_write: ignoring ${path}; Git metadata is granted automatically`,
      );
    }
    return !inGit;
  });
}
