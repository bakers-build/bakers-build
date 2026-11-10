import { rmSync } from 'node:fs';
import {
  type LaunchScript,
  type LaunchWatchOptions,
  watchAuth,
  watchLaunch,
  writeLaunchScript,
} from '@bakers-build/addon-herdr/shared';
import type {
  BbExecutor,
  ExecutorCapabilities,
  ExecutorPlugin,
  SpawnedSession,
  SpawnRunInput,
} from '@bakers-build/conductor/contract';
import {
  type ConductorLogger,
  ExecError,
  exec,
  shellQuote,
} from '@bakers-build/core';

/** Runs `hc <args>`; resolves with stdout, rejects on a non-zero exit. */
export type HcExec = (args: string[]) => Promise<string>;

export interface HerdrCoreExecutorOptions {
  /** Fallback agent command when the conductor supplies none. Default `claude`. */
  command?: string;
  /** As for herdr: `start_timeout_ms` (default 60 s), then `timeout_ms` (4 s). */
  launch_watch?: Omit<LaunchWatchOptions, 'readPane'>;
}

/** The oldest `hc` whose `run --bg --no-parent --outlive-parent` this addon uses. */
export const MIN_HC_VERSION = '0.1.18';

/** `hc` is not on PATH. */
export class HcNotFound extends Error {
  constructor() {
    super(
      `hc not found on PATH: install herdr-core ${MIN_HC_VERSION} or later (https://herdr.dev/core/)`,
    );
    this.name = 'HcNotFound';
  }
}

/** The real CLI, resolved through PATH. */
export const defaultHc: HcExec = async (args) => {
  try {
    return await exec('hc', args);
  } catch (err) {
    const cause = (err instanceof ExecError ? err.cause : err) as {
      code?: unknown;
    };
    if (cause?.code === 'ENOENT') throw new HcNotFound();
    throw err;
  }
};

const noopLogger: ConductorLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function versionParts(version: string): number[] {
  return version.split('.').map(Number);
}

/** Rejects unless `hc --version` reports at least {@link MIN_HC_VERSION}. */
export async function assertHcVersion(hc: HcExec): Promise<void> {
  const out = await hc(['--version']);
  const found = out.match(/(\d+)\.(\d+)\.(\d+)/)?.[0];
  if (!found) {
    throw new Error(`hc --version printed no version: ${out.trim()}`);
  }
  const have = versionParts(found);
  const need = versionParts(MIN_HC_VERSION);
  for (let i = 0; i < need.length; i++) {
    if ((have[i] ?? 0) > (need[i] ?? 0)) return;
    if ((have[i] ?? 0) < (need[i] ?? 0)) {
      throw new Error(
        `hc ${found} is too old: upgrade herdr-core to ${MIN_HC_VERSION} or later (hc update)`,
      );
    }
  }
}

/**
 * The run's terminal name, `<identifier>-<runId>`: hc allows 1-32 of
 * `a-z0-9-_`, unique among live terminals. The run id suffix is never cut.
 */
export function terminalName(identifier: string, runId: number): string {
  const suffix = `-${runId}`;
  const key = identifier.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  return `${key.slice(0, Math.max(1, 32 - suffix.length))}${suffix}`;
}

/** A terminal of `hc ls --json`. */
interface HcTerminal {
  id: string;
  live: boolean;
}

/**
 * `hc ls --json` prints `{hidden_finished, terminals: [{address, name, state}]}`
 * (hc 0.1.18); `address` (`t4`) is unique even among finished terminals.
 */
function parseTerminals(output: string): HcTerminal[] {
  const list = (JSON.parse(output) as { terminals?: unknown } | null)
    ?.terminals;
  if (!Array.isArray(list)) return [];
  return list.flatMap((t) => {
    const r = t as { address?: unknown; state?: unknown } | null;
    return typeof r?.address === 'string' && r.address
      ? [{ id: r.address, live: r.state !== 'finished' }]
      : [];
  });
}

/**
 * Executor hosting each run's agent in a herdr-core terminal (`hc`). The
 * terminal lives in the herdr-core server, so it survives the Herdr app quitting
 * or crashing. It is found again by its `bakers.branch` and `bakers.run` labels.
 * herdr-core has no workspace notion: the worktree comes from the workspace
 * slot, and there is no `openWorkspace`.
 */
export class HerdrCoreExecutor implements BbExecutor {
  readonly id = 'herdr-core';

  constructor(
    private readonly options: HerdrCoreExecutorOptions,
    private readonly hc: HcExec = defaultHc,
    private readonly logger: ConductorLogger = noopLogger,
  ) {}

  capabilities(): ExecutorCapabilities {
    return { persistent: true };
  }

  async startRun(input: SpawnRunInput): Promise<SpawnedSession> {
    await assertHcVersion(this.hc);
    const name = terminalName(input.ticket.identifier, input.run.id);
    let launch: LaunchScript | undefined;
    let started = false;
    try {
      // The run's env travels inside the 0600 launch script, never in argv.
      launch = writeLaunchScript(this.commandFor(input));
      await this.hc([
        'run',
        '--bg',
        '--no-parent',
        '--outlive-parent',
        '--cwd',
        input.workspacePath,
        '--name',
        name,
        '--label',
        `bakers.branch=${input.ticket.branchName}`,
        '--label',
        `bakers.run=${input.run.id}`,
        '--label',
        `bakers.ticket=${input.ticket.identifier}`,
        '--json',
        'sh',
        launch.wrapPath,
      ]);
      started = true;
      const readPane = () => this.hc(['read', name, '--lines', '40']);
      await watchLaunch(launch, {
        ...(this.options.launch_watch ?? {}),
        readPane,
      });
      return input.authFailurePatterns?.length
        ? {
            sessionRef: name,
            authFailure: watchAuth(
              readPane,
              input.authFailurePatterns,
              input.claimedAt ? { since: input.claimedAt } : {},
            ),
          }
        : { sessionRef: name };
    } catch (err) {
      if (launch) rmSync(launch.dir, { recursive: true, force: true });
      if (started) await this.drop(name, true);
      throw err;
    }
  }

  /** No-op: `cleanupRun` ends the program; the transcript is already on disk. */
  async stopRun(_branch: string): Promise<void> {}

  /**
   * End and remove the terminals of ONE run, found by its branch and run
   * labels; a sibling run's terminal is left alone. Best-effort: a failure is
   * logged, never thrown, and a missing match is warned about, since it may
   * leave an agent running.
   */
  async cleanupRun(branch: string, runId: number): Promise<void> {
    try {
      const terminals = parseTerminals(
        await this.hc([
          'ls',
          '--all',
          '--label',
          `bakers.branch=${branch}`,
          '--label',
          `bakers.run=${runId}`,
          '--json',
        ]),
      );
      if (terminals.length === 0) {
        this.logger.warn(
          { branch, runId },
          'no herdr-core terminal found for this run; its agent may still be running',
        );
        return;
      }
      for (const t of terminals) await this.drop(t.id, t.live);
    } catch (err) {
      this.logger.warn(
        { branch, runId, err: String(err) },
        'herdr-core cleanup failed (best-effort)',
      );
    }
  }

  /** `hc kill` (when live) then `hc rm`; each step best-effort. */
  private async drop(terminal: string, live: boolean): Promise<void> {
    if (live) {
      await this.hc(['kill', terminal, '--json']).catch(() => {});
    }
    await this.hc(['rm', terminal, '--json']).catch(() => {});
  }

  private commandFor(input: SpawnRunInput): string {
    const env = Object.entries(input.env ?? {}).map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(
          `invalid environment variable name for herdr-core: ${key}`,
        );
      }
      return `${key}=${shellQuote(value)}`;
    });
    const command = input.command ?? this.options.command ?? 'claude';
    return [...env, command].join(' ');
  }
}

export function herdrCoreExecutor(
  options: HerdrCoreExecutorOptions = {},
): ExecutorPlugin {
  return {
    kind: 'executor',
    id: 'herdr-core',
    requiredModules: [],
    async createExecutor(_config, deps) {
      return new HerdrCoreExecutor(
        { ...options, command: options.command ?? 'claude' },
        defaultHc,
        deps.logger,
      );
    },
  };
}

// The class is exported too, so the default export is what lets the config
// resolver pick the factory without an `export:` key.
export default herdrCoreExecutor;
