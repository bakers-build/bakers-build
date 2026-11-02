import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentFootprint,
  type AgentPlugin,
  type AgentRunIdentity,
  type BbAgent,
  type KnownOptionSpec,
  type ResolvedSecurity,
  type RunEnvPolicy,
  resolveAgentCliOptions,
  resolveSecurityOptions,
  type SandboxHost,
  type SandboxOptions,
  type SandboxPreflight,
  type SecurityOptions,
  systemSandboxHost,
  validateOptionalString,
} from '@bakers-build/conductor/contract';
import { shellQuote } from '@bakers-build/core';
import { parseGrokTranscript } from './footprint.js';

export { parseGrokTranscript } from './footprint.js';

export type GrokReasoningEffort = 'high' | 'medium' | 'low';

export interface GrokAgentOptions extends SecurityOptions {
  model?: string;
  reasoningEffort?: GrokReasoningEffort | string;
  effort?: string;
  args?: string[];
}

const GROK_RESERVED = ['--permission-mode', '--session-id', '-s'] as const;

/** Flags sandbox mode owns on top of `GROK_RESERVED` (`docs/addons/grok.md`). */
const GROK_SANDBOX_RESERVED = [
  ...GROK_RESERVED,
  '--sandbox',
  '--always-approve',
  '--allow',
  '--allowedTools',
  '--allowed-tools',
  '--add-dir',
  // the workspace profile makes the cwd writable; agent definitions may carry their own permissions
  '--cwd',
  '-w',
  '--worktree',
  '--agents',
  '--agent',
] as const;

/**
 * Grok splits short-flag clusters (`-cw` is `-c -w`), which the shared matcher
 * only checks at the token's start. Only `-m`/`-p` end the scan: their value
 * follows. Fail-closed: an optional-value flag such as `-r` does not end it.
 */
function rejectClusteredReserved(
  args: readonly string[],
  reserved: readonly string[],
): void {
  const letters = reserved.filter((f) => /^-[^-]$/.test(f)).map((f) => f[1]);
  for (const token of args) {
    if (!/^-[^-]/.test(token)) continue;
    for (const letter of token.slice(1)) {
      if (letters.includes(letter)) {
        throw new Error(`args contains reserved flag -${letter}`);
      }
      if (letter === 'm' || letter === 'p') break;
    }
  }
}

/** Grok flags whose value is the next token (`grok --help`, grok 1.0.70). */
const GROK_VALUE_FLAGS = new Set([
  '--model',
  '--single',
  '--resume',
  '--debug-file',
  '--deny',
  '--disallowedTools',
  '--disallowed-tools',
  '--json-schema',
  '--leader-socket',
  '--max-turns',
  '--output-format',
  '--prompt-file',
  '--prompt-json',
  '--reasoning-effort',
  '--effort',
  '--rules',
  '--system-prompt-override',
  '--system-prompt',
  '--tools',
  '--worktree-ref',
  '--ref',
]);

/**
 * After the prompt, Grok parses a bare token as a subcommand (`wrap`, `agent`),
 * which replaces the sandboxed session. Allowlist: only a value of a known
 * value flag may be bare. A short cluster qualifies only when its last letter
 * is the first that takes a value (`-cm`): in `-pm` the `m` is `-p`'s value.
 * `-c`, `-h`, `-v` are Grok's only short flags without a value.
 */
function rejectBareArgs(args: readonly string[]): void {
  args.forEach((token, i) => {
    if (token.startsWith('-')) return;
    const prev = args[i - 1] ?? '';
    if (GROK_VALUE_FLAGS.has(prev) || /^-[chv]*[mpr]$/.test(prev)) return;
    throw new Error(
      `args contains bare token ${token}, which Grok would run as a subcommand outside the sandboxed session`,
    );
  });
}

/** Only what Grok's built-in `workspace` profile enforces. */
const SANDBOX_DEFAULTS: Required<SandboxOptions> = {
  trusted_commands: [],
  deny_read: [],
  allow_write: [],
  network: ['*'],
  mcp_servers: {},
};

/** Throws on a sandbox key Grok cannot enforce from the command line. */
function rejectUnsupportedSandbox(sandbox: Required<SandboxOptions>): void {
  if (sandbox.network.length !== 1 || sandbox.network[0] !== '*') {
    throw new Error(
      "Grok cannot restrict sandbox.network: its workspace profile allows all hosts; leave network at ['*']",
    );
  }
  if (Object.keys(sandbox.mcp_servers).length > 0) {
    throw new Error(
      'Grok cannot allow only named sandbox.mcp_servers: sandbox mode passes a deny rule for every MCP tool; leave mcp_servers empty',
    );
  }
  if (sandbox.trusted_commands.length > 0) {
    throw new Error(
      "Grok has no command exception narrowed to executable, arguments and directory for sandbox.trusted_commands; use security: 'system' with your own sandbox.toml profile",
    );
  }
  for (const key of ['deny_read', 'allow_write'] as const) {
    if (sandbox[key].length > 0) {
      throw new Error(
        `Grok needs a sandbox.toml profile for sandbox.${key}, which bakers.build does not write; use security: 'system' with args: ['--sandbox', '<profile>']`,
      );
    }
  }
}

const GROK_KNOWN: readonly KnownOptionSpec[] = [
  { kind: 'model', flags: ['--model', '-m'] },
  { kind: 'effort', flags: ['--reasoning-effort', '--effort'] },
];

export function encodeGrokSessionCwd(cwd: string): string {
  return encodeURIComponent(cwd);
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export class GrokAgent implements BbAgent {
  readonly id = 'grok';
  private readonly args: string[];
  private readonly model: string | undefined;
  private readonly effort: string | undefined;
  private readonly overrides: { model: boolean; effort: boolean };
  private readonly security: ResolvedSecurity;
  readonly runEnvPolicy: RunEnvPolicy;

  constructor(
    options: GrokAgentOptions = {},
    private readonly home: string = homedir(),
  ) {
    this.security = resolveSecurityOptions(options, SANDBOX_DEFAULTS);
    this.runEnvPolicy = this.security.runEnvPolicy;
    if (this.security.mode === 'custom') {
      throw new Error(
        "Grok has no config flags for security: 'custom'; use security: 'system' with args: ['--sandbox', '<profile>'] for your own sandbox.toml profile",
      );
    }
    rejectUnsupportedSandbox(this.security.sandbox);
    const reserved =
      this.security.mode === 'sandbox' ? GROK_SANDBOX_RESERVED : GROK_RESERVED;
    const cli = resolveAgentCliOptions(options, reserved, GROK_KNOWN);
    rejectClusteredReserved(cli.args, reserved);
    if (this.security.mode === 'sandbox') rejectBareArgs(cli.args);
    this.args = cli.args;
    this.model = cli.model;
    this.effort =
      cli.effort ??
      validateOptionalString(options.reasoningEffort, 'reasoningEffort');
    this.overrides = cli.overrides;
  }

  launchCommand(prompt: string, run?: AgentRunIdentity): string {
    const parts = ['grok'];
    if (prompt !== '') {
      // Positional — the interactive form Grok Build documents
      // (`grok "fix the bug"`). NOT `-p/--single`: that prints one answer to
      // stdout and exits, so the agent would drop the herdr tab it is
      // dispatched into instead of holding a session there.
      parts.push(shellQuote(prompt));
    }
    parts.push(...this.securityFlags());
    if (this.model !== undefined && !this.overrides.model) {
      parts.push('-m', shellQuote(this.model));
    }
    if (this.effort !== undefined && !this.overrides.effort) {
      parts.push('--reasoning-effort', shellQuote(this.effort));
    }
    // Pin the session dir name to the run's UUID (BB-473), so `getRunLog`
    // can select it directly instead of scanning every session dir under the
    // cwd for the newest match — the scan is what let a foreign transcript
    // (resumed run, re-dispatch, reused worktree) get finalised.
    if (run?.sessionId) {
      parts.push('--session-id', run.sessionId);
    }
    if (prompt !== '') {
      parts.push(...this.args.map(shellQuote));
    }
    return parts.join(' ');
  }

  /** The launch flags a security mode owns (`docs/addons/grok.md`). */
  private securityFlags(): string[] {
    if (this.security.mode === 'system') return [];
    if (this.security.mode === 'yolo') {
      return ['--permission-mode', 'bypassPermissions'];
    }
    return [
      '--sandbox',
      'workspace',
      '--permission-mode',
      'acceptEdits',
      '--allow',
      shellQuote('Bash(*)'),
      '--deny',
      shellQuote('MCPTool(*)'),
    ];
  }

  /** Grok's sandbox is Landlock on Linux and Seatbelt on macOS. */
  async sandboxPreflight(
    host: SandboxHost = systemSandboxHost(),
  ): Promise<SandboxPreflight> {
    if (this.security.mode !== 'sandbox' || host.platform === 'darwin') {
      return { ok: true };
    }
    const fallback = "set security: 'system' or 'yolo' for Grok";
    if (host.platform !== 'linux') {
      return {
        ok: false,
        cause: `Grok's sandbox does not support ${host.platform}`,
        fix: fallback,
      };
    }
    const probe = await host.run('grep', [
      '-qw',
      'landlock',
      '/sys/kernel/security/lsm',
    ]);
    return probe.ok
      ? { ok: true }
      : {
          ok: false,
          cause: 'Landlock is not active in this kernel',
          fix: `boot a kernel with landlock in its lsm= list, or ${fallback}`,
        };
  }

  /**
   * `grok --session-id <uuid>` documents "new conversation… must not already
   * exist" (BB-473 review round 2), so the conductor checks this before
   * pinning the run's own UUID — a re-dispatch of the same run would
   * otherwise mint the id its first attempt already wrote and fail to
   * launch.
   */
  async sessionExists(
    worktreePath: string,
    sessionId: string,
  ): Promise<boolean> {
    const dir = join(
      this.home,
      '.grok',
      'sessions',
      encodeGrokSessionCwd(worktreePath),
      sessionId,
    );
    return (await readJson(join(dir, 'summary.json'))) !== null;
  }

  async getRunLog(
    worktreePath: string,
    run?: AgentRunIdentity,
  ): Promise<string> {
    const root = join(
      this.home,
      '.grok',
      'sessions',
      encodeGrokSessionCwd(worktreePath),
    );
    const startedAtMs =
      run?.startedAt !== undefined ? new Date(run.startedAt).getTime() : null;
    // BB-473: when the run's own session id is known (pinned at launch via
    // `--session-id`), read that session dir directly — no directory scan,
    // so a foreign transcript can never be selected. AC-5: when the pinned
    // session dir is missing (a run dispatched before this change, or the
    // agent never wrote it), fall through to the scan below — bounded by
    // `run.startedAt` where known — instead of returning '' and turning a
    // wrong log into no log at all.
    //
    // Round 4 (review round 3, Critical 1): the pinned dir can also be
    // *stale* — a re-dispatch omits `--session-id` (see `sessionExists`)
    // because attempt 1's dir already owns this name, so a direct read here
    // would silently keep returning attempt 1's transcript. `startedAt` is
    // re-stamped on every dispatch, so a pinned dir older than this
    // attempt's own start can only be a prior attempt's leftover — reject it
    // and fall through to the scan, bounded by the same timestamp.
    // BB-473 review round 4 (Critical 2): prefer the deterministic attempt
    // family — the HIGHEST-numbered attempt whose session dir actually
    // exists — over the `startedAt` window below, which a sibling session
    // newer than the bound could still beat. Each family member names a
    // distinct attempt, so no staleness check is needed.
    if (run?.attemptFamily?.length) {
      for (let i = run.attemptFamily.length - 1; i >= 0; i--) {
        const candidate = run.attemptFamily[i];
        if (!candidate) continue;
        const dir = join(root, candidate);
        const summary = await readJson(join(dir, 'summary.json'));
        if (!summary) {
          continue; // try the next, lower-numbered attempt.
        }
        const [signals, chatHistory, updates] = await Promise.all([
          readJson(join(dir, 'signals.json')),
          readText(join(dir, 'chat_history.jsonl')),
          readText(join(dir, 'updates.jsonl')),
        ]);
        return JSON.stringify({
          summary,
          signals: signals ?? {},
          chatHistory,
          updates,
        });
      }
      // AC-5: none of the family's dirs exist yet — fall through to the scan.
    } else if (run?.sessionId) {
      const dir = join(root, run.sessionId);
      const summary = await readJson(join(dir, 'summary.json'));
      let isStale = false;
      if (summary && startedAtMs !== null && Number.isFinite(startedAtMs)) {
        try {
          isStale = (await stat(dir)).mtimeMs < startedAtMs;
        } catch {
          isStale = true;
        }
      }
      if (summary && !isStale) {
        const [signals, chatHistory, updates] = await Promise.all([
          readJson(join(dir, 'signals.json')),
          readText(join(dir, 'chat_history.jsonl')),
          readText(join(dir, 'updates.jsonl')),
        ]);
        return JSON.stringify({
          summary,
          signals: signals ?? {},
          chatHistory,
          updates,
        });
      }
      // fall through to the scan.
    }
    let names: string[];
    try {
      names = await readdir(root);
    } catch {
      return '';
    }

    let latest:
      | { dir: string; summary: Record<string, unknown>; updated: number }
      | undefined;
    for (const name of names) {
      const dir = join(root, name);
      const summary = await readJson(join(dir, 'summary.json'));
      if (!summary) {
        continue;
      }
      const info = summary?.info;
      if (
        typeof info !== 'object' ||
        info === null ||
        (info as { cwd?: unknown }).cwd !== worktreePath
      ) {
        continue;
      }
      let updated =
        typeof summary?.updated_at === 'string'
          ? Date.parse(summary.updated_at)
          : Number.NaN;
      if (!Number.isFinite(updated)) {
        try {
          updated = (await stat(dir)).mtimeMs;
        } catch {
          continue;
        }
      }
      if (
        startedAtMs !== null &&
        Number.isFinite(startedAtMs) &&
        updated < startedAtMs
      ) {
        continue;
      }
      if (!latest || updated > latest.updated) {
        latest = { dir, summary, updated };
      }
    }
    if (!latest) return '';

    const [signals, chatHistory, updates] = await Promise.all([
      readJson(join(latest.dir, 'signals.json')),
      readText(join(latest.dir, 'chat_history.jsonl')),
      readText(join(latest.dir, 'updates.jsonl')),
    ]);
    return JSON.stringify({
      summary: latest.summary,
      signals: signals ?? {},
      chatHistory,
      updates,
    });
  }

  parseFootprint(log: string): AgentFootprint {
    return parseGrokTranscript(log);
  }
}

export function grokAgent(options: GrokAgentOptions = {}): AgentPlugin {
  const agent = new GrokAgent(options);
  return {
    kind: 'agent',
    id: 'grok',
    requiredModules: [],
    async createAgent() {
      return agent;
    },
  };
}

export default grokAgent;
