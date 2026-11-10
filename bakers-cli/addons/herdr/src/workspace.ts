import { resolve } from 'node:path';
import {
  loadInstructions,
  runBranchGit,
  type WorktreeGitExec,
} from '@bakers-build/addon-workspace-git';
import type {
  BbWorkspace,
  ConductorFileConfig,
  EnsuredWorkspace,
  ExecutorDeps,
  WorkspacePlugin,
  WorktreeTeardown,
} from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { exec } from '@bakers-build/core';
import { rejectRenamed } from './config.js';
import { isRecord, parseJson } from './pane-layout.js';
import { deriveHerdrRoot, type RootGitExec } from './root-anchor.js';
import { resolveBaseRef } from './shared.js';
import { removeHerdrWorktree } from './worktrees.js';

export type HerdrExec = (args: string[]) => Promise<string>;
export type GitExec = (args: string[]) => Promise<string>;

export interface HerdrWorkspaceOptions {
  /** Main clone (a git repo): herdr `--cwd` target + worktree base. */
  root: string;
  /** Relative dir (under root) for new worktrees. Default: `.bakers-worktrees`. */
  worktreeDir?: string;
  /**
   * Base ref new worktree branches are created from. Default: the remote
   * tracking branch of the repo's checked-out branch (e.g. `origin/develop`),
   * so runs start from the pushed remote state, not the host's local branch.
   */
  baseBranch?: string;
  /** Overrideable herdr exec fn — defaults to the real `herdr` binary. */
  execHerdr?: HerdrExec;
  /** Overrideable git exec fn — defaults to the real `git` binary. */
  execGit?: GitExec;
  /** Overrideable git runner in a cwd, for the teardown fallback. */
  runGit?: WorktreeGitExec;
  /** Optional logger for the teardown (defaults to noop). */
  logger?: ConductorLogger;
  /**
   * Default `false`: before creating a worktree, set `branch.autoSetupMerge=false`
   * in `root`, and give runs `push.default=current`. `true` leaves Git alone.
   */
  autoSetupMerge?: boolean;
}

const defaultExec: HerdrExec = (args) => exec('herdr', args);
const defaultGitExec: GitExec = (args) => exec('git', args);
const defaultRunGit: WorktreeGitExec = (args, cwd) =>
  exec('git', args, { cwd });

const noopLogger: ConductorLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

interface WorktreeEntry {
  branch: string;
  path: string;
  open_workspace_id?: string;
}

/** Parse `herdr worktree list --json` → array of on-disk worktrees. */
function parseWorktreeList(output: string): WorktreeEntry[] {
  const parsed = parseJson(output, 'worktree list');
  const worktrees = isRecord(parsed)
    ? (parsed.result as { worktrees?: unknown } | undefined)?.worktrees
    : undefined;
  if (!Array.isArray(worktrees)) {
    throw new Error('herdr worktree list returned invalid schema');
  }
  return worktrees
    .filter(isRecord)
    .filter((w) => typeof w.branch === 'string' && typeof w.path === 'string')
    .map((w) => ({
      branch: w.branch as string,
      path: w.path as string,
      ...(typeof w.open_workspace_id === 'string'
        ? { open_workspace_id: w.open_workspace_id }
        : {}),
    }));
}

/** Parse `worktree create`/`worktree open` → the created/opened worktree path. */
function parseWorktreePath(output: string, command: string): string {
  const parsed = parseJson(output, command);
  const path = isRecord(parsed)
    ? (parsed.result as { worktree?: { path?: unknown } } | undefined)?.worktree
        ?.path
    : undefined;
  if (typeof path !== 'string') {
    throw new Error(`herdr ${command} returned invalid schema`);
  }
  return path;
}

/** Git-safe branch validation: safe ref chars only, no leading dot, no `..`. */
export function validateBranch(branch: string): void {
  if (
    !/^[A-Za-z0-9._/-]+$/.test(branch) ||
    branch.startsWith('.') ||
    branch.includes('..')
  ) {
    throw new Error(`invalid workspace branch: ${branch}`);
  }
}

export class HerdrWorkspace implements BbWorkspace {
  private readonly execHerdr: HerdrExec;
  private readonly execGit: GitExec;
  private readonly root: string;
  private readonly worktreeDir: string;
  private readonly logger: ConductorLogger;
  private readonly runGit: WorktreeGitExec;

  constructor(private readonly options: HerdrWorkspaceOptions) {
    this.execHerdr = options.execHerdr ?? defaultExec;
    this.execGit = options.execGit ?? defaultGitExec;
    this.root = resolve(options.root);
    this.worktreeDir = options.worktreeDir ?? '.bakers-worktrees';
    this.runGit = options.runGit ?? defaultRunGit;
    this.logger = options.logger ?? noopLogger;
  }

  /**
   * Ensure the branch's worktree + herdr workspace exist.
   *
   * `_identifier` is unused HERE: the worktree is located by branch, and the
   * open layout — the one thing that consumed the identifier, to render
   * `{identifier}` (BB-234) — is applied by `HerdrExecutor.openWorkspace`,
   * which takes it on its own `ctx`. The parameter stays because it is the
   * `BbWorkspace.ensure` contract position (the git workspace does use it).
   * It is still taken as-passed rather than parsed back out of `branch`, which
   * remains the reason the contract carries it at all.
   */
  async ensure(
    _identifier: string,
    branch?: string,
    baseRefOverride?: string,
  ): Promise<EnsuredWorkspace> {
    if (branch === undefined) {
      throw new Error('herdr workspace requires a branch name');
    }
    validateBranch(branch);
    const extra = this.options.autoSetupMerge
      ? {}
      : { env: await runBranchGit(this.root, this.logger) };

    const worktrees = parseWorktreeList(
      await this.execHerdr(['worktree', 'list', '--cwd', this.root, '--json']),
    );
    const existing = worktrees.find((w) => w.branch === branch);

    if (existing) {
      // Reuse: an existing worktree is never re-created, so created=false — the
      // core skips after_create only when a success is recorded for it. The open layout is NOT
      // re-applied on reuse (BB-139): no duplicate editor process on reattach.
      let path = existing.path;
      if (!existing.open_workspace_id) {
        // On-disk worktree with no open herdr workspace — open it.
        path = parseWorktreePath(
          await this.execHerdr([
            'worktree',
            'open',
            '--cwd',
            this.root,
            '--branch',
            branch,
            '--no-focus',
            '--json',
          ]),
          'worktree open',
        );
      }
      return {
        path,
        instructions: loadInstructions(path),
        created: false,
        ...extra,
      };
    }

    // Fresh: create the git worktree + herdr workspace in one call. Base the
    // new branch on the (freshly fetched) remote tracking branch, not the
    // host's local checked-out branch. A ticket passes its `origin/<base_branch>`
    // as the override; use it only when it resolves on the remote, else fall
    // back to the default base.
    const baseRef = await resolveBaseRef(this.root, this.execGit, {
      ...(this.options.baseBranch
        ? { baseBranch: this.options.baseBranch }
        : {}),
      ...(baseRefOverride !== undefined ? { override: baseRefOverride } : {}),
    });
    const createOutput = await this.execHerdr([
      'worktree',
      'create',
      '--cwd',
      this.root,
      '--branch',
      branch,
      ...(baseRef !== undefined ? ['--base', baseRef] : []),
      '--label',
      branch,
      // ABSOLUTE, never relative: herdr canonicalizes a relative `--path`
      // against its own `current_dir()`, which fails with
      // `Os { code: 2, kind: NotFound }` whenever the CALLER's cwd has been
      // deleted — e.g. a conductor still polling from a reaped worktree. That
      // killed every dispatch with an unattributable herdr exit 1. `resolve`
      // (not `join`) so an absolute `worktreeDir` override still wins.
      '--path',
      resolve(this.root, this.worktreeDir, branch),
      '--no-focus',
      '--json',
    ]);
    const path = parseWorktreePath(createOutput, 'worktree create');

    // The `after_create` hook and the open layout run after `ensure()` returns
    // (conductor, then `HerdrExecutor.openWorkspace`) — the workspace only
    // reports that it created a fresh worktree.
    return {
      path,
      instructions: loadInstructions(path),
      created: true,
      ...extra,
    };
  }

  /**
   * Tear down the branch's worktree and its herdr workspace
   * (`herdr worktree remove --force`); a worktree herdr no longer tracks is
   * torn down with git alone. See {@link removeHerdrWorktree}.
   */
  remove(branch: string, worktreePath?: string): Promise<WorktreeTeardown> {
    return removeHerdrWorktree(
      {
        root: this.root,
        execHerdr: this.execHerdr,
        runGit: this.runGit,
        logger: this.logger,
      },
      branch,
      worktreePath,
    );
  }
}

export function herdrWorkspace(
  opts: {
    /**
     * Explicit repo-root override; wins over the git-derived anchor. Otherwise
     * the main clone is derived from the git common dir (BB-177).
     */
    root?: string;
    worktree_dir?: string;
    base_branch?: string;
    auto_setup_merge?: boolean;
    /** Overrideable git exec for root derivation (tests). */
    execGit?: RootGitExec;
    /** Overrideable herdr exec (tests) — sibling of `execGit`. */
    execHerdr?: HerdrExec;
  } = {},
): WorkspacePlugin {
  rejectRenamed(opts);
  return {
    kind: 'worktree',
    id: 'herdr',
    requiredModules: [],
    // `deps` carries the conductor logger, so teardown warnings are actually
    // logged. Optional per the contract — absent, the noop default stays.
    async createWorkspace(config: ConductorFileConfig, deps?: ExecutorDeps) {
      const root = await deriveHerdrRoot(config.config_path, {
        ...(opts.root !== undefined ? { override: opts.root } : {}),
        ...(opts.execGit ? { execGit: opts.execGit } : {}),
      });
      return new HerdrWorkspace({
        root,
        ...(opts.worktree_dir ? { worktreeDir: opts.worktree_dir } : {}),
        ...(opts.base_branch ? { baseBranch: opts.base_branch } : {}),
        ...(opts.execHerdr ? { execHerdr: opts.execHerdr } : {}),
        ...(opts.auto_setup_merge ? { autoSetupMerge: true } : {}),
        ...(deps?.logger ? { logger: deps.logger } : {}),
      });
    },
  };
}

export default herdrWorkspace;
