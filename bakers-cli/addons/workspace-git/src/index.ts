// BB-224 (Finding 6, decisions 8 + 10): the plain git-worktree workspace —
// formerly `@bakers-build/core`'s `plugins/workspace/git.ts` — now its own
// conductor-surface addon, which ALSO owns `loadInstructions` (the WORKFLOW.md
// loader that used to be a core util). `@bakers-build/addon-herdr` depends on this
// package for it: the one addon→addon edge the layered acyclic rule permits.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
  slugify,
} from '@bakers-build/core';
import { runBranchGit } from './git-config.js';
import { loadInstructions } from './instructions.js';
import { removeGitWorktree } from './remove-git-worktree.js';
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

/** Default branch template: `<prefix><key>-<title-slug>` (readable). */
export const DEFAULT_BRANCH_TEMPLATE = '{branch_prefix}{key}-{title_slug}';

function renderBranchTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  const rendered = template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = vars[key];
    return value === undefined ? whole : value;
  });
  // An empty title slug leaves a dangling separator (e.g. `bakers/GL-9-`) —
  // trim trailing branch separators so the branch stays a valid, tidy ref.
  return rendered.replace(/[-_./]+$/g, '');
}

/** Runs `git <args>` in a cwd; resolves with stdout when it has one. */
export type GitRunner = (
  args: string[],
  cwd: string,
) => Promise<string | undefined>;

export interface GitWorkspaceOptions {
  /** Main clone (a git repo): config source + worktree base. */
  root: string;
  /** Where per-ticket worktrees live. Default: `${root}-worktrees`. */
  worktreesRoot?: string;
  /** Branch name prefix per ticket. Default: 'bakers/'. */
  branchPrefix?: string;
  /**
   * Branch name template. Vars: {branch_prefix}, {key} (sanitized identifier),
   * {identifier}, {title_slug}. Default: `{branch_prefix}{key}-{title_slug}`.
   */
  branchTemplate?: string;
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
  private readonly worktreesRoot: string;
  private readonly branchPrefix: string;
  private readonly branchTemplate: string;
  private readonly autoSetupMerge: boolean;
  private readonly logger: ConductorLogger | undefined;
  private readonly clone: boolean;
  private readonly shared: boolean;

  constructor(options: GitWorkspaceOptions) {
    this.runGit = options.runGit ?? defaultGitRunner;
    this.root = resolve(options.root);
    this.worktreesRoot = options.worktreesRoot
      ? resolve(options.worktreesRoot)
      : `${this.root}-worktrees`;
    this.branchPrefix = options.branchPrefix ?? 'bakers/';
    this.branchTemplate = options.branchTemplate ?? DEFAULT_BRANCH_TEMPLATE;
    this.autoSetupMerge = options.autoSetupMerge ?? false;
    this.logger = options.logger;
    this.clone = options.clone ?? false;
    this.shared = options.shared ?? false;
  }

  /** Render the branch name for a ticket from the configured template. */
  branchFor(identifier: string, title?: string): string {
    return renderBranchTemplate(this.branchTemplate, {
      branch_prefix: this.branchPrefix,
      key: this.keyFor(identifier),
      identifier,
      title_slug: slugify(title ?? ''),
    });
  }

  keyFor(identifier: string): string {
    return identifier.replace(/[^A-Za-z0-9._-]/g, '_');
  }

  private pathFor(key: string): string {
    return resolve(join(this.worktreesRoot, key));
  }

  async ensure(
    identifier: string,
    title?: string,
    baseRef?: string,
  ): Promise<EnsuredWorkspace> {
    const key = this.keyFor(identifier);
    // Reject empty and dot-leading keys: a dot-leading key would produce an
    // invalid git ref (e.g. `bakers/.hidden`) and covers '.'/'..' too.
    if (key === '' || key.startsWith('.')) {
      throw new Error(`invalid workspace identifier: ${identifier}`);
    }
    const path = this.pathFor(key);
    const env = this.autoSetupMerge
      ? undefined
      : await runBranchGit(this.root, this.logger);
    const extra = env ? { env } : {};
    if (this.clone) {
      const created = !existsSync(path);
      const branch = this.branchFor(identifier, title);
      // Like `worktree add -B` on first use, but an existing branch stays put.
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
    if (existsSync(path)) {
      return {
        path,
        instructions: loadInstructions(path),
        created: false,
        ...extra,
      };
    }
    const branch = this.branchFor(identifier, title);
    await this.runGit(
      ['-C', this.root, 'worktree', 'add', '--force', '-B', branch, path],
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
  branch_prefix?: string;
  branch_template?: string;
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
        ...(opts.branch_prefix ? { branchPrefix: opts.branch_prefix } : {}),
        ...(opts.branch_template
          ? { branchTemplate: opts.branch_template }
          : {}),
        ...(opts.auto_setup_merge ? { autoSetupMerge: true } : {}),
        ...(deps?.logger ? { logger: deps.logger } : {}),
        clone: config.runtime?.isolates === true,
        // A runtime's `shared` wins; the workspace option is the deprecated fallback.
        shared: config.runtime?.shared ?? opts.shared ?? false,
      });
    },
  };
}

export default gitWorkspace;
