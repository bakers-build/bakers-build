import {
  type AgentFootprint,
  emptyAgentFootprint,
} from '@bakers-build/conductor/contract';

/** Minimal shape of a Claude-Code JSONL transcript entry we care about. */
interface TranscriptEntry {
  type?: string;
  /** ISO-8601 wall-clock time the entry was written (BB-151 duration). */
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    content?: unknown;
    usage?: Record<string, unknown>;
  };
}

/** Token buckets summed into the total; each defaults to 0 when absent. */
const TOKEN_KEYS = [
  'input_tokens',
  'output_tokens',
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
] as const;

/** Tools whose open call means the agent is waiting on the human's answer. */
const QUESTION_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

/** Prefix of the user entry Claude Code writes when a background agent ends. */
const TASK_NOTIFICATION = '<task-notification>';

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/**
 * Parse a Claude-Code JSONL transcript into an agent footprint (BB-132).
 *
 * This is Claude's transcript format specifically — the transcript is one JSON
 * object per line. Assistant turns carry a `message.usage` token breakdown and
 * `message.content` blocks (text / tool_use); genuine user prompts are user
 * messages whose `message.content` is a plain string (tool results come back
 * as an array and are ignored). Blank or malformed lines are skipped — never
 * throws.
 *
 * `duration_s` is the run's wall-clock length: the span between the first and
 * last entry that carries a parseable `timestamp` (BB-151). This makes the
 * transcript the single source of the run length — no `started_at` re-read, no
 * JSON:API timestamp round-trip to mis-parse. Fewer than two timestamps → 0.
 *
 * `active_s` is `duration_s` minus the time spent waiting on the human. Two
 * gaps count as waiting: from the last assistant entry of a turn to the next
 * genuine user prompt, and from an `AskUserQuestion`/`ExitPlanMode` tool_use
 * to its tool_result. Only timestamped entries take part; no threshold.
 */
export function parseClaudeTranscript(jsonl: string): AgentFootprint {
  const footprint = emptyAgentFootprint();
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;
  let waitMs = 0;
  let lastAssistantTs: number | undefined;
  // shortcut: parallel open questions are summed, not merged, so overlapping
  // waits count twice (clamped at 0); merge intervals if parallel asks appear.
  const openQuestions = new Map<string, number>();

  for (const raw of jsonl.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      continue;
    }
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      continue;
    }

    // Track the run span across ANY timestamped entry (user, assistant,
    // system, …) — not just the turns we meter for tokens.
    let ts: number | undefined;
    if (typeof entry.timestamp === 'string') {
      const parsed = Date.parse(entry.timestamp);
      if (Number.isFinite(parsed)) {
        ts = parsed;
        if (ts < minTs) minTs = ts;
        if (ts > maxTs) maxTs = ts;
      }
    }

    const message = entry.message;
    if (!message || typeof message !== 'object') {
      continue;
    }

    if (ts !== undefined) {
      waitMs += humanWait(entry.type, message.content, ts);
    }

    if (entry.type === 'assistant') {
      footprint.agent_turns += 1;
      const usage = message.usage ?? {};
      for (const key of TOKEN_KEYS) {
        footprint.tokens += num(usage[key]);
      }
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (
            block &&
            typeof block === 'object' &&
            (block as { type?: string }).type === 'tool_use'
          ) {
            footprint.tool_calls += 1;
          }
        }
      }
      if (typeof message.model === 'string') {
        footprint.model = message.model;
      }
    } else if (entry.type === 'user' && typeof message.content === 'string') {
      footprint.user_prompts += 1;
      footprint.user_prompt_words += countWords(message.content);
    }
  }

  if (Number.isFinite(minTs) && Number.isFinite(maxTs) && maxTs > minTs) {
    footprint.duration_s = Math.floor((maxTs - minTs) / 1000);
    footprint.active_s = Math.max(
      0,
      Math.floor((maxTs - minTs - waitMs) / 1000),
    );
  }

  return footprint;

  /** Wait (ms) that ends at this entry; also tracks turn ends and open asks. */
  function humanWait(type: string | undefined, content: unknown, ts: number) {
    if (type === 'assistant') {
      lastAssistantTs = ts;
      for (const block of Array.isArray(content) ? content : []) {
        const use = block as { type?: string; id?: unknown; name?: unknown };
        if (
          use?.type === 'tool_use' &&
          typeof use.id === 'string' &&
          QUESTION_TOOLS.has(use.name as string)
        ) {
          openQuestions.set(use.id, ts);
        }
      }
      return 0;
    }
    if (type !== 'user') {
      return 0;
    }
    let wait = 0;
    if (typeof content === 'string' && content.startsWith(TASK_NOTIFICATION)) {
      // A background agent finished: agent-side work, so it anchors the turn end.
      lastAssistantTs = ts;
      return 0;
    }
    if (typeof content === 'string') {
      if (lastAssistantTs !== undefined) {
        wait = Math.max(0, ts - lastAssistantTs);
      }
      lastAssistantTs = undefined;
      return wait;
    }
    for (const block of Array.isArray(content) ? content : []) {
      const id = (block as { tool_use_id?: unknown })?.tool_use_id;
      const start = typeof id === 'string' ? openQuestions.get(id) : undefined;
      if (start !== undefined) {
        wait += Math.max(0, ts - start);
        openQuestions.delete(id as string);
        // The answer ends this wait; a prompt typed right after must not recount it.
        lastAssistantTs = undefined;
      }
    }
    return wait;
  }
}

/** Claude Code's tool_result text when `--permission-mode dontAsk` refuses a call. */
const DONT_ASK_DENIAL =
  /^Permission to use \S+ has been denied because Claude Code is running in don't ask mode\./;

/** The input field that names what a tool call acts on. */
const ACTION_KEYS = ['file_path', 'command', 'url', 'path', 'pattern', 'skill'];

/**
 * Every tool call `dontAsk` denied in a Claude-Code transcript, as `Tool(argument)`,
 * but only when the run stopped on one: a denial is among the last batch of tool
 * results, no call is outstanding and the agent has replied without a new call.
 * A run that worked on, waits on a sub-agent or on the model gives `[]`.
 */
export function parseClaudePermissionDenials(jsonl: string): string[] {
  const calls = new Map<string, string>();
  const pending = new Set<string>();
  const denied: string[] = [];
  let batchDenied = false;
  let replied = false;
  for (const raw of jsonl.split('\n')) {
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(raw) as TranscriptEntry;
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    const blocks = content as Array<Record<string, unknown>>;
    // Claude Code writes each block of a response as its own entry: a call opens a
    // new batch, a reply without one ends the turn.
    if (entry?.type === 'assistant') {
      if (blocks.some((b) => b?.type === 'tool_use')) {
        if (pending.size === 0) batchDenied = false;
        replied = false;
      } else {
        replied = true;
      }
    }
    for (const block of blocks) {
      if (block?.type === 'tool_use' && typeof block.id === 'string') {
        const input = (block.input ?? {}) as Record<string, unknown>;
        const key = ACTION_KEYS.find((k) => typeof input[k] === 'string');
        const name = String(block.name);
        calls.set(block.id, key ? `${name}(${input[key]})` : name);
        pending.add(block.id);
      } else if (block?.type === 'tool_result') {
        pending.delete(String(block.tool_use_id));
        replied = false;
        if (
          block.is_error === true &&
          typeof block.content === 'string' &&
          DONT_ASK_DENIAL.test(block.content)
        ) {
          batchDenied = true;
          denied.push(calls.get(String(block.tool_use_id)) ?? 'unknown tool');
        }
      }
    }
  }
  return batchDenied && replied && pending.size === 0 ? denied : [];
}
