import {
  type AgentFootprint,
  emptyAgentFootprint,
} from '@bakers-build/conductor/contract';

interface GrokSessionBundle {
  summary?: unknown;
  signals?: unknown;
  chatHistory?: unknown;
  updates?: unknown;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function words(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

function jsonLines(value: unknown): Record<string, unknown>[] {
  if (typeof value !== 'string') return [];
  const rows: Record<string, unknown>[] = [];
  for (const raw of value.split('\n')) {
    if (raw.trim() === '') continue;
    try {
      const row = object(JSON.parse(raw) as unknown);
      if (row) rows.push(row);
    } catch {
      // Grok may leave a partial final JSONL line while finalization races it.
    }
  }
  return rows;
}

function timestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function parseGrokTranscript(log: string): AgentFootprint {
  const footprint = emptyAgentFootprint();
  let bundle: GrokSessionBundle;
  try {
    bundle = object(JSON.parse(log) as unknown) ?? {};
  } catch {
    return footprint;
  }

  const summary = object(bundle.summary);
  const signals = object(bundle.signals);
  const signalAgentTurns = optionalCount(signals?.assistantMessageCount);
  const signalToolCalls = optionalCount(signals?.toolCallCount);
  const signalUserPrompts = optionalCount(signals?.userMessageCount);
  if (typeof summary?.current_model_id === 'string') {
    footprint.model = summary.current_model_id;
  }

  let chatAgentTurns = 0;
  let chatToolCalls = 0;
  let chatUserPrompts = 0;
  for (const row of jsonLines(bundle.chatHistory)) {
    if (row.type === 'assistant') {
      chatAgentTurns += 1;
      if (Array.isArray(row.tool_calls)) {
        chatToolCalls += row.tool_calls.length;
      }
    }
    if (row.type === 'user' && typeof row.prompt_index === 'number') {
      chatUserPrompts += 1;
      if (Array.isArray(row.content)) {
        for (const rawPart of row.content) {
          const part = object(rawPart);
          if (part?.type === 'text' && typeof part.text === 'string') {
            footprint.user_prompt_words += words(part.text);
          }
        }
      }
    }
  }
  footprint.agent_turns = signalAgentTurns ?? chatAgentTurns;
  footprint.tool_calls = signalToolCalls ?? chatToolCalls;
  footprint.user_prompts = signalUserPrompts ?? chatUserPrompts;

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let completedTokens = 0;
  let completedTotals = 0;
  let latestTotalTokens = 0;
  for (const row of jsonLines(bundle.updates)) {
    const timestamp = timestampMs(row.timestamp);
    if (timestamp !== undefined) {
      min = Math.min(min, timestamp);
      max = Math.max(max, timestamp);
    }
    const params = object(row.params);
    const meta = object(params?._meta);
    latestTotalTokens = Math.max(latestTotalTokens, count(meta?.totalTokens));
    const update = object(params?.update);
    if (update?.sessionUpdate === 'turn_completed') {
      const usage = object(update.usage);
      const totalTokens = optionalCount(usage?.totalTokens);
      if (totalTokens !== undefined) {
        completedTokens += totalTokens;
        completedTotals += 1;
      }
    }
  }
  footprint.tokens = completedTotals > 0 ? completedTokens : latestTotalTokens;
  if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
    footprint.duration_s = Math.floor((max - min) / 1000);
  }

  return footprint;
}
