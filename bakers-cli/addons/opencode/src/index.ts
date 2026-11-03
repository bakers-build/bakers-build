import { readdir, readFile } from 'node:fs/promises';
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
  type SandboxOptions,
  type SecurityOptions,
} from '@bakers-build/conductor/contract';
import { shellQuote } from '@bakers-build/core';
import { parseOpencodeTranscript } from './footprint.js';

export { parseOpencodeTranscript } from './footprint.js';

export interface OpencodeAgentOptions extends SecurityOptions {
  model?: string;
  effort?: string;
  args?: string[];
}

const OPENCODE_RESERVED = ['--prompt', '--auto'] as const;

/** Only satisfies the shared resolver: sandbox mode is rejected before any key is used. */
const SANDBOX_DEFAULTS: Required<SandboxOptions> = {
  trusted_commands: [],
  deny_read: [],
  allow_write: [],
  network: ['*'],
  mcp_servers: {},
};

const OPENCODE_KNOWN: readonly KnownOptionSpec[] = [
  { kind: 'model', flags: ['--model', '-m'] },
];

/**
 * opencode's local storage root: `${XDG_DATA_HOME:-~/.local/share}/opencode/storage`
 * (AC-1). Injected into `OpencodeAgent` so unit tests can point at a fixture tree.
 */
export function defaultOpencodeStorageRoot(): string {
  const dataHome =
    process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(dataHome, 'opencode', 'storage');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Read + JSON.parse a file, swallowing every error → `null`. */
async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/** Entries of `dir` starting with `prefix` and ending `.json`, or `[]`. */
async function listJson(dir: string, prefix: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter(
      (name) => name.startsWith(prefix) && name.endsWith('.json'),
    );
  } catch {
    return [];
  }
}

export class OpencodeAgent implements BbAgent {
  readonly id = 'opencode';
  readonly launchWarnings?: readonly string[];
  private readonly args: string[];
  private readonly model: string | undefined;
  private readonly overrides: { model: boolean; effort: boolean };
  private readonly security: ResolvedSecurity;
  readonly runEnvPolicy: RunEnvPolicy;

  constructor(
    options: OpencodeAgentOptions = {},
    private readonly storageRoot: string = defaultOpencodeStorageRoot(),
  ) {
    // OpenCode has no OS sandbox, so its default is system, not the shared sandbox.
    this.security = resolveSecurityOptions(
      { ...options, security: options.security ?? 'system' },
      SANDBOX_DEFAULTS,
    );
    this.runEnvPolicy = this.security.runEnvPolicy;
    if (this.security.mode === 'sandbox') {
      throw new Error(
        "OpenCode has no OS sandbox, so security: 'sandbox' cannot be enforced; leave security unset or set 'system' (your own OpenCode configuration) or 'yolo'",
      );
    }
    if (this.security.mode === 'custom') {
      throw new Error(
        "OpenCode has no config hand-off for security: 'custom'; use security: 'system' with your own OpenCode configuration",
      );
    }
    const cli = resolveAgentCliOptions(
      options,
      OPENCODE_RESERVED,
      OPENCODE_KNOWN,
    );
    this.args = cli.args;
    this.model = cli.model;
    this.overrides = cli.overrides;
    if (cli.effort !== undefined) {
      this.launchWarnings = ['effort is unsupported and ignored'];
    }
  }

  launchCommand(prompt: string, _run?: AgentRunIdentity): string {
    if (prompt === '') {
      return 'opencode';
    }

    // Interactive TUI with the initial prompt — mirrors the claude plugin
    // (`claude '<prompt>' … --dangerously-skip-permissions`). `opencode run`
    // would be the non-interactive print mode, which leaves the herdr pane
    // without an attachable session.
    const parts = ['opencode', '--prompt', shellQuote(prompt)];
    if (this.model !== undefined && !this.overrides.model) {
      parts.push('--model', shellQuote(this.model));
    }
    // Auto-approval is not protection: only yolo gets it.
    if (this.security.mode === 'yolo') {
      parts.push('--auto');
    }
    parts.push(...this.args.map(shellQuote));
    return parts.join(' ');
  }

  /**
   * Resolve the run's opencode session deterministically and return its raw
   * records serialised (BB-221). opencode has no `--session-dir`-style pin, so
   * the session is discovered by matching `session.directory` against the run's
   * worktree path (the worktree is per-run-unique) and picking the newest by
   * `time.created`. Returns a `{ session, messages, parts }` JSON bundle, or `''`
   * when no session matches. Every fs/JSON step is guarded — never throws.
   */
  async getRunLog(
    worktreePath: string,
    run?: AgentRunIdentity,
  ): Promise<string> {
    const sessionRoot = join(this.storageRoot, 'session');
    let projectDirs: string[];
    try {
      projectDirs = await readdir(sessionRoot);
    } catch {
      return '';
    }
    // opencode has no session-id pin (BB-473): the lower bound below is the
    // only available defence, so a session from a PRIOR run left in the same
    // (reused) worktree can never be selected for THIS run even when it is
    // the only/newest directory-matching session around.
    const startedAtMs =
      run?.startedAt !== undefined ? new Date(run.startedAt).getTime() : null;

    let newest: { session: Record<string, unknown>; created: number } | null =
      null;
    for (const projectDir of projectDirs) {
      const dir = join(sessionRoot, projectDir);
      for (const name of await listJson(dir, 'ses_')) {
        const record = await readJson(join(dir, name));
        if (!isObject(record) || record.directory !== worktreePath) {
          continue;
        }
        const time = isObject(record.time) ? record.time : undefined;
        const created =
          typeof time?.created === 'number'
            ? time.created
            : Number.NEGATIVE_INFINITY;
        if (
          startedAtMs !== null &&
          Number.isFinite(startedAtMs) &&
          created < startedAtMs
        ) {
          continue;
        }
        if (!newest || created > newest.created) {
          newest = { session: record, created };
        }
      }
    }
    if (!newest) {
      return '';
    }

    const sessionId = newest.session.id;
    const messages: unknown[] = [];
    const parts: unknown[] = [];
    if (typeof sessionId === 'string') {
      const messageDir = join(this.storageRoot, 'message', sessionId);
      for (const name of await listJson(messageDir, 'msg_')) {
        const message = await readJson(join(messageDir, name));
        if (message === null) {
          continue;
        }
        messages.push(message);
        const messageId = isObject(message) ? message.id : undefined;
        if (typeof messageId === 'string') {
          const partDir = join(this.storageRoot, 'part', messageId);
          for (const partName of await listJson(partDir, 'prt_')) {
            const part = await readJson(join(partDir, partName));
            if (part !== null) {
              parts.push(part);
            }
          }
        }
      }
    }

    return JSON.stringify({ session: newest.session, messages, parts });
  }

  parseFootprint(log: string): AgentFootprint {
    return parseOpencodeTranscript(log);
  }
}

/** Config-facing factory: `opencodeAgent({ model: 'provider/model' })`. */
export function opencodeAgent(options: OpencodeAgentOptions = {}): AgentPlugin {
  const agent = new OpencodeAgent(options);
  return {
    kind: 'agent',
    id: 'opencode',
    requiredModules: [],
    async createAgent() {
      return agent;
    },
  };
}

export default opencodeAgent;
