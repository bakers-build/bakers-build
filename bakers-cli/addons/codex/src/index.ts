import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentFootprint,
  type AgentPlugin,
  type AgentRunIdentity,
  type BbAgent,
  type KnownOptionSpec,
  resolveAgentCliOptions,
} from '@bakers-build/conductor/contract';
import { shellQuote } from '@bakers-build/core';
import { parseCodexTranscript } from './footprint.js';

export { parseCodexTranscript } from './footprint.js';

export interface CodexAgentOptions {
  model?: string;
  effort?: string;
  args?: string[];
}

const CODEX_RESERVED = [
  '--sandbox',
  '-s',
  '--dangerously-bypass-approvals-and-sandbox',
  '--dangerously-bypass-hook-trust',
] as const;

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

  constructor(
    options: CodexAgentOptions = {},
    private readonly home: string = homedir(),
  ) {
    const cli = resolveAgentCliOptions(options, CODEX_RESERVED, CODEX_KNOWN);
    this.args = cli.args;
    this.model = cli.model;
    this.effort = cli.effort;
    this.overrides = cli.overrides;
  }

  launchCommand(prompt: string, _run?: AgentRunIdentity): string {
    const parts = [
      'codex',
      '--sandbox danger-full-access',
      '--dangerously-bypass-approvals-and-sandbox',
      '--dangerously-bypass-hook-trust',
    ];
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
