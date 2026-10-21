import { dirname, join } from 'node:path';
import { exec } from './exec.js';

/** Runs `git <args>` in a cwd; resolves stdout, rejects on non-zero exit. */
export type RootGitExec = (args: string[], cwd: string) => Promise<string>;

/** Default git runner for root derivation: real `git` in the given cwd. */
export const defaultRootGitExec: RootGitExec = (args, cwd) =>
  exec('git', args, { cwd });

/**
 * Derive the checkout root — the top of the working tree a conductor serves —
 * from its config path. This is the single shared anchor (BB-177, widened by
 * BB-450) every call site that used to compare or store "the directory this
 * conductor runs in" now calls, instead of taking a bare `dirname(config_path)`
 * or a process's cwd as a stand-in.
 *
 * The config path is NOT a safe anchor on its own: `.bakers/` is checked in, so
 * config discovery walks up to the *worktree-local* config, whose dirname IS a
 * linked worktree rather than the main clone. Instead ask git: `git rev-parse
 * --path-format=absolute --git-common-dir`, run from the config dir, always
 * resolves to the shared main `.git` even from a linked worktree; its parent is
 * the checkout root.
 *
 * `override` (a factory `root:` option) always wins and skips git entirely.
 * Best-effort: a missing `config_path` or a git failure (e.g. not a repo) falls
 * back to `dirname(config_path)` — the previous behaviour — and finally
 * `process.cwd()`.
 */
export async function deriveCheckoutRoot(
  configPath: string | undefined,
  opts: { override?: string; execGit?: RootGitExec } = {},
): Promise<string> {
  if (opts.override !== undefined) {
    return opts.override;
  }
  const configDir = configPath ? dirname(configPath) : undefined;
  const fallback = configDir ?? process.cwd();
  if (configDir === undefined) {
    return fallback;
  }
  const execGit = opts.execGit ?? defaultRootGitExec;
  try {
    const commonDir = (
      await execGit(
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        configDir,
      )
    ).trim();
    return commonDir ? dirname(commonDir) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The config home for a checkout root: `<checkout root>/.bakers`. Derived, never
 * stored (D3/D7) — one caller re-spelling `.bakers` by hand is exactly how the
 * checkout root and its config directory came to be confused with each other.
 */
export function configHomeOf(checkoutRoot: string): string {
  return join(checkoutRoot, '.bakers');
}
