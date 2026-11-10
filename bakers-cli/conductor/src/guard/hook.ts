// The run guard's PreToolUse hook for Claude Code and Codex: reads the hook
// JSON on stdin, and blocks a refused shell command with exit 2 and the
// reason on stderr, which both harnesses hand back to the agent.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  checkCommand,
  DESTRUCTIVE_VERBS,
  type GuardDecision,
} from './check.js';

const SHELL_TOOLS = new Set(['Bash', 'shell', 'local_shell', 'exec_command']);
const VERB = new RegExp(
  `(^|[\\s;&|(\`'"/])(${DESTRUCTIVE_VERBS.join('|')})(\\s|$)`,
);

/** One refusal as the run log records it; the conductor reads these at finalize. */
export interface GuardLogEntry {
  at: string;
  command: string;
  cwd: string;
  rule: string;
  reason: string;
  alternative: string;
}

function ddevProject(worktree: string): string | undefined {
  try {
    const yaml = readFileSync(join(worktree, '.ddev', 'config.yaml'), 'utf8');
    return /^name:\s*["']?([^"'\s#]+)/m.exec(yaml)?.[1];
  } catch {
    return undefined;
  }
}

function commandOf(input: unknown): string | null {
  const { tool_name, tool_input } = (input ?? {}) as {
    tool_name?: string;
    tool_input?: { command?: unknown };
  };
  if (!SHELL_TOOLS.has(tool_name ?? '')) return null;
  const command = tool_input?.command;
  if (Array.isArray(command))
    return command
      .map((a) => `'${String(a).replaceAll("'", `'\\''`)}'`)
      .join(' ');
  return typeof command === 'string' ? command : null;
}

export function runHook(
  stdin: string,
  env: Record<string, string | undefined>,
): { exitCode: number; stderr: string } {
  let command: string | null = null;
  let cwd = '';
  let decision: GuardDecision;
  try {
    const input = JSON.parse(stdin);
    command = commandOf(input);
    if (command === null) return { exitCode: 0, stderr: '' };
    const worktree = env.BB_WORKTREE;
    if (!worktree) throw new Error('BB_WORKTREE is not set');
    cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : worktree;
    const project = ddevProject(worktree);
    decision = checkCommand(command, {
      cwd,
      worktree,
      tmpdir: env.TMPDIR || tmpdir(),
      home: env.HOME || '/',
      branch: env.BB_BRANCH ?? '',
      ...(project ? { ddevProject: project } : {}),
    });
  } catch (err) {
    // The guard never wedges a normal run: only a destructive verb is held.
    const text = command ?? stdin;
    decision = VERB.test(text)
      ? {
          allow: false,
          rule: 'guard-error',
          reason: `the guard could not check this command (${(err as Error).message})`,
          alternative:
            'retry the command in a plainer form, or ask the operator',
        }
      : { allow: true };
  }
  if (decision.allow) return { exitCode: 0, stderr: '' };
  const entry: GuardLogEntry = {
    at: new Date().toISOString(),
    command: command ?? stdin,
    cwd,
    rule: decision.rule,
    reason: decision.reason,
    alternative: decision.alternative,
  };
  if (env.BB_GUARD_LOG) {
    try {
      mkdirSync(dirname(env.BB_GUARD_LOG), { recursive: true });
      appendFileSync(env.BB_GUARD_LOG, `${JSON.stringify(entry)}\n`);
    } catch {
      // The refusal stands even when it cannot be logged.
    }
  }
  return {
    exitCode: 2,
    stderr: `bakers run guard refused this command (${decision.rule}): ${decision.reason}. Allowed instead: ${decision.alternative}.\n`,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { exitCode, stderr } = runHook(readFileSync(0, 'utf8'), process.env);
  process.stderr.write(stderr);
  process.exitCode = exitCode;
}
