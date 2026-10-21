import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyAgentFootprint } from '@bakers-build/conductor/contract';
import { describe, expect, it } from 'vitest';
import { parsePiTranscript } from '../src/footprint.js';

/** Build a pi JSONL transcript line. */
function line(obj: unknown): string {
  return JSON.stringify(obj);
}

const assistant = (
  content: unknown[],
  totalTokens: number,
  {
    provider = 'kimi-coding',
    model = 'k3',
    timestamp = '2026-07-25T14:05:10.000Z',
  }: { provider?: string; model?: string; timestamp?: string } = {},
) =>
  line({
    type: 'message',
    timestamp,
    message: {
      role: 'assistant',
      provider,
      model,
      content,
      usage: { totalTokens, input: 0, output: 0 },
      timestamp,
    },
  });

const userPrompt = (text: string, timestamp = '2026-07-25T14:05:01.000Z') =>
  line({
    type: 'message',
    timestamp,
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp,
    },
  });

const toolResult = (timestamp = '2026-07-25T14:05:11.000Z') =>
  line({
    type: 'message',
    timestamp,
    message: {
      role: 'toolResult',
      toolCallId: 'x',
      toolName: 'Read',
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
      timestamp,
    },
  });

const toolCall = (name: string) => ({
  type: 'toolCall',
  id: 'c',
  name,
  arguments: {},
});

describe('parsePiTranscript', () => {
  it('sums usage.totalTokens across assistant turns', () => {
    const jsonl = [
      assistant([{ type: 'text', text: 'hi' }], 9999),
      assistant([{ type: 'text', text: 'again' }], 100, {
        timestamp: '2026-07-25T14:05:20.000Z',
      }),
    ].join('\n');
    expect(parsePiTranscript(jsonl).tokens).toBe(10099);
  });

  it('counts assistant turns and toolCall content parts', () => {
    const jsonl = [
      assistant(
        [
          { type: 'thinking', thinking: 'let me look' },
          toolCall('Read'),
          toolCall('Grep'),
        ],
        5,
      ),
      assistant([toolCall('Bash')], 5, {
        timestamp: '2026-07-25T14:05:20.000Z',
      }),
    ].join('\n');
    const fp = parsePiTranscript(jsonl);
    expect(fp.agent_turns).toBe(2);
    expect(fp.tool_calls).toBe(3);
  });

  it('counts user prompts and words, ignoring toolResult messages', () => {
    const jsonl = [
      userPrompt('fix the bug please'), // 4 words
      toolResult(), // NOT a prompt — distinct role
      userPrompt('now add a test', '2026-07-25T14:05:02.000Z'), // 4 words
      assistant([{ type: 'text', text: 'ok' }], 1),
    ].join('\n');
    const fp = parsePiTranscript(jsonl);
    expect(fp.user_prompts).toBe(2);
    expect(fp.user_prompt_words).toBe(8);
  });

  it('derives duration_s from first→last timestamp', () => {
    const jsonl = [
      line({ type: 'session', timestamp: '2026-07-25T14:05:00.000Z' }),
      assistant([{ type: 'text', text: 'ok' }], 1, {
        timestamp: '2026-07-25T14:06:00.000Z',
      }),
    ].join('\n');
    expect(parsePiTranscript(jsonl).duration_s).toBe(60);
  });

  it('reports duration_s 0 with fewer than two timestamps', () => {
    const jsonl = assistant([{ type: 'text', text: 'ok' }], 1);
    expect(parsePiTranscript(jsonl).duration_s).toBe(0);
  });

  it('takes model from the last assistant provider/model', () => {
    const jsonl = [
      assistant([{ type: 'text', text: 'a' }], 1, {
        provider: 'google',
        model: 'gemini',
      }),
      assistant([{ type: 'text', text: 'b' }], 1, {
        provider: 'kimi-coding',
        model: 'k3',
        timestamp: '2026-07-25T14:05:20.000Z',
      }),
    ].join('\n');
    expect(parsePiTranscript(jsonl).model).toBe('kimi-coding/k3');
  });

  it('falls back to the last model_change when no assistant carries a model', () => {
    const jsonl = [
      line({
        type: 'model_change',
        timestamp: '2026-07-25T14:05:00.100Z',
        provider: 'kimi-coding',
        modelId: 'k3',
      }),
      userPrompt('hello there'),
    ].join('\n');
    expect(parsePiTranscript(jsonl).model).toBe('kimi-coding/k3');
  });

  it('returns emptyAgentFootprint() for an empty string', () => {
    expect(parsePiTranscript('')).toEqual(emptyAgentFootprint());
  });

  it('skips blank and malformed lines without throwing', () => {
    const jsonl = [
      '',
      '   ',
      '{not json',
      assistant([{ type: 'text', text: 'ok' }], 42),
      'also { broken',
    ].join('\n');
    const fp = parsePiTranscript(jsonl);
    expect(fp.tokens).toBe(42);
    expect(fp.agent_turns).toBe(1);
  });

  it('yields a non-zero, field-complete footprint from the committed fixture', () => {
    const jsonl = readFileSync(
      join(new URL('.', import.meta.url).pathname, 'fixtures/pi-session.jsonl'),
      'utf8',
    );
    const fp = parsePiTranscript(jsonl);
    expect(fp).toEqual({
      tokens: 10099,
      duration_s: 60,
      agent_turns: 2,
      tool_calls: 3,
      user_prompts: 1,
      user_prompt_words: 7,
      active_s: 0,
      model: 'kimi-coding/k3',
    });
  });
});
