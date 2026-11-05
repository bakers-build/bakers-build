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
  WorkspacePlugin,
} from '@bakers-build/conductor/contract';
import { deriveCheckoutRoot, exec, slugify } from '@bakers-build/core';
import { runBranchGit } from './git-config.js';
import { loadInstructions } from './instructions.js';

export {
  pushCurrentEnv,
  runBranchGit,
  setNoAutoSetupMerge,
} from './git-config.js';
export { loadInstructions } from './instructions.js';

/** Default branch template: `<prefix><key>-<title-slug>` (readable). */
export const DEFAULT_BRANCH_TEMPLATE = '{branchPrefix}{key}-{titleSlug}';

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

export type GitRunner = (args: string[], cwd: string) => Promise<void>;

export interface GitWorkspaceOptions {
  /** Main clone (a git repo): config source + worktree base. */
  root: string;
  /** Where per-ticket worktrees live. Default: `${root}-worktrees`. */
  worktreesRoot?: string;
  /** Branch name prefix per ticket. Default: 'bakers/'. */
  branchPrefix?: string;
  /**
   * Branch name template. Vars: {branchPrefix}, {key} (sanitized identifier),
   * {identifier}, {titleSlug}. Default: `{branchPrefix}{key}-{titleSlug}`.
   */
  branchTemplate?: string;
  /**
   * Default `false`: before creating a worktree, set `branch.autoSetupMerge=false`
   * in `root`, and give runs `push.default=current`. `true` leaves Git alone.
   */
  autoSetupMerge?: boolean;
  runGit?: GitRunner;
}

const defaultGitRunner: GitRunner = async (args, cwd) => {
  await exec('git', args, { cwd });
};

export class GitWorkspace implements BbWorkspace {
  private readonly runGit: GitRunner;
  private readonly root: string;
  private readonly worktreesRoot: string;
  private readonly branchPrefix: string;
  private readonly branchTemplate: string;
  private readonly autoSetupMerge: boolean;

  constructor(options: GitWorkspaceOptions) {
    this.runGit = options.runGit ?? defaultGitRunner;
    this.root = resolve(options.root);
    this.worktreesRoot = options.worktreesRoot
      ? resolve(options.worktreesRoot)
      : `${this.root}-worktrees`;
    this.branchPrefix = options.branchPrefix ?? 'bakers/';
    this.branchTemplate = options.branchTemplate ?? DEFAULT_BRANCH_TEMPLATE;
    this.autoSetupMerge = options.autoSetupMerge ?? false;
  }

  /** Render the branch name for a ticket from the configured template. */
  branchFor(identifier: string, title?: string): string {
    return renderBranchTemplate(this.branchTemplate, {
      branchPrefix: this.branchPrefix,
      key: this.keyFor(identifier),
      identifier,
      titleSlug: slugify(title ?? ''),
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
    _baseRef?: string,
  ): Promise<EnsuredWorkspace> {
    const key = this.keyFor(identifier);
    // Reject empty and dot-leading keys: a dot-leading key would produce an
    // invalid git ref (e.g. `bakers/.hidden`) and covers '.'/'..' too.
    if (key === '' || key.startsWith('.')) {
      throw new Error(`invalid workspace identifier: ${identifier}`);
    }
    const path = this.pathFor(key);
    const env = this.autoSetupMerge ? undefined : await runBranchGit(this.root);
    const extra = env ? { env } : {};
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
    // The `after_create` hook is run by the executor (BB-84), not here — the
    // workspace only reports that it created a fresh worktree.
    return {
      path,
      instructions: loadInstructions(path),
      created: true,
      ...extra,
    };
  }

  async remove(identifier: string): Promise<void> {
    const key = this.keyFor(identifier);
    const path = this.pathFor(key);
    await this.runGit(
      ['-C', this.root, 'worktree', 'remove', '--force', path],
      this.root,
    );
  }
}

export function gitWorkspace(
  opts: { branchPrefix?: string; branchTemplate?: string } = {},
): WorkspacePlugin {
  return {
    kind: 'workspace',
    id: 'git',
    requiredModules: [],
    async createWorkspace(config: ConductorFileConfig) {
      // BB-450 D2: the checkout root, through the one shared helper, never a
      // bare `dirname(config_path)` re-derived here.
      const root = await deriveCheckoutRoot(config.config_path);
      return new GitWorkspace({
        root,
        ...(opts.branchPrefix ? { branchPrefix: opts.branchPrefix } : {}),
        ...(opts.branchTemplate ? { branchTemplate: opts.branchTemplate } : {}),
      });
    },
  };
}

export default gitWorkspace;
