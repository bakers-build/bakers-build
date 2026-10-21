import {
  type AgentFootprint,
  emptyAgentFootprint,
} from '@bakers-build/conductor/contract';

/**
 * The raw records `getRunLog` serialises for one opencode session — the session
 * record, its messages, and every message's parts, verbatim. `parseFootprint`
 * is the only consumer and JSON.parses this bundle back.
 */
interface OpencodeBundle {
  session?: SessionRecord;
  messages?: unknown[];
  parts?: unknown[];
}

interface SessionRecord {
  id?: string;
  directory?: string;
  time?: { created?: number; updated?: number };
}

interface MessageRecord {
  id?: string;
  role?: string;
  time?: { created?: number; completed?: number };
  /** Assistant-only. */
  providerID?: string;
  modelID?: string;
  tokens?: {
    input?: unknown;
    output?: unknown;
    reasoning?: unknown;
    cache?: { read?: unknown; write?: unknown };
  };
}

interface PartRecord {
  messageID?: string;
  type?: string;
  text?: string;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Every token bucket of an assistant turn, incl. cache read/write (BB-220 parity). */
function messageTokens(tokens: MessageRecord['tokens']): number {
  if (!tokens) {
    return 0;
  }
  return (
    num(tokens.input) +
    num(tokens.output) +
    num(tokens.reasoning) +
    num(tokens.cache?.read) +
    num(tokens.cache?.write)
  );
}

/**
 * Parse an opencode session bundle into an agent footprint (BB-221).
 *
 * opencode persists a session as separate JSON records: one `session`, N
 * `message`s (an assistant message carries `tokens: { input, output, reasoning,
 * cache: { read, write } }` and `providerID`/`modelID` — there is **no**
 * pre-summed total), and per-message `part`s (`type: 'tool'` → a tool call,
 * `type: 'text'` on a user message → prompt words). `getRunLog` bundles them as
 * `{ session, messages, parts }`; this derives the footprint from that bundle.
 *
 * `tokens` sums every bucket incl. cache across assistant turns. `duration_s` is
 * the run's wall-clock length: the span between the earliest and latest epoch-ms
 * timestamp found across the session and message records (BB-151); fewer than
 * two timestamps → 0. `model` is the last assistant turn's `providerID/modelID`.
 * A parse error, a non-object, or a bundle with no `session` → an empty
 * footprint. Malformed records are skipped — never throws.
 */
export function parseOpencodeTranscript(serialised: string): AgentFootprint {
  const footprint = emptyAgentFootprint();

  let bundle: OpencodeBundle;
  try {
    const parsed: unknown = JSON.parse(serialised);
    if (!isObject(parsed) || !isObject((parsed as OpencodeBundle).session)) {
      return footprint;
    }
    bundle = parsed as OpencodeBundle;
  } catch {
    return footprint;
  }

  const messages = Array.isArray(bundle.messages) ? bundle.messages : [];
  const parts = Array.isArray(bundle.parts) ? bundle.parts : [];

  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;
  const track = (value: unknown): void => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value < minTs) minTs = value;
      if (value > maxTs) maxTs = value;
    }
  };
  track(bundle.session?.time?.created);
  track(bundle.session?.time?.updated);

  // messageID → role, so a text part's words are attributed to user turns only.
  const roleOf = new Map<string, string>();
  let lastAssistant: { created: number; model: string } | undefined;

  for (const raw of messages) {
    if (!isObject(raw)) {
      continue;
    }
    const message = raw as MessageRecord;
    if (typeof message.id === 'string' && typeof message.role === 'string') {
      roleOf.set(message.id, message.role);
    }
    track(message.time?.created);
    track(message.time?.completed);

    if (message.role === 'assistant') {
      footprint.agent_turns += 1;
      footprint.tokens += messageTokens(message.tokens);
      if (
        typeof message.providerID === 'string' &&
        typeof message.modelID === 'string'
      ) {
        const created = num(message.time?.created);
        if (!lastAssistant || created >= lastAssistant.created) {
          lastAssistant = {
            created,
            model: `${message.providerID}/${message.modelID}`,
          };
        }
      }
    } else if (message.role === 'user') {
      footprint.user_prompts += 1;
    }
  }

  for (const raw of parts) {
    if (!isObject(raw)) {
      continue;
    }
    const part = raw as PartRecord;
    if (part.type === 'tool') {
      footprint.tool_calls += 1;
    } else if (
      part.type === 'text' &&
      typeof part.text === 'string' &&
      typeof part.messageID === 'string' &&
      roleOf.get(part.messageID) === 'user'
    ) {
      footprint.user_prompt_words += countWords(part.text);
    }
  }

  if (Number.isFinite(minTs) && Number.isFinite(maxTs) && maxTs > minTs) {
    footprint.duration_s = Math.floor((maxTs - minTs) / 1000);
  }
  if (lastAssistant) {
    footprint.model = lastAssistant.model;
  }

  return footprint;
}
