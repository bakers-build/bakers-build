import {
  type AgentFootprint,
  emptyAgentFootprint,
} from '@bakers-build/conductor/contract';

interface CodexEntry {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    role?: string;
    message?: string;
    model?: string;
    info?: {
      total_token_usage?: { total_tokens?: unknown };
    };
  };
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** Parse Codex CLI session JSONL into the agent-neutral bakers.build footprint. */
export function parseCodexTranscript(jsonl: string): AgentFootprint {
  const footprint = emptyAgentFootprint();
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;

  for (const raw of jsonl.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;

    let entry: CodexEntry;
    try {
      entry = JSON.parse(line) as CodexEntry;
    } catch {
      continue;
    }

    if (typeof entry.timestamp === 'string') {
      const timestamp = Date.parse(entry.timestamp);
      if (Number.isFinite(timestamp)) {
        minTs = Math.min(minTs, timestamp);
        maxTs = Math.max(maxTs, timestamp);
      }
    }

    const payload = entry.payload;
    if (!payload || typeof payload !== 'object') continue;

    if (entry.type === 'turn_context' && typeof payload.model === 'string') {
      footprint.model = payload.model;
    } else if (entry.type === 'event_msg' && payload.type === 'token_count') {
      const total = payload.info?.total_token_usage?.total_tokens;
      if (typeof total === 'number' && Number.isFinite(total)) {
        footprint.tokens = total;
      }
    } else if (
      entry.type === 'event_msg' &&
      payload.type === 'user_message' &&
      typeof payload.message === 'string'
    ) {
      footprint.user_prompts += 1;
      footprint.user_prompt_words += countWords(payload.message);
    } else if (
      entry.type === 'response_item' &&
      payload.type === 'message' &&
      payload.role === 'assistant'
    ) {
      footprint.agent_turns += 1;
    } else if (
      entry.type === 'response_item' &&
      (payload.type === 'function_call' || payload.type === 'custom_tool_call')
    ) {
      footprint.tool_calls += 1;
    }
  }

  if (Number.isFinite(minTs) && Number.isFinite(maxTs) && maxTs > minTs) {
    footprint.duration_s = Math.floor((maxTs - minTs) / 1000);
  }

  return footprint;
}
