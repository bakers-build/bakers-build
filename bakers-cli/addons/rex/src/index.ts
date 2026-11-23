import { rmSync } from 'node:fs';
import {
  type LaunchScript,
  type LaunchWatchOptions,
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

/** Runs `rex <args>`; resolves with stdout, rejects on a non-zero exit. */
export type RexExec = (args: string[]) => Promise<string>;

export interface RexExecutorOptions {
  /** Fallback agent command when the conductor supplies none. Default `claude`. */
  command?: string;
  /** As for herdr: `start_timeout_ms` (default 60 s), then `timeout_ms` (4 s). */
  launch_watch?: Omit<LaunchWatchOptions, 'readPane'>;
}

/** The oldest `rex` whose `new --cwd --shell none --json` this addon uses. */
export const MIN_REX_VERSION = '0.1.0';

/** `rex` is not on PATH. */
export class RexNotFound extends Error {
  constructor() {
    super(
      `rex not found on PATH: install Rex ${MIN_REX_VERSION} or later (https://www.superlogical.com/rex/)`,
    );
    this.name = 'RexNotFound';
  }
}

/** `rex` exit 4: no server answers. */
export class RexServerUnreachable extends Error {
  constructor() {
    super('Rex server unreachable: start it with `rex server install`');
    this.name = 'RexServerUnreachable';
  }
}

/**
 * The real CLI, resolved through PATH. `--autostart=false`: a server the
 * conductor spawned would take the run's sessions down with it.
 */
export const defaultRex: RexExec = async (args) => {
  try {
    return await exec('rex', ['--autostart=false', ...args]);
  } catch (err) {
    const cause = (err instanceof ExecError ? err.cause : err) as {
      code?: unknown;
    };
    if (cause?.code === 'ENOENT') throw new RexNotFound();
    if (err instanceof ExecError && err.exitCode === 4) {
      throw new RexServerUnreachable();
    }
    throw err;
  }
};

const noopLogger: ConductorLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** Rejects unless `rex version` reports at least {@link MIN_REX_VERSION}. */
export async function assertRexVersion(rex: RexExec): Promise<void> {
  const out = await rex(['version']);
  // A snapshot (`0.1.0-snapshot.2531`) counts as its release.
  const found = out.match(/(\d+)\.(\d+)\.(\d+)/)?.[0];
  if (!found) {
    throw new Error(`rex version printed no version: ${out.trim()}`);
  }
  const have = found.split('.').map(Number);
  const need = MIN_REX_VERSION.split('.').map(Number);
  for (let i = 0; i < need.length; i++) {
    if ((have[i] ?? 0) > (need[i] ?? 0)) return;
    if ((have[i] ?? 0) < (need[i] ?? 0)) {
      throw new Error(
        `rex ${found} is too old: upgrade Rex to ${MIN_REX_VERSION} or later`,
      );
    }
  }
}

/**
 * The run's session label, `<identifier>-<runId> <branch>`. Rex labels are
 * free text and may repeat, so the executor only ever acts on session ids.
 */
export function sessionLabel(
  identifier: string,
  runId: number,
  branch: string,
): string {
  return `${identifier}-${runId} ${branch}`;
}

/** `rex ls --json` prints `{sessions: [{session_id, label}]}`. */
function parseSessions(output: string): { id: string; label: string }[] {
  const list = (JSON.parse(output) as { sessions?: unknown } | null)?.sessions;
  if (!Array.isArray(list)) return [];
  return list.flatMap((s) => {
    const r = s as { session_id?: unknown; label?: unknown } | null;
    return typeof r?.session_id === 'string' && typeof r.label === 'string'
      ? [{ id: r.session_id, label: r.label }]
      : [];
  });
}

/**
 * Executor hosting each run's agent in its own Rex session. The session lives
 * in the Rex server, so it survives any client detaching. Rex has no
 * workspace notion: the worktree comes from the workspace slot.
 */
export class RexExecutor implements BbExecutor {
  readonly id = 'rex';

  constructor(
    private readonly options: RexExecutorOptions,
    private readonly rex: RexExec = defaultRex,
    private readonly logger: ConductorLogger = noopLogger,
  ) {}

  capabilities(): ExecutorCapabilities {
    return { persistent: true };
  }

  async startRun(input: SpawnRunInput): Promise<SpawnedSession> {
    await assertRexVersion(this.rex);
    let launch: LaunchScript | undefined;
    let session: string | undefined;
    try {
      // Rex has no env flag; the run's env travels inside the 0600 launch script.
      launch = writeLaunchScript(this.commandFor(input));
      const created = JSON.parse(
        await this.rex([
          'new',
          sessionLabel(
            input.ticket.identifier,
            input.run.id,
            input.ticket.branchName,
          ),
          '--cwd',
          input.workspacePath,
          '--shell',
          'none',
          '--json',
          '--',
          'sh',
          launch.wrapPath,
        ]),
      ) as { session_id?: unknown };
      if (typeof created.session_id !== 'string') {
        throw new Error('rex new printed no session_id');
      }
      session = created.session_id;
      const id = session;
      await watchLaunch(launch, {
        ...(this.options.launch_watch ?? {}),
        readPane: () => this.rex(['capture', '-s', id, '--trim']),
      });
      return { sessionRef: id };
    } catch (err) {
      if (launch) rmSync(launch.dir, { recursive: true, force: true });
      if (session) await this.kill(session).catch(() => {});
      throw err;
    }
  }

  /** No-op: `cleanupRun` ends the program; the transcript is already on disk. */
  async stopRun(_branch: string): Promise<void> {}

  /**
   * Kill the sessions of ONE run, found by the label suffix `-<runId> <branch>`;
   * a sibling run's session is left alone. Best-effort: a failure is logged,
   * never thrown, and a missing match is warned about, since it may leave an
   * agent running.
   */
  async cleanupRun(branch: string, runId: number): Promise<void> {
    try {
      const suffix = `-${runId} ${branch}`;
      const sessions = parseSessions(await this.rex(['ls', '--json'])).filter(
        (s) => s.label.endsWith(suffix),
      );
      if (sessions.length === 0) {
        this.logger.warn(
          { branch, runId },
          'no Rex session found for this run; its agent may still be running',
        );
        return;
      }
      for (const s of sessions) await this.kill(s.id);
    } catch (err) {
      this.logger.warn(
        { branch, runId, err: String(err) },
        'Rex cleanup failed (best-effort)',
      );
    }
  }

  /** `rex session kill`; exit 3 means the session is already gone. */
  private async kill(session: string): Promise<void> {
    try {
      await this.rex(['session', 'kill', session]);
    } catch (err) {
      if (!(err instanceof ExecError && err.exitCode === 3)) throw err;
    }
  }

  private commandFor(input: SpawnRunInput): string {
    const env = Object.entries(input.env ?? {}).map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`invalid environment variable name for rex: ${key}`);
      }
      return `${key}=${shellQuote(value)}`;
    });
    const command = input.command ?? this.options.command ?? 'claude';
    return [...env, command].join(' ');
  }
}

export function rexExecutor(options: RexExecutorOptions = {}): ExecutorPlugin {
  return {
    kind: 'executor',
    id: 'rex',
    requiredModules: [],
    async createExecutor(_config, deps) {
      return new RexExecutor(
        { ...options, command: options.command ?? 'claude' },
        defaultRex,
        deps.logger,
      );
    },
  };
}

// The default export lets the config resolver pick the factory without an `export:` key.
export default rexExecutor;
