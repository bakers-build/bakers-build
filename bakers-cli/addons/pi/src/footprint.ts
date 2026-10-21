import {
  type AgentFootprint,
  emptyAgentFootprint,
} from '@bakers-build/conductor/contract';

/** Minimal shape of a pi JSONL transcript entry we care about. */
interface TranscriptEntry {
  type?: string;
  /** ISO-8601 wall-clock time the entry was written (BB-151 duration). */
  timestamp?: string;
  /** On a `model_change` entry. */
  provider?: string;
  modelId?: string;
  /** On a `message` entry. */
  message?: {
    role?: string;
    provider?: string;
    model?: string;
    content?: unknown;
    usage?: Record<string, unknown>;
  };
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** Words across the `text` parts of a pi `message.content[]` array. */
function promptWords(content: unknown): number {
  if (!Array.isArray(content)) {
    return 0;
  }
  let words = 0;
  for (const part of content) {
    if (
      part &&
      typeof part === 'object' &&
      (part as { type?: string }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string'
    ) {
      words += countWords((part as { text: string }).text);
    }
  }
  return words;
}

/**
 * Parse a pi JSONL transcript into an agent footprint (BB-132).
 *
 * pi's transcript is one JSON object per line. `message` entries carry
 * `message.role`, and pi uses THREE roles: `user` (a genuine prompt),
 * `assistant` (an agent turn, with a per-turn `message.usage.totalTokens` and a
 * `content[]` array whose `toolCall` parts are the tool invocations), and a
 * distinct `toolResult` role for tool output. Tool results are cleanly
 * separable from prompts by role — no string-vs-array heuristic (unlike
 * claude). Blank or malformed lines are skipped — never throws.
 *
 * `duration_s` is the run's wall-clock length: the span between the first and
 * last entry that carries a parseable top-level `timestamp` (BB-151); fewer
 * than two timestamps → 0. `tokens` uses pi's own per-turn `totalTokens`, so no
 * usage-bucket sum is needed. `model` is the last assistant turn's
 * `provider/model`, falling back to the last `model_change`'s `provider/modelId`.
 */
export function parsePiTranscript(jsonl: string): AgentFootprint {
  const footprint = emptyAgentFootprint();
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;
  let lastModelChange: string | undefined;

  for (const raw of jsonl.split('\n')) {
    const trimmed = raw.trim();
    if (trimmed === '') {
      continue;
    }
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(trimmed) as TranscriptEntry;
    } catch {
      continue;
    }

    // Track the run span across ANY timestamped entry (session, message, …).
    if (typeof entry.timestamp === 'string') {
      const ts = Date.parse(entry.timestamp);
      if (Number.isFinite(ts)) {
        if (ts < minTs) minTs = ts;
        if (ts > maxTs) maxTs = ts;
      }
    }

    if (
      entry.type === 'model_change' &&
      typeof entry.provider === 'string' &&
      typeof entry.modelId === 'string'
    ) {
      lastModelChange = `${entry.provider}/${entry.modelId}`;
      continue;
    }

    if (entry.type !== 'message') {
      continue;
    }
    const message = entry.message;
    if (!message || typeof message !== 'object') {
      continue;
    }

    if (message.role === 'assistant') {
      footprint.agent_turns += 1;
      footprint.tokens += num(message.usage?.totalTokens);
      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (
            part &&
            typeof part === 'object' &&
            (part as { type?: string }).type === 'toolCall'
          ) {
            footprint.tool_calls += 1;
          }
        }
      }
      if (
        typeof message.provider === 'string' &&
        typeof message.model === 'string'
      ) {
        footprint.model = `${message.provider}/${message.model}`;
      }
    } else if (message.role === 'user') {
      footprint.user_prompts += 1;
      footprint.user_prompt_words += promptWords(message.content);
    }
    // `toolResult` messages are tool output — neither a prompt nor a turn.
  }

  if (Number.isFinite(minTs) && Number.isFinite(maxTs) && maxTs > minTs) {
    footprint.duration_s = Math.floor((maxTs - minTs) / 1000);
  }

  // Prefer the last assistant turn's model; fall back to the last model_change.
  if (footprint.model === undefined && lastModelChange !== undefined) {
    footprint.model = lastModelChange;
  }

  return footprint;
}
