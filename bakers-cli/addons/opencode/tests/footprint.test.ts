import { emptyAgentFootprint } from '@bakers-build/conductor/contract';
import { describe, expect, it } from 'vitest';
import { parseOpencodeTranscript } from '../src/footprint.js';

// Build the raw `{ session, messages, parts }` bundle `getRunLog` serialises,
// with small helper builders (mirrors the pi addon's `line()` approach).
type Bundle = {
  session: unknown;
  messages: unknown[];
  parts: unknown[];
};

const session = (directory: string, created: number, updated: number) => ({
  id: 'ses_x',
  directory,
  time: { created, updated },
});

const userMessage = (id: string, created: number) => ({
  id,
  sessionID: 'ses_x',
  role: 'user',
  time: { created },
});

const assistantMessage = (
  id: string,
  created: number,
  completed: number,
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  },
  providerID: string,
  modelID: string,
) => ({
  id,
  sessionID: 'ses_x',
  role: 'assistant',
  time: { created, completed },
  providerID,
  modelID,
  tokens,
});

const textPart = (messageID: string, text: string) => ({
  id: `prt_${messageID}_t`,
  sessionID: 'ses_x',
  messageID,
  type: 'text',
  text,
});

const toolPart = (messageID: string, tool: string) => ({
  id: `prt_${messageID}_${tool}`,
  sessionID: 'ses_x',
  messageID,
  type: 'tool',
  tool,
});

const serialise = (b: Bundle) => JSON.stringify(b);

/** A rich, real-shape bundle with known expected footprint values. */
function richBundle(): Bundle {
  return {
    session: session('/tmp/wt', 1_000_000, 1_010_000),
    messages: [
      userMessage('u1', 1_001_000),
      assistantMessage(
        'a1',
        1_002_000,
        1_004_000,
        {
          input: 1000,
          output: 200,
          reasoning: 50,
          cache: { read: 400, write: 0 },
        },
        'opencode',
        'big-pickle',
      ),
      assistantMessage(
        'a2',
        1_006_000,
        1_009_000,
        {
          input: 2000,
          output: 300,
          reasoning: 0,
          cache: { read: 800, write: 100 },
        },
        'kimi-for-coding',
        'k3',
      ),
    ],
    parts: [
      textPart('u1', 'please add the real footprint now'), // 6 words
      {
        id: 'prt_a1_r',
        sessionID: 'ses_x',
        messageID: 'a1',
        type: 'reasoning',
        text: 'ignore me',
      },
      toolPart('a1', 'read'),
      toolPart('a1', 'grep'),
      textPart('a1', 'assistant prose that must not count as a prompt word'), // assistant text
      toolPart('a2', 'edit'),
    ],
  };
}

describe('parseOpencodeTranscript', () => {
  it('derives a non-zero, field-complete footprint from a real-shape bundle', () => {
    const fp = parseOpencodeTranscript(serialise(richBundle()));
    // tokens: a1 (1000+200+50+400+0=1650) + a2 (2000+300+0+800+100=3200) = 4850
    expect(fp.tokens).toBe(4850);
    expect(fp.agent_turns).toBe(2);
    expect(fp.tool_calls).toBe(3);
    expect(fp.user_prompts).toBe(1);
    expect(fp.user_prompt_words).toBe(6);
    // duration: floor((1_010_000 - 1_000_000) / 1000) = 10
    expect(fp.duration_s).toBe(10);
    // model: last assistant by time.created = a2
    expect(fp.model).toBe('kimi-for-coding/k3');
  });

  it('counts every token bucket incl. cache read/write and reasoning', () => {
    const b: Bundle = {
      session: session('/tmp/wt', 0, 0),
      messages: [
        assistantMessage(
          'a1',
          0,
          0,
          { input: 1, output: 2, reasoning: 4, cache: { read: 8, write: 16 } },
          'p',
          'm',
        ),
      ],
      parts: [],
    };
    expect(parseOpencodeTranscript(serialise(b)).tokens).toBe(31);
  });

  it('only counts text parts of user messages as prompt words', () => {
    const b = richBundle();
    // The assistant text part ("assistant prose…") and the reasoning part must
    // not contribute; only the user text part's 6 words count.
    expect(parseOpencodeTranscript(serialise(b)).user_prompt_words).toBe(6);
  });

  it('reports 0 duration when fewer than two timestamps are present', () => {
    const b: Bundle = {
      session: { id: 'ses_x', directory: '/tmp/wt', time: { created: 5_000 } },
      messages: [],
      parts: [],
    };
    expect(parseOpencodeTranscript(serialise(b)).duration_s).toBe(0);
  });

  it('leaves model undefined when there is no assistant turn', () => {
    const b: Bundle = {
      session: session('/tmp/wt', 0, 1000),
      messages: [userMessage('u1', 500)],
      parts: [textPart('u1', 'hi there')],
    };
    const fp = parseOpencodeTranscript(serialise(b));
    expect(fp.model).toBeUndefined();
    expect(fp.agent_turns).toBe(0);
    expect(fp.user_prompt_words).toBe(2);
  });

  it.each([
    '',
    '{',
    'not json',
    '[]',
    '{"messages":[]}',
  ])('returns emptyAgentFootprint() for empty/garbage input %j', (garbage) => {
    expect(parseOpencodeTranscript(garbage)).toEqual(emptyAgentFootprint());
  });

  it('never throws on malformed records', () => {
    const b = {
      session: session('/tmp/wt', 0, 1000),
      messages: [{ role: 'assistant' }, null, 42, { role: 'user', time: {} }],
      parts: [
        null,
        { type: 'tool' },
        { type: 'text', messageID: 'nope', text: 'x' },
      ],
    };
    expect(() => parseOpencodeTranscript(JSON.stringify(b))).not.toThrow();
  });
});
