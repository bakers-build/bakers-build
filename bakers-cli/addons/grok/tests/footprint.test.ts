import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyAgentFootprint } from '@bakers-build/conductor/contract';
import { describe, expect, it } from 'vitest';
import { parseGrokTranscript } from '../src/footprint.js';

const fixture = new URL('fixtures/grok-session/', import.meta.url).pathname;
const bundle = () =>
  JSON.stringify({
    summary: JSON.parse(readFileSync(join(fixture, 'summary.json'), 'utf8')),
    signals: JSON.parse(readFileSync(join(fixture, 'signals.json'), 'utf8')),
    chatHistory: readFileSync(join(fixture, 'chat_history.jsonl'), 'utf8'),
    updates: readFileSync(join(fixture, 'updates.jsonl'), 'utf8'),
  });

describe('parseGrokTranscript', () => {
  it('returns the complete captured-session footprint', () => {
    expect(parseGrokTranscript(bundle())).toEqual({
      tokens: 29390,
      duration_s: 9,
      agent_turns: 1,
      tool_calls: 0,
      user_prompts: 1,
      user_prompt_words: 6,
      active_s: 0,
      model: 'grok-4.5',
    });
  });

  it('sums completed-turn totals and maps finite signal counters', () => {
    const updates = [
      {
        timestamp: 10,
        params: {
          update: {
            sessionUpdate: 'turn_completed',
            usage: { totalTokens: 40 },
          },
        },
      },
      {
        timestamp: 12,
        params: {
          update: {
            sessionUpdate: 'turn_completed',
            usage: { totalTokens: 60 },
          },
        },
      },
    ]
      .map(JSON.stringify)
      .join('\n');
    const log = JSON.stringify({
      summary: { current_model_id: 'grok-4.5' },
      signals: {
        assistantMessageCount: 2,
        toolCallCount: 3,
        userMessageCount: 1,
      },
      chatHistory: JSON.stringify({
        type: 'user',
        prompt_index: 0,
        content: [{ type: 'text', text: 'one real prompt' }],
      }),
      updates,
    });
    expect(parseGrokTranscript(log)).toEqual({
      tokens: 100,
      duration_s: 2,
      agent_turns: 2,
      tool_calls: 3,
      user_prompts: 1,
      user_prompt_words: 3,
      active_s: 0,
      model: 'grok-4.5',
    });
  });

  it('counts only numeric prompt_index entries as prompt words', () => {
    const chatHistory = [
      {
        type: 'user',
        content: [{ type: 'text', text: 'bootstrap is not a prompt' }],
      },
      {
        type: 'user',
        synthetic_reason: 'system_reminder',
        content: [{ type: 'text', text: 'ignore reminder' }],
      },
      {
        type: 'user',
        prompt_index: 0,
        content: [{ type: 'text', text: 'count these two' }],
      },
    ]
      .map(JSON.stringify)
      .join('\n');
    const log = JSON.stringify({
      signals: { userMessageCount: 1 },
      chatHistory,
      updates: '',
    });
    expect(parseGrokTranscript(log).user_prompt_words).toBe(3);
  });

  it('falls back to persisted chat and update metadata when signals are absent', () => {
    const chatHistory = [
      {
        type: 'user',
        content: [{ type: 'text', text: 'bootstrap is not a prompt' }],
      },
      {
        type: 'user',
        prompt_index: 0,
        content: [{ type: 'text', text: 'one real prompt' }],
      },
      { type: 'assistant', tool_calls: [{ id: 'one' }, { id: 'two' }] },
      { type: 'assistant', tool_calls: [{ id: 'three' }] },
    ]
      .map(JSON.stringify)
      .join('\n');
    const updates = [
      { timestamp: 10, params: { _meta: { totalTokens: 100 } } },
      { timestamp: 12, params: { _meta: { totalTokens: 140 } } },
    ]
      .map(JSON.stringify)
      .join('\n');

    expect(
      parseGrokTranscript(
        JSON.stringify({
          summary: { current_model_id: 'grok-4.5' },
          signals: {},
          chatHistory,
          updates,
        }),
      ),
    ).toEqual({
      tokens: 140,
      duration_s: 2,
      agent_turns: 2,
      tool_calls: 3,
      user_prompts: 1,
      user_prompt_words: 3,
      active_s: 0,
      model: 'grok-4.5',
    });
  });

  it('falls back to update metadata when a completed-turn total is malformed', () => {
    const updates = JSON.stringify({
      params: {
        _meta: { totalTokens: 140 },
        update: {
          sessionUpdate: 'turn_completed',
          usage: { totalTokens: 'invalid' },
        },
      },
    });

    expect(parseGrokTranscript(JSON.stringify({ updates })).tokens).toBe(140);
  });

  it('is tolerant and honest for empty, malformed, and invalid counters', () => {
    expect(parseGrokTranscript('')).toEqual(emptyAgentFootprint());
    expect(parseGrokTranscript('{bad')).toEqual(emptyAgentFootprint());
    expect(
      parseGrokTranscript(
        JSON.stringify({
          signals: { assistantMessageCount: -1, toolCallCount: 'three' },
          chatHistory: '{bad\n',
          updates: '{bad\n',
        }),
      ),
    ).toEqual(emptyAgentFootprint());
  });
});
