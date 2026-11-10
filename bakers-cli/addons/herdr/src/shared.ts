// The herdr pieces a sibling host addon (`@bakers-build/addon-orca`) reuses
// rather than copies: the 0600 launch wrapper + its watch, the label template,
// the Drupal write-bit restore and the worktree base-ref resolution.
export { renderTemplate } from './config.js';
export { restoreWritable } from './fs.js';
export {
  type LaunchScript,
  type LaunchWatchOptions,
  watchLaunch,
  writeLaunchScript,
} from './launch-script.js';
export { truncateOpenTabTitle } from './open-layout.js';
export { validateBranch } from './workspace.js';

/** Runs `git <args>`; resolves with stdout, rejects on non-zero exit. */
export type BaseRefGitExec = (args: string[]) => Promise<string>;

/**
 * Resolve (and fetch) the base ref a NEW worktree branch is created from, so a
 * run starts from the pushed remote state, not the host's local branch.
 *
 * A ticket's `override` (its `origin/<base_branch>`) wins only when it resolves
 * on the remote after a fetch; otherwise the configured `base_branch`, else the
 * upstream of the repo's HEAD (e.g. `origin/develop`). A repo with no upstream
 * yields `undefined`. Fetch failures are non-fatal (offline / unknown remote).
 */
export async function resolveBaseRef(
  root: string,
  execGit: BaseRefGitExec,
  opts: { baseBranch?: string; override?: string },
): Promise<string | undefined> {
  const fetch = async (ref: string) => {
    const slash = ref.indexOf('/');
    if (slash <= 0) return;
    try {
      await execGit([
        '-C',
        root,
        'fetch',
        ref.slice(0, slash),
        ref.slice(slash + 1),
      ]);
    } catch {
      // Non-fatal: use whatever the local tracking ref already points at.
    }
  };
  if (opts.override !== undefined) {
    await fetch(opts.override);
    try {
      await execGit([
        '-C',
        root,
        'rev-parse',
        '--verify',
        '--quiet',
        `${opts.override}^{commit}`,
      ]);
      return opts.override;
    } catch {
      // Not on the remote — fall back to the default base below.
    }
  }
  let ref = opts.baseBranch;
  if (!ref) {
    try {
      ref =
        (
          await execGit([
            '-C',
            root,
            'rev-parse',
            '--abbrev-ref',
            '--symbolic-full-name',
            '@{u}',
          ])
        ).trim() || undefined;
    } catch {
      return undefined;
    }
  }
  if (ref !== undefined) await fetch(ref);
  return ref;
}
