import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentFootprint,
  type AgentPlugin,
  type AgentRunIdentity,
  type BbAgent,
  type KnownOptionSpec,
  type RunEnvPolicy,
  resolveAgentCliOptions,
  resolveSecurityOptions,
  type SecurityMode,
  type SecurityOptions,
  type SecurityReport,
  validateOptionalBoolean,
  validateOptionalString,
} from '@bakers-build/conductor/contract';
import { shellQuote } from '@bakers-build/core';
import { parsePiTranscript } from './footprint.js';

export { parsePiTranscript } from './footprint.js';

/**
 * The relative `--session-dir` pin — the single source of truth shared by
 * `launchCommand` (which pins pi's transcript there at launch) and `getRunLog`
 * (which reads it back). Relative → resolves against the run's cwd, i.e. the
 * worktree (`<worktree>/.bakers/pi-sessions`). `launchCommand` gets no
 * `worktreePath`, so a relative pin is the one path both sides can agree on.
 */
export const PI_SESSION_DIR = '.bakers/pi-sessions';

/**
 * The `--session-dir` value for a given run (BB-473): scoped to the run's
 * own subdirectory when its identity is known, so `getRunLog` reads only that
 * run's own transcripts — never a foreign one left behind by a resumed
 * run/re-dispatch/reused worktree in the shared {@link PI_SESSION_DIR}. Falls
 * back to the shared dir when no run identity is given (today's behaviour).
 */
export function piSessionDir(run?: AgentRunIdentity): string {
  return run?.sessionId ? `${PI_SESSION_DIR}/${run.sessionId}` : PI_SESSION_DIR;
}

/**
 * Encode an absolute cwd the way pi names its per-cwd home-session directory
 * under `~/.pi/agent/sessions/`: only `/` is replaced with `-`, and the slug is
 * wrapped in leading + trailing `--` (a leading `/` yields the leading `--`).
 * `.` and `-` are preserved — this is NOT claude's all-non-alnum scheme.
 * Verified against pi v0.82.1: `/home/cw/projects/bakers` →
 * `--home-cw-projects-bakers--`.
 */
export function encodePiHomeSessionSlug(cwd: string): string {
  return `-${cwd.replaceAll('/', '-')}--`;
}

/**
 * `security` is `system` (default) or `custom`; `custom`'s `config` is
 * `{ extensions: string[] }`, each passed as `-e`. Pi has no OS sandbox.
 */
export interface PiAgentOptions extends SecurityOptions {
  model?: string;
  provider?: string;
  thinking?: string;
  effort?: string;
  args?: string[];
  /**
   * Trust the worktree's project-local pi files (extensions/skills/themes) for
   * the run — pi's `-a/--approve`. Opt-in (default off): pi has no
   * tool-permission gate, and the bakers worktree ships no project-local pi files
   * a run needs.
   */
  approve?: boolean;
}

const PI_RESERVED = [
  '--session-dir',
  '--approve',
  '-a',
  '--no-approve',
  '-na',
] as const;

const PI_KNOWN: readonly KnownOptionSpec[] = [
  { kind: 'model', flags: ['--model'] },
  { kind: 'effort', flags: ['--thinking'] },
];

/**
 * Newest `*.jsonl` in `dir` by mtime, or `''`. Swallows every fs error.
 * `minMtimeMs`, when given, excludes anything older — the fallback scan's
 * defence against selecting a transcript from a PRIOR run left in the shared,
 * cwd-keyed home session dir (BB-473 finding 2).
 */
async function newestJsonl(dir: string, minMtimeMs?: number): Promise<string> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return '';
  }
  let latest: { path: string; mtimeMs: number } | null = null;
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) {
      continue;
    }
    const full = join(dir, name);
    try {
      const s = await stat(full);
      if (
        minMtimeMs !== undefined &&
        Number.isFinite(minMtimeMs) &&
        s.mtimeMs < minMtimeMs
      ) {
        continue;
      }
      if (!latest || s.mtimeMs > latest.mtimeMs) {
        latest = { path: full, mtimeMs: s.mtimeMs };
      }
    } catch {
      // entry vanished between readdir and stat — skip.
    }
  }
  if (!latest) {
    return '';
  }
  try {
    return await readFile(latest.path, 'utf8');
  } catch {
    return '';
  }
}

const NO_SANDBOX_DEFAULTS = {
  trusted_commands: [],
  deny_read: [],
  allow_write: [],
  network: [],
  mcp_servers: {},
};

/**
 * Pi has no OS sandbox and no permission gate, so only `system` (the default)
 * and `custom` exist; `custom` loads the operator's own extensions, e.g. one
 * that sandboxes Pi's tools.
 */
function piSecurity(options: PiAgentOptions): {
  extensions: string[] | undefined;
  runEnvPolicy: RunEnvPolicy;
  report: SecurityReport;
} {
  const { mode, config, runEnvPolicy, report } = resolveSecurityOptions(
    {
      ...options,
      security: (validateOptionalString(options.security, 'security') ??
        'system') as SecurityMode,
    },
    NO_SANDBOX_DEFAULTS,
  );
  if (mode === 'system') return { extensions: undefined, runEnvPolicy, report };
  if (mode !== 'custom') {
    throw new Error(
      `Pi does not support security: '${mode}'; use 'system' or 'custom'`,
    );
  }
  const keys = Object.keys(config ?? {});
  const extensions = config?.extensions;
  if (
    keys.some((key) => key !== 'extensions') ||
    !Array.isArray(extensions) ||
    extensions.length === 0 ||
    extensions.some(
      (e) => typeof e !== 'string' || e === '' || e.includes('\0'),
    )
  ) {
    throw new Error(
      "Pi security: 'custom' needs config: { extensions: ['<path or builtin:name>', ...] } and nothing else",
    );
  }
  return { extensions: [...extensions], runEnvPolicy, report };
}

export class PiAgent implements BbAgent {
  readonly id = 'pi';
  readonly runEnvPolicy: RunEnvPolicy;
  readonly security: SecurityReport;
  private readonly args: string[];
  private readonly model: string | undefined;
  private readonly provider: string | undefined;
  private readonly thinking: string | undefined;
  private readonly approve: boolean;
  /** `custom` mode's extensions; `undefined` in `system` mode. */
  private readonly extensions: string[] | undefined;
  private readonly overrides: { model: boolean; effort: boolean };

  constructor(
    options: PiAgentOptions = {},
    private readonly home: string = homedir(),
  ) {
    ({
      extensions: this.extensions,
      runEnvPolicy: this.runEnvPolicy,
      report: this.security,
    } = piSecurity(options));
    const cli = resolveAgentCliOptions(options, PI_RESERVED, PI_KNOWN);
    this.args = cli.args;
    this.model = cli.model;
    this.provider = validateOptionalString(options.provider, 'provider');
    this.thinking =
      cli.effort ?? validateOptionalString(options.thinking, 'thinking');
    this.approve = validateOptionalBoolean(options.approve, 'approve') === true;
    this.overrides = cli.overrides;
  }

  launchCommand(prompt: string, run?: AgentRunIdentity): string {
    if (prompt === '') {
      return ['pi', ...this.extensionFlags()].join(' ');
    }
    // Positional prompt → an attachable interactive TUI (no `-p`/`--print`,
    // which would leave the herdr pane without a session to attach to). Order:
    // provider/model/thinking, then the transcript-pinning --session-dir, then
    // the opt-in --approve.
    const parts = ['pi', shellQuote(prompt)];
    if (this.provider) {
      parts.push('--provider', shellQuote(this.provider));
    }
    if (this.model !== undefined && !this.overrides.model) {
      parts.push('--model', shellQuote(this.model));
    }
    if (this.thinking !== undefined && !this.overrides.effort) {
      parts.push('--thinking', shellQuote(this.thinking));
    }
    // Scoped to this run's own subdirectory (BB-473) when a run identity is
    // given, so getRunLog needs no ambiguity-prone scan of the shared
    // session dir a resumed/re-dispatched/reused worktree could have left
    // other transcripts in.
    parts.push('--session-dir', piSessionDir(run));
    if (this.approve) {
      parts.push('--approve');
    }
    parts.push(...this.extensionFlags());
    parts.push(...this.args.map(shellQuote));
    return parts.join(' ');
  }

  /** `custom` only: just the configured extensions load (explicit -e survives --no-extensions). */
  private extensionFlags(): string[] {
    if (this.extensions === undefined) return [];
    return [
      '--no-extensions',
      ...this.extensions.flatMap((extension) => ['-e', shellQuote(extension)]),
    ];
  }

  async getRunLog(
    worktreePath: string,
    run?: AgentRunIdentity,
  ): Promise<string> {
    // Primary: the relative --session-dir pinned at launch (per-run scoped
    // when `run` is given), joined onto the worktree — the deterministic
    // location launchCommand wrote to.
    const primary = await newestJsonl(join(worktreePath, piSessionDir(run)));
    if (primary !== '') {
      return primary;
    }
    // Fallback: pi's home session dir for the worktree cwd — covers a run
    // launched without the pin (a human who ran bare `pi`, or a pre-addon
    // run). BB-473 finding 2: that dir is shared/cwd-keyed like the other
    // addons' scans, so it is bounded by `run.startedAt` where known — a
    // transcript from a PRIOR run left in the same worktree can never be
    // selected for this one even when it is the newest match.
    const startedAtMs =
      run?.startedAt !== undefined ? new Date(run.startedAt).getTime() : null;
    return newestJsonl(
      join(
        this.home,
        '.pi',
        'agent',
        'sessions',
        encodePiHomeSessionSlug(worktreePath),
      ),
      startedAtMs !== null && Number.isFinite(startedAtMs)
        ? startedAtMs
        : undefined,
    );
  }

  parseFootprint(log: string): AgentFootprint {
    return parsePiTranscript(log);
  }
}

/** Config-facing factory: `piAgent({ model: 'kimi-coding/k3' })`. */
export function piAgent(options: PiAgentOptions = {}): AgentPlugin {
  const agent = new PiAgent(options);
  return {
    kind: 'agent',
    id: 'pi',
    requiredModules: [],
    security: agent.security,
    async createAgent() {
      return agent;
    },
  };
}

// Default export: this module also exports the `PiAgent` class, so the config
// resolver's auto-pick (no `export:`) would see multiple function exports and
// throw "specify export". The default export makes the factory win.
export default piAgent;
