import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  rejectRenamed,
  resolveBaseRef,
  restoreWritable,
  validateBranch,
} from '@bakers-build/addon-herdr/shared';
import {
  loadInstructions,
  removeGitWorktree,
  runBranchGit,
} from '@bakers-build/addon-workspace-git';
import type {
  BbWorkspace,
  ConductorFileConfig,
  EnsuredWorkspace,
  ExecutorDeps,
  WorkspacePlugin,
  WorktreeTeardown,
} from '@bakers-build/conductor/contract';
import type { ConductorLogger, RootGitExec } from '@bakers-build/core';
import { deriveCheckoutRoot, exec } from '@bakers-build/core';
import {
  assertOrcaReachable,
  createOrcaExec,
  isRecord,
  OrcaError,
  type OrcaExec,
} from './orca-cli.js';

export type GitExec = (args: string[]) => Promise<string>;

function normPath(path: string): string {
  return path.replace(/\/+$/, '');
}
export type Sleep = (ms: number) => Promise<void>;

/**
 * The overview terminal a FRESH worktree opens. `{identifier}`, `{branch}`,
 * `{title}` and `{worktree_path}` expand in both; `open: {}` opens nothing.
 */
export interface OrcaOpenLayout {
  command?: string;
  title?: string;
}

export const DEFAULT_OPEN_LAYOUT: OrcaOpenLayout = {
  command: 'bakers ui --ticket {identifier}',
  title: '{identifier} · {title}',
};

/** Above Orca's 30 s worktree scan cache, so one rescan always fits. */
export const DEFAULT_ADOPT_TIMEOUT_MS = 35_000;
const ADOPT_POLL_MS = 1000;

export const defaultSleep: Sleep = (ms) =>
  new Promise((r) => setTimeout(r, ms));

export const noopLogger: ConductorLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * Wait until Orca resolves `path` as a worktree. Orca adopts worktrees made
 * with plain git by rescanning `git worktree list`, which it caches for up to
 * 30 s, so a fresh worktree is `selector_not_found` for a while.
 */
export async function waitForAdoption(
  orca: OrcaExec,
  path: string,
  timeoutMs: number,
  sleep: Sleep,
): Promise<void> {
  const attempts = Math.max(1, Math.ceil(timeoutMs / ADOPT_POLL_MS));
  for (let i = 0; i < attempts; i++) {
    try {
      await orca(['worktree', 'show', '--worktree', `path:${path}`]);
      return;
    } catch (err) {
      if (!(err instanceof OrcaError) || err.code !== 'selector_not_found') {
        throw err;
      }
    }
    if (i < attempts - 1) await sleep(ADOPT_POLL_MS);
  }
  throw new Error(
    `Orca did not pick up worktree ${path} within ${Math.round(timeoutMs / 1000)}s`,
  );
}

/** Register `root` with Orca once and make its git worktrees visible. */
export async function registerRepo(
  orca: OrcaExec,
  root: string,
): Promise<void> {
  const listed = await orca(['repo', 'list']);
  const repos =
    isRecord(listed) && Array.isArray(listed.repos) ? listed.repos : [];
  const known = repos.some(
    (r) =>
      isRecord(r) && typeof r.path === 'string' && resolve(r.path) === root,
  );
  if (!known) {
    await orca(['repo', 'add', '--path', root]);
  }
  // Idempotent; without it Orca's sidebar hides worktrees it did not create.
  await orca([
    'repo',
    'set',
    '--repo',
    `path:${root}`,
    '--external-worktree-visibility',
    'show',
  ]);
}

/** `git worktree list --porcelain` records; the main checkout comes first. */
export function porcelainEntries(
  output: string,
): { path: string; branch: string | null }[] {
  return output
    .split('\n\n')
    .map((record) => {
      const lines = record.split('\n');
      const path = lines.find((l) => l.startsWith('worktree '));
      const branch = lines.find((l) => l.startsWith('branch '));
      return {
        path: path ? path.slice('worktree '.length).trim() : '',
        branch: branch
          ? branch
              .slice('branch '.length)
              .trim()
              .replace(/^refs\/heads\//, '')
          : null,
      };
    })
    .filter((e) => e.path);
}

export interface OrcaWorkspaceOptions {
  /** Main clone (a git repo) that Orca registers and worktrees branch from. */
  root: string;
  /** Relative dir (under root) for new worktrees. Default `.bakers-worktrees`. */
  worktreeDir?: string;
  /** Base ref for new branches. Default: the upstream of the root's HEAD. */
  baseBranch?: string;
  adoptTimeoutMs?: number;
  execOrca?: OrcaExec;
  execGit?: GitExec;
  logger?: ConductorLogger;
  sleep?: Sleep;
  /**
   * Default `false`: before creating a worktree, set `branch.autoSetupMerge=false`
   * in `root`, check out remote branches without `--track`, and give runs
   * `push.default=current`. `true` leaves Git alone.
   */
  autoSetupMerge?: boolean;
}

/**
 * Per-ticket worktree hosted in Orca. The worktree is created with plain git on
 * the exact ticket branch — `orca worktree create` can neither take an existing
 * branch nor keep a name it considers taken — and Orca adopts it.
 */
export class OrcaWorkspace implements BbWorkspace {
  private readonly root: string;
  private readonly execOrca: OrcaExec;
  private readonly execGit: GitExec;
  private readonly logger: ConductorLogger;
  private readonly sleep: Sleep;

  constructor(private readonly options: OrcaWorkspaceOptions) {
    this.root = resolve(options.root);
    this.execOrca = options.execOrca ?? createOrcaExec();
    this.execGit = options.execGit ?? ((args) => exec('git', args));
    this.logger = options.logger ?? noopLogger;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async ensure(
    _identifier: string,
    branch?: string,
    baseRefOverride?: string,
  ): Promise<EnsuredWorkspace> {
    if (branch === undefined) {
      throw new Error('orca workspace requires a branch name');
    }
    validateBranch(branch);
    const extra = this.options.autoSetupMerge
      ? {}
      : { env: await runBranchGit(this.root, this.logger) };
    await assertOrcaReachable(this.execOrca);
    await registerRepo(this.execOrca, this.root);

    const path = resolve(
      this.root,
      this.options.worktreeDir ?? '.bakers-worktrees',
      branch,
    );
    const created = !(await this.isRegisteredWorktree(path));
    if (created) {
      await this.addWorktree(branch, path, baseRefOverride);
    }
    await waitForAdoption(
      this.execOrca,
      path,
      this.options.adoptTimeoutMs ?? DEFAULT_ADOPT_TIMEOUT_MS,
      this.sleep,
    );
    return { path, instructions: loadInstructions(path), created, ...extra };
  }

  private async isRegisteredWorktree(path: string): Promise<boolean> {
    const output = await this.execGit([
      '-C',
      this.root,
      'worktree',
      'list',
      '--porcelain',
    ]);
    return (
      porcelainEntries(output).some((e) => e.path === path) && existsSync(path)
    );
  }

  private async refExists(ref: string): Promise<boolean> {
    try {
      await this.execGit([
        '-C',
        this.root,
        'rev-parse',
        '--verify',
        '--quiet',
        `${ref}^{commit}`,
      ]);
      return true;
    } catch {
      return false;
    }
  }

  /** Check out the ticket branch as it is — never reset (`-B`) or renamed. */
  private async addWorktree(
    branch: string,
    path: string,
    baseRefOverride?: string,
  ): Promise<void> {
    const add = ['-C', this.root, 'worktree', 'add'];
    if (await this.refExists(`refs/heads/${branch}`)) {
      await this.execGit([...add, path, branch]);
      return;
    }
    try {
      await this.execGit(['-C', this.root, 'fetch', 'origin', branch]);
    } catch {
      // Non-fatal: the branch is simply not on origin (yet).
    }
    if (await this.refExists(`refs/remotes/origin/${branch}`)) {
      await this.execGit([
        ...add,
        ...(this.options.autoSetupMerge ? ['--track'] : []),
        '-b',
        branch,
        path,
        `origin/${branch}`,
      ]);
      return;
    }
    const base = await resolveBaseRef(this.root, this.execGit, {
      ...(this.options.baseBranch
        ? { baseBranch: this.options.baseBranch }
        : {}),
      ...(baseRefOverride !== undefined ? { override: baseRefOverride } : {}),
    });
    await this.execGit([...add, '-b', branch, path, ...(base ? [base] : [])]);
  }

  /**
   * Tear down the ticket worktree: through Orca when it knows the worktree
   * (`orca worktree rm`), otherwise with git alone ({@link removeGitWorktree}),
   * which also refuses the main checkout.
   */
  async remove(
    branch: string,
    worktreePath?: string,
  ): Promise<WorktreeTeardown> {
    const path = worktreePath
      ? normPath(worktreePath)
      : await this.pathOfBranch(branch);
    if (path && path !== this.root && (await this.orcaKnows(path))) {
      // Drupal hardens web/sites/default (0555): restore owner-write first.
      restoreWritable(path);
      await this.execOrca([
        'worktree',
        'rm',
        '--worktree',
        `path:${path}`,
        '--force',
      ]);
      try {
        await this.execGit(['-C', this.root, 'worktree', 'prune']);
      } catch {
        // best-effort sweep
      }
      return existsSync(path) ? 'unverified' : 'removed';
    }
    return removeGitWorktree(
      this.root,
      branch,
      worktreePath,
      (args, cwd) => this.execGit(['-C', cwd, ...args]),
      this.logger,
    );
  }

  private async orcaKnows(path: string): Promise<boolean> {
    try {
      await assertOrcaReachable(this.execOrca);
      await this.execOrca(['worktree', 'show', '--worktree', `path:${path}`]);
      return true;
    } catch {
      // Orca is down or never adopted it: tear down with git alone.
      return false;
    }
  }

  private async pathOfBranch(branch: string): Promise<string | undefined> {
    try {
      return porcelainEntries(
        await this.execGit([
          '-C',
          this.root,
          'worktree',
          'list',
          '--porcelain',
        ]),
      )
        .slice(1)
        .find((e) => e.branch === branch)?.path;
    } catch {
      return undefined;
    }
  }
}

export function orcaWorkspace(
  opts: {
    /** Explicit repo-root override; otherwise derived from the git common dir. */
    root?: string;
    worktree_dir?: string;
    base_branch?: string;
    adopt_timeout_ms?: number;
    auto_setup_merge?: boolean;
    /** Overrideable git exec for root derivation (tests). */
    execGit?: RootGitExec;
  } = {},
): WorkspacePlugin {
  rejectRenamed(opts);
  return {
    kind: 'worktree',
    id: 'orca',
    requiredModules: [],
    async createWorkspace(config: ConductorFileConfig, deps?: ExecutorDeps) {
      const root = await deriveCheckoutRoot(config.config_path, {
        ...(opts.root !== undefined ? { override: opts.root } : {}),
        ...(opts.execGit ? { execGit: opts.execGit } : {}),
      });
      return new OrcaWorkspace({
        root,
        ...(opts.worktree_dir ? { worktreeDir: opts.worktree_dir } : {}),
        ...(opts.base_branch ? { baseBranch: opts.base_branch } : {}),
        ...(opts.adopt_timeout_ms !== undefined
          ? { adoptTimeoutMs: opts.adopt_timeout_ms }
          : {}),
        ...(opts.auto_setup_merge ? { autoSetupMerge: true } : {}),
        ...(deps?.logger ? { logger: deps.logger } : {}),
      });
    },
  };
}
