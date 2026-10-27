import { existsSync, rmSync } from 'node:fs';
import {
  type LaunchScript,
  renderTemplate,
  restoreWritable,
  watchLaunch,
  writeLaunchScript,
} from '@bakers-build/addon-herdr/shared';
import type {
  BbExecutor,
  ExecutorCapabilities,
  ExecutorPlugin,
  HookContext,
  HookName,
  HookResult,
  SpawnedSession,
  SpawnRunInput,
  WorktreeTeardown,
} from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import {
  deriveCheckoutRoot,
  exec,
  shellQuote,
  slugify,
} from '@bakers-build/core';
import { type OrcaExecutorOptions, resolveTabLabel } from './config.js';
import {
  assertOrcaReachable,
  createOrcaExec,
  isRecord,
  type OrcaExec,
} from './orca-cli.js';
import {
  DEFAULT_ADOPT_TIMEOUT_MS,
  defaultSleep,
  type GitExec,
  noopLogger,
  porcelainEntries,
  type Sleep,
  waitForAdoption,
} from './workspace.js';

export type { OrcaExecutorOptions } from './config.js';
export { OrcaError, type OrcaExec } from './orca-cli.js';
export {
  type OrcaOpenLayout,
  OrcaWorkspace,
  type OrcaWorkspaceOptions,
  orcaWorkspace,
} from './workspace.js';

/** Runs a lifecycle-hook shell command in a cwd; rejects on non-zero exit. */
export type ShellRunner = (
  command: string,
  cwd: string,
  env?: Record<string, string>,
) => Promise<void>;

const defaultShellRunner: ShellRunner = async (command, cwd, env) => {
  await exec('sh', ['-c', command], { cwd, ...(env ? { env } : {}) });
};

/** Exact trailing `#<runId>` token, so `#7` never matches `#77`. */
function titleMatchesRun(title: unknown, runId: number): boolean {
  if (typeof title !== 'string') return false;
  const m = title.match(/#(\d+)$/);
  return m !== null && Number(m[1]) === runId;
}

/** Tab id → tab title from `terminal list --include-visual-layouts`. */
function visualTabTitles(layouts: unknown): Map<string, unknown> {
  const titles = new Map<string, unknown>();
  const walk = (node: unknown): void => {
    if (!isRecord(node)) return;
    if (Array.isArray(node.tabs)) {
      for (const tab of node.tabs) {
        if (isRecord(tab) && typeof tab.tabId === 'string') {
          titles.set(tab.tabId, tab.title);
        }
      }
    }
    walk(node.first);
    walk(node.second);
  };
  if (Array.isArray(layouts)) {
    for (const layout of layouts) {
      if (isRecord(layout)) walk(layout.root);
    }
  }
  return titles;
}

function normPath(path: string): string {
  return path.replace(/\/+$/, '');
}

/**
 * Executor hosting each run's agent in an Orca terminal of the ticket's
 * worktree. Terminal handles do not survive an Orca restart, so none is kept
 * beyond the call that obtained it: a run's terminal is found again by branch
 * and the `#<runId>` token in its title.
 */
export class OrcaExecutor implements BbExecutor {
  readonly id = 'orca';

  constructor(
    private readonly options: OrcaExecutorOptions,
    private readonly execOrca: OrcaExec = createOrcaExec(),
    private readonly logger: ConductorLogger = noopLogger,
    private readonly runShell: ShellRunner = defaultShellRunner,
    private readonly execGit: GitExec = (args) => exec('git', args),
    private readonly sleep: Sleep = defaultSleep,
  ) {}

  capabilities(): ExecutorCapabilities {
    return { persistent: true };
  }

  /** The single best-effort catch point for lifecycle hooks; never throws. */
  async runHook(
    name: HookName,
    cwd: string,
    ctx: HookContext,
    env?: Record<string, string>,
  ): Promise<HookResult> {
    const command = this.options.hooks?.[name];
    if (!command) {
      return { hook: name, ran: false, ok: true };
    }
    try {
      await this.runShell(command, cwd, env);
      return { hook: name, ran: true, ok: true };
    } catch (err) {
      this.logger.error(
        { hook: name, worktree: cwd, ticket: ctx.ticket, err: String(err) },
        'lifecycle hook failed',
      );
      return { hook: name, ran: true, ok: false, error: String(err) };
    }
  }

  async startRun(input: SpawnRunInput): Promise<SpawnedSession> {
    const tabLabel = resolveTabLabel(this.options, input.ticket.state);
    await assertOrcaReachable(this.execOrca);
    await waitForAdoption(
      this.execOrca,
      input.workspacePath,
      this.options.adoptTimeoutMs ?? DEFAULT_ADOPT_TIMEOUT_MS,
      this.sleep,
    );
    const title = `${renderTemplate(tabLabel, {
      identifier: input.ticket.identifier,
      title: input.ticket.title,
      titleSlug: slugify(input.ticket.title),
      runUuid: input.run.uuid,
      workspacePath: input.workspacePath,
    })} #${input.run.id}`;

    let launch: LaunchScript | undefined;
    let handle: string | undefined;
    try {
      // Orca's `terminal create` takes no env: the run's env travels inside the
      // 0600 launch script, never in argv; the terminal is typed `sh '<file>'`.
      launch = writeLaunchScript(this.commandFor(input));
      const created = await this.execOrca([
        'terminal',
        'create',
        '--worktree',
        `path:${input.workspacePath}`,
        '--title',
        title,
        '--command',
        launch.typedCommand,
      ]);
      const terminal = isRecord(created) ? created.terminal : undefined;
      handle =
        isRecord(terminal) && typeof terminal.handle === 'string'
          ? terminal.handle
          : undefined;
      if (!handle) {
        throw new Error('orca terminal create returned no terminal handle');
      }
      // A create `--title` is only a launch title the agent's OSC title replaces;
      // a rename is a manual name restarts keep (on the tab in desktop Orca, on
      // the terminal headless), so cleanupRun can still find the `#<runId>` token.
      await this.execOrca([
        'terminal',
        'rename',
        '--terminal',
        handle,
        '--title',
        title,
      ]);
      const readHandle = handle;
      await watchLaunch(launch, {
        ...(this.options.launchWatch ?? {}),
        readPane: () => this.readTail(readHandle),
      });
      return { sessionRef: input.ticket.branchName };
    } catch (err) {
      if (launch) {
        rmSync(launch.dir, { recursive: true, force: true });
      }
      if (handle) {
        await this.closeTerminal(handle);
      }
      throw err;
    }
  }

  private async readTail(handle: string): Promise<string> {
    const read = await this.execOrca([
      'terminal',
      'read',
      '--terminal',
      handle,
    ]);
    const tail =
      isRecord(read) && isRecord(read.terminal)
        ? read.terminal.tail
        : undefined;
    return Array.isArray(tail) ? tail.join('\n') : '';
  }

  /** Best-effort: a live or unverifiable stop must not abort the caller. */
  private async closeTerminal(handle: string): Promise<void> {
    try {
      await this.execOrca(['terminal', 'close', '--terminal', handle]);
    } catch (err) {
      this.logger.warn(
        { terminal: handle, err: String(err) },
        'orca terminal close failed (best-effort, ignored)',
      );
    }
  }

  /**
   * No-op, as for herdr: the transcript is captured after this call, and
   * {@link cleanupRun} closing the terminal is what ends the agent.
   */
  async stopRun(_branch: string): Promise<void> {}

  /** Close every terminal of this run on this branch; best-effort throughout. */
  async cleanupRun(branch: string, runId: number): Promise<void> {
    let listed: unknown;
    try {
      // Orca returns 200 rows unless told otherwise; a cut-off run terminal would leak.
      listed = await this.execOrca([
        'terminal',
        'list',
        '--include-visual-layouts',
        '--limit',
        '10000',
      ]);
    } catch (err) {
      this.logger.warn(
        { branch, runId, err: String(err) },
        'orca terminal list failed (best-effort, ignored)',
      );
      return;
    }
    const terminals =
      isRecord(listed) && Array.isArray(listed.terminals)
        ? listed.terminals
        : [];
    // Desktop Orca keeps the rename on the tab while the terminal reports the
    // agent's own title; headless Orca keeps it on the terminal.
    const tabTitles = visualTabTitles(
      isRecord(listed) ? listed.visualLayouts : undefined,
    );
    let matched = false;
    for (const t of terminals) {
      if (
        isRecord(t) &&
        typeof t.handle === 'string' &&
        typeof t.branch === 'string' &&
        t.branch.replace(/^refs\/heads\//, '') === branch &&
        (titleMatchesRun(t.title, runId) ||
          (typeof t.tabId === 'string' &&
            titleMatchesRun(tabTitles.get(t.tabId), runId)))
      ) {
        matched = true;
        await this.closeTerminal(t.handle);
      }
    }
    // A missed match would otherwise leak a running agent without a trace.
    if (!matched) {
      this.logger.warn(
        { branch, runId },
        'no orca terminal found for this run; its agent may still be running',
      );
    }
  }

  async removeWorktree(
    branch: string,
    worktreePath?: string,
  ): Promise<WorktreeTeardown> {
    const root = this.options.root;
    if (root && worktreePath && normPath(worktreePath) === normPath(root)) {
      this.logger.warn(
        { branch, worktreePath, root },
        'refusing to tear down the main checkout',
      );
      return 'unverified';
    }
    const gitDir = root ?? worktreePath;
    let entries: { path: string; branch: string | null }[] = [];
    if (gitDir) {
      try {
        // Record 0 is the main checkout — never a ticket worktree.
        entries = porcelainEntries(
          await this.execGit(['-C', gitDir, 'worktree', 'list', '--porcelain']),
        ).slice(1);
      } catch {
        // Degrade to the on-disk answer below.
      }
    }
    const path = worktreePath
      ? normPath(worktreePath)
      : entries.find((e) => e.branch === branch)?.path;
    if (!path) {
      return 'unverified';
    }
    const registered = entries.some((e) => normPath(e.path) === path);

    let orcaKnows = false;
    try {
      await assertOrcaReachable(this.execOrca);
      await this.execOrca(['worktree', 'show', '--worktree', `path:${path}`]);
      orcaKnows = true;
    } catch {
      // Orca is down or never adopted it: tear down with git alone.
    }
    // Drupal hardens web/sites/default (0555): restore owner-write first.
    restoreWritable(path);
    if (orcaKnows) {
      await this.execOrca([
        'worktree',
        'rm',
        '--worktree',
        `path:${path}`,
        '--force',
      ]);
    } else {
      if (!registered && !existsSync(path)) {
        return 'already_absent';
      }
      if (registered) {
        try {
          await this.execGit([
            '-C',
            gitDir as string,
            'worktree',
            'remove',
            '--force',
            path,
          ]);
        } catch (err) {
          this.logger.warn(
            { path, err: String(err) },
            'git worktree remove failed on a registered worktree',
          );
        }
      }
      try {
        rmSync(path, { recursive: true, force: true });
      } catch (err) {
        this.logger.warn(
          { path, err: String(err) },
          'worktree directory reclaim failed',
        );
      }
    }
    if (gitDir) {
      try {
        await this.execGit(['-C', gitDir, 'worktree', 'prune']);
      } catch {
        // best-effort sweep
      }
    }
    return existsSync(path) ? 'unverified' : 'removed';
  }

  private commandFor(input: SpawnRunInput): string {
    const env = Object.entries(input.env ?? {}).map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`invalid environment variable name for orca: ${key}`);
      }
      return `${key}=${shellQuote(value)}`;
    });
    const command = input.command ?? this.options.command ?? 'claude';
    return [...env, command].join(' ');
  }
}

export function orcaExecutor(
  options: OrcaExecutorOptions = {},
): ExecutorPlugin {
  return {
    kind: 'executor',
    id: 'orca',
    requiredModules: [],
    async createExecutor(config, deps) {
      const root = await deriveCheckoutRoot(config.config_path, {
        ...(options.root !== undefined ? { override: options.root } : {}),
        ...(options.execGit ? { execGit: options.execGit } : {}),
      });
      return new OrcaExecutor(
        {
          ...options,
          command: options.command ?? 'claude',
          root,
          ...(config.hooks ? { hooks: config.hooks } : {}),
        },
        createOrcaExec(),
        deps.logger,
      );
    },
  };
}

// The class is exported too, so the default export is what lets the config
// resolver pick the factory without an `export:` key.
export default orcaExecutor;
