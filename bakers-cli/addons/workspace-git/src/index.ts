// BB-224 (Finding 6, decisions 8 + 10): the plain git-worktree workspace —
// formerly `@bakers-build/core`'s `plugins/workspace/git.ts` — now its own
// conductor-surface addon, which ALSO owns `loadInstructions` (the WORKFLOW.md
// loader that used to be a core util). `@bakers-build/addon-herdr` depends on this
// package for it: the one addon→addon edge the layered acyclic rule permits.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  BbWorkspace,
  ConductorFileConfig,
  EnsuredWorkspace,
  ExecutorDeps,
  WorkspacePlugin,
  WorktreeTeardown,
} from '@bakers-build/conductor/contract';
import {
  type ConductorLogger,
  deriveCheckoutRoot,
  exec,
} from '@bakers-build/core';
import { runBranchGit } from './git-config.js';
import { loadInstructions } from './instructions.js';
import { removeGitWorktree, ticketWorktrees } from './remove-git-worktree.js';
import {
  ensureRunClone,
  removeRunCloneWorkspace,
  targetOf,
} from './run-clone.js';

export { restoreWritable } from './fs.js';
export {
  pushCurrentEnv,
  runBranchGit,
  setNoAutoSetupMerge,
} from './git-config.js';
export { loadInstructions } from './instructions.js';
export {
  removeGitWorktree,
  type WorktreeGitExec,
} from './remove-git-worktree.js';
export {
  ensureRunClone,
  removeRunCloneWorkspace,
  targetOf,
} from './run-clone.js';

// shortcut: one default for all executors, upgrade when an executor needs another value.
export const DEFAULT_WORKTREE_DIR = '.bakers-worktrees';

/** Runs `git <args>` in a cwd; resolves with stdout when it has one. */
export type GitRunner = (
  args: string[],
  cwd: string,
) => Promise<string | undefined>;

export interface GitWorkspaceOptions {
  /** Main clone (a git repo): config source + worktree base. */
  root: string;
  /** Directory of new worktrees, relative to `root` or absolute. Default: {@link DEFAULT_WORKTREE_DIR}. */
  worktreeDir?: string;
  /**
   * Default `false`: before creating a worktree, set `branch.autoSetupMerge=false`
   * in `root`, and give runs `push.default=current`. `true` leaves Git alone.
   */
  autoSetupMerge?: boolean;
  /** Receives the warning when `branch.autoSetupMerge` cannot be written. */
  logger?: ConductorLogger;
  runGit?: GitRunner;
  /** The runtime isolates: a fresh run clone per ensure instead of a linked worktree. */
  clone?: boolean;
  /** Run clones borrow the root's objects (`git clone --shared`). */
  shared?: boolean;
}

const defaultGitRunner: GitRunner = (args, cwd) => exec('git', args, { cwd });

const noopLogger: ConductorLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export class GitWorkspace implements BbWorkspace {
  private readonly runGit: GitRunner;
  private readonly root: string;
  private readonly worktreeDir: string;
  private readonly autoSetupMerge: boolean;
  private readonly logger: ConductorLogger | undefined;
  private readonly clone: boolean;
  private readonly shared: boolean;

  constructor(options: GitWorkspaceOptions) {
    this.runGit = options.runGit ?? defaultGitRunner;
    this.root = resolve(options.root);
    this.worktreeDir = resolve(
      this.root,
      options.worktreeDir ?? DEFAULT_WORKTREE_DIR,
    );
    this.autoSetupMerge = options.autoSetupMerge ?? false;
    this.logger = options.logger;
    this.clone = options.clone ?? false;
    this.shared = options.shared ?? false;
  }

  /**
   * Check out the ticket `branch` at `<worktreeDir>/<branch>`. `_identifier`
   * is unused: the conductor passes the ticket's `branch_name`, which push and
   * PR use, so the workspace never renders a branch of its own.
   */
  async ensure(
    _identifier: string,
    branch?: string,
    baseRef?: string,
  ): Promise<EnsuredWorkspace> {
    if (!branch) throw new Error('git workspace requires a branch name');
    // A ref git accepts has no `..`, leading `/`, `-` or `.`, so the path
    // below cannot leave worktreeDir; `@{-1}` expands, hence the comparison.
    let checked: string | undefined;
    try {
      checked = await this.runGit(
        ['check-ref-format', '--branch', branch],
        this.root,
      );
    } catch {
      checked = undefined;
    }
    if (checked?.trim() !== branch) {
      throw new Error(`invalid branch name: ${branch}`);
    }
    const path = resolve(this.worktreeDir, branch);
    const env = this.autoSetupMerge
      ? undefined
      : await runBranchGit(this.root, this.logger);
    const extra = env ? { env } : {};
    if (this.clone) {
      const created = !existsSync(path);
      await this.ensureBranch(branch);
      const target = targetOf(baseRef);
      if (target && baseRef?.startsWith('origin/')) {
        try {
          await this.runGit(
            ['-C', this.root, 'fetch', '--quiet', 'origin', '--', target],
            this.root,
          );
        } catch {
          // Offline or no remote: the clone carries the target as last fetched.
        }
      }
      const clone = ensureRunClone({
        parent: this.root,
        workspace: path,
        branch,
        ...(target ? { target } : {}),
        shared: this.shared,
      });
      return {
        path,
        instructions: loadInstructions(path),
        created,
        clone,
        ...extra,
      };
    }
    // Reuse the branch's worktree wherever it lives: old `<root>-worktrees/`
    // checkouts keep working and are never moved.
    const listed = await this.runGit(
      ['-C', this.root, 'worktree', 'list', '--porcelain'],
      this.root,
    );
    const existing =
      ticketWorktrees(listed ?? '', this.root).find(
        (w) => w.branch === branch && existsSync(w.path),
      )?.path ?? (existsSync(path) ? path : undefined);
    if (existing) {
      return {
        path: existing,
        instructions: loadInstructions(existing),
        created: false,
        ...extra,
      };
    }
    await this.ensureBranch(branch);
    // No `-B`: an existing ticket branch is checked out, never reset;
    // `--force` takes over a registration whose directory is gone.
    await this.runGit(
      ['-C', this.root, 'worktree', 'add', '--force', path, branch],
      this.root,
    );
    // The `after_create` hook is run by the conductor, not here — the
    // workspace only reports that it created a fresh worktree.
    return {
      path,
      instructions: loadInstructions(path),
      created: true,
      ...extra,
    };
  }

  /** Create `branch` at the root's HEAD unless it exists; an existing one stays put. */
  private async ensureBranch(branch: string): Promise<void> {
    try {
      await this.runGit(
        [
          '-C',
          this.root,
          'rev-parse',
          '--verify',
          '--quiet',
          `refs/heads/${branch}`,
        ],
        this.root,
      );
    } catch {
      await this.runGit(['-C', this.root, 'branch', branch], this.root);
    }
  }

  /** Tear down the ticket worktree with git ({@link removeGitWorktree}). */
  async remove(
    branch: string,
    worktreePath?: string,
  ): Promise<WorktreeTeardown> {
    const removed = removeRunCloneWorkspace(worktreePath);
    if (removed) return removed;
    return removeGitWorktree(
      this.root,
      branch,
      worktreePath,
      async (args, cwd) => (await this.runGit(['-C', cwd, ...args], cwd)) ?? '',
      this.logger ?? noopLogger,
    );
  }
}

/** The addon entry's `with` value (see options.schema.json). */
export interface GitWorkspaceAddonOptions {
  worktree_dir?: string;
  auto_setup_merge?: boolean;
  shared?: boolean;
}

export function gitWorkspace(
  opts: GitWorkspaceAddonOptions = {},
): WorkspacePlugin {
  return {
    kind: 'worktree',
    id: 'git',
    requiredModules: [],
    async createWorkspace(config: ConductorFileConfig, deps?: ExecutorDeps) {
      // BB-450 D2: the checkout root, through the one shared helper, never a
      // bare `dirname(config_path)` re-derived here.
      const root = await deriveCheckoutRoot(config.config_path);
      return new GitWorkspace({
        root,
        ...(opts.worktree_dir ? { worktreeDir: opts.worktree_dir } : {}),
        ...(opts.auto_setup_merge ? { autoSetupMerge: true } : {}),
        ...(deps?.logger ? { logger: deps.logger } : {}),
        clone: config.runtime?.isolates === true,
        ...(opts.shared ? { shared: true } : {}),
      });
    },
  };
}

export default gitWorkspace;
