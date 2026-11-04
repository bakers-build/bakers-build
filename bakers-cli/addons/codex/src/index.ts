import { readFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentFootprint,
  type AgentPlugin,
  type AgentRunIdentity,
  type BbAgent,
  type KnownOptionSpec,
  lastLine,
  type ResolvedSecurity,
  type RunEnvPolicy,
  resolveAgentCliOptions,
  resolveSecurityOptions,
  type SandboxHost,
  type SandboxOptions,
  type SandboxPreflight,
  type SecurityOptions,
  systemSandboxHost,
} from '@bakers-build/conductor/contract';
import {
  gitSandboxPaths,
  shellQuote,
  withoutGitDirs,
} from '@bakers-build/core';
import { parseCodexTranscript } from './footprint.js';

export { parseCodexTranscript } from './footprint.js';

export interface CodexAgentOptions extends SecurityOptions {
  model?: string;
  effort?: string;
  args?: string[];
}

const CODEX_RESERVED = [
  '--sandbox',
  '-s',
  '--dangerously-bypass-approvals-and-sandbox',
  '--dangerously-bypass-hook-trust',
  '-a',
  '--ask-for-approval',
] as const;

const SANDBOX_DEFAULTS: Required<SandboxOptions> = {
  trusted_commands: [],
  deny_read: [],
  allow_write: [],
  network: ['*'],
  mcp_servers: {},
};

/** One dotted-key segment: bare, "basic" or 'literal'. */
const KEY_SEGMENT = /\s*(?:([A-Za-z0-9_-]+)|"([^"\\]*)"|'([^']*)')\s*/y;

function keyPath(text: string): string[] | null {
  const path: string[] = [];
  KEY_SEGMENT.lastIndex = 0;
  for (;;) {
    const m = KEY_SEGMENT.exec(text);
    if (!m) return null;
    path.push((m[1] ?? m[2] ?? m[3]) as string);
    if (KEY_SEGMENT.lastIndex === text.length) return path;
    if (text[KEY_SEGMENT.lastIndex] !== '.') return null;
    KEY_SEGMENT.lastIndex += 1;
  }
}

/**
 * The server ids a Codex `config.toml` declares under `mcp_servers`, in table,
 * dotted-key and inline-table form. Throws on a declaration it cannot read or
 * that `-c mcp_servers.<id>.enabled=false` cannot address (Codex splits `-c`
 * keys on every dot), so a server never stays enabled unnoticed.
 * shortcut: line-based, so a multi-line string holding a header-like line is
 * read as one; switch to a TOML parser if that ever matters.
 */
export function codexMcpServerIds(toml: string): string[] {
  const ids = new Set<string>();
  const unreadable = (line: string) =>
    new Error(`Codex config: cannot read the mcp_servers declaration ${line}`);
  let table: string[] = [];
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const header = /^\[(\[?)(.*?)\]\]?\s*(?:#.*)?$/.exec(line);
    const key = header
      ? header[2]
      : line.slice(0, Math.max(line.indexOf('='), 0));
    if (!header && key === '') continue; // a value continued from an earlier line
    const path = keyPath(key as string);
    if (path === null || (header && header[1] !== '')) {
      // Only keys directly in `[mcp_servers]` are server ids; deeper ones
      // belong to a server already found.
      const inRoot =
        !header && table.length === 1 && table[0] === 'mcp_servers';
      if (key?.includes('mcp_servers') || inRoot) {
        throw unreadable(line);
      }
      table = header ? ['<unread>'] : table;
      continue;
    }
    const full = header ? path : [...table, ...path];
    if (header) table = path;
    if (full[0] !== 'mcp_servers') continue;
    if (full.length === 1) {
      if (header) continue;
      throw unreadable(line);
    }
    const id = full[1] as string;
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(
        `Codex config: mcp_servers id "${id}" cannot be disabled with -c`,
      );
    }
    ids.add(id);
  }
  return [...ids];
}

const CODEX_KNOWN: readonly KnownOptionSpec[] = [
  { kind: 'model', flags: ['--model', '-m'], configKeys: ['model'] },
  { kind: 'effort', flags: [], configKeys: ['model_reasoning_effort'] },
];

export class CodexAgent implements BbAgent {
  readonly id = 'codex';
  private readonly args: string[];
  private readonly model: string | undefined;
  private readonly effort: string | undefined;
  private readonly overrides: { model: boolean; effort: boolean };
  private readonly security: ResolvedSecurity;
  private readonly allowWrite: string[];
  readonly runEnvPolicy: RunEnvPolicy;

  constructor(
    options: CodexAgentOptions = {},
    private readonly home: string = homedir(),
  ) {
    const cli = resolveAgentCliOptions(options, CODEX_RESERVED, CODEX_KNOWN);
    this.args = cli.args;
    this.model = cli.model;
    this.effort = cli.effort;
    this.overrides = cli.overrides;
    this.security = resolveSecurityOptions(options, SANDBOX_DEFAULTS);
    this.runEnvPolicy = this.security.runEnvPolicy;
    this.allowWrite = withoutGitDirs(this.security.sandbox.allow_write);
    // Codex has no read deny or unsandboxed-command list to map these onto.
    for (const key of ['trusted_commands', 'deny_read'] as const) {
      if (this.security.sandbox[key].length > 0) {
        throw new Error(`Codex does not support sandbox.${key}`);
      }
    }
    // `-c` takes a TOML value; a JSON object is not one.
    for (const [key, value] of Object.entries(this.security.config ?? {})) {
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        throw new Error(
          `Codex config.${key} is an object; use one dotted key per value`,
        );
      }
    }
  }

  /** The launch flags a security mode owns (`docs/addons/codex.md`). */
  private securityFlags(workspacePath: string): string[] {
    const { mode, sandbox, config } = this.security;
    if (mode === 'system') return [];
    if (mode === 'yolo') {
      return [
        '--sandbox',
        'danger-full-access',
        '--dangerously-bypass-approvals-and-sandbox',
        '--dangerously-bypass-hook-trust',
      ];
    }
    const pairs = (entries: [string, unknown][]) =>
      entries.flatMap(([key, value]) => [
        '-c',
        `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`,
      ]);
    if (mode === 'custom') return pairs(Object.entries(config ?? {}));
    const git = gitSandboxPaths(workspacePath);
    const roots = this.allowWrite.map(
      (dir) =>
        `${JSON.stringify(dir.startsWith('~/') ? join(this.home, dir.slice(2)) : dir)} = true`,
    );
    // Filesystem overrides replace inherited entries, so retain workspace protections explicitly.
    const filesystem = [
      '":workspace_roots" = { ".git" = "read", ".agents" = "read", ".codex" = "read", ".aws" = "read" }',
      ...git.write.map((path) => `${JSON.stringify(path)} = "write"`),
      ...git.protect.map((path) => `${JSON.stringify(path)} = "read"`),
    ];
    const profile = `{ extends = ":workspace", filesystem = { ${filesystem.join(', ')} }, workspace_roots = { ${roots.join(', ')} }, network = { enabled = ${sandbox.network.length > 0} } }`;
    const flags = [
      '-a',
      'never',
      '-c',
      'default_permissions="bakers"',
      '-c',
      `permissions.bakers=${profile}`,
    ];
    for (const id of this.userMcpServers()) {
      if (!Object.hasOwn(sandbox.mcp_servers, id)) {
        flags.push(...pairs([[`mcp_servers.${id}.enabled`, false]]));
      }
    }
    return flags;
  }

  private userMcpServers(): string[] {
    const codexHome = process.env.CODEX_HOME || join(this.home, '.codex');
    let toml: string;
    try {
      toml = readFileSync(join(codexHome, 'config.toml'), 'utf8');
    } catch {
      return [];
    }
    return codexMcpServerIds(toml);
  }

  launchCommand(
    prompt: string,
    _run?: AgentRunIdentity,
    workspacePath = process.cwd(),
  ): string {
    // Quote at assembly; a plain word has nothing for the shell to expand.
    const word = (t: string) => (/^[\w./=-]+$/.test(t) ? t : shellQuote(t));
    const parts = ['codex', ...this.securityFlags(workspacePath).map(word)];
    if (this.model !== undefined && !this.overrides.model) {
      parts.push('--model', shellQuote(this.model));
    }
    if (this.effort !== undefined && !this.overrides.effort) {
      parts.push(
        '-c',
        shellQuote(`model_reasoning_effort=${JSON.stringify(this.effort)}`),
      );
    }
    if (prompt !== '') {
      parts.push(shellQuote(prompt));
      parts.push(...this.args.map(shellQuote));
    }
    return parts.join(' ');
  }

  async getRunLog(
    worktreePath: string,
    run?: AgentRunIdentity,
  ): Promise<string> {
    const sessionsDir = join(this.home, '.codex', 'sessions');
    let entries: string[];
    try {
      entries = await readdir(sessionsDir, { recursive: true });
    } catch {
      return '';
    }
    // Codex has no session-id pin (BB-473): the lower bound below is the
    // only available defence, so a transcript from a PRIOR run left in the
    // same (reused) worktree can never be selected for THIS run even when it
    // is the only/newest cwd-matching transcript around.
    const startedAtMs =
      run?.startedAt !== undefined ? new Date(run.startedAt).getTime() : null;

    let latest: { log: string; mtimeMs: number } | null = null;
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue;
      const path = join(sessionsDir, name);
      try {
        const [metadata, log] = await Promise.all([
          stat(path),
          readFile(path, 'utf8'),
        ]);
        let matches = false;
        // The session's own start, per the `session_meta` line's `timestamp`
        // field — preferred over the file's mtime (BB-473 finding 3), since
        // a still-open or appended-to session's mtime keeps advancing past
        // its own start and would otherwise survive the lower-bound filter.
        // Falls back to the file mtime when the line carries no timestamp.
        let sessionStartMs: number | null = null;
        for (const raw of log.split('\n')) {
          try {
            const entry = JSON.parse(raw) as {
              type?: string;
              timestamp?: string;
              payload?: { cwd?: string };
            };
            if (entry.type === 'session_meta') {
              matches = entry.payload?.cwd === worktreePath;
              if (typeof entry.timestamp === 'string') {
                const ts = Date.parse(entry.timestamp);
                if (Number.isFinite(ts)) {
                  sessionStartMs = ts;
                }
              }
              break;
            }
          } catch {
            // malformed line — skip.
          }
        }
        const comparisonMs = sessionStartMs ?? metadata.mtimeMs;
        if (
          startedAtMs !== null &&
          Number.isFinite(startedAtMs) &&
          comparisonMs < startedAtMs
        ) {
          continue;
        }
        if (matches && (!latest || metadata.mtimeMs > latest.mtimeMs)) {
          latest = { log, mtimeMs: metadata.mtimeMs };
        }
      } catch {
        // A session may disappear or be unreadable while Codex rotates logs.
      }
    }
    return latest?.log ?? '';
  }

  parseFootprint(log: string): AgentFootprint {
    return parseCodexTranscript(log);
  }

  /** Codex brings its own sandbox runner; a missing binary fails at launch as before. */
  async sandboxPreflight(
    host: SandboxHost = systemSandboxHost(),
  ): Promise<SandboxPreflight> {
    if (this.security.mode !== 'sandbox' || !host.onPath('codex')) {
      return { ok: true };
    }
    const probe = await host.run('codex', ['sandbox', 'true']);
    // A release without this probe form is not proof the sandbox fails; launch decides.
    return probe.ok || /unrecognized subcommand/.test(probe.stderr)
      ? { ok: true }
      : {
          ok: false,
          cause: `codex sandbox cannot start: ${lastLine(probe.stderr)}`,
          fix:
            host.platform === 'linux'
              ? 'allow unprivileged user namespaces on this host, or run the conductor where they are allowed'
              : 'make `codex sandbox true` succeed on this host',
        };
  }
}

/** Config-facing factory: `codexAgent({ model: 'gpt-5' })`. */
export function codexAgent(options: CodexAgentOptions = {}): AgentPlugin {
  const agent = new CodexAgent(options);
  return {
    kind: 'agent',
    id: 'codex',
    requiredModules: [],
    async createAgent() {
      return agent;
    },
  };
}

// Default export: this module also exports the `CodexAgent` class, so the
// config resolver's auto-pick (no `export:`) sees 2 function exports and
// would otherwise throw "specify export" — see conductor/src/config.ts
// `loadNamedPlugin`. The default export makes the factory win.
export default codexAgent;
