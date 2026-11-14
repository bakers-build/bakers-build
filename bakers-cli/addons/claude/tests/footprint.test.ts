import { describe, expect, it } from 'vitest';
import { parseClaudeTranscript } from '../src/footprint.js';
import { ClaudeAgent } from '../src/index.js';

/** Build a Claude-Code-style JSONL transcript line. */
function line(obj: unknown): string {
  return JSON.stringify(obj);
}

const assistant = (
  content: unknown[],
  usage: Record<string, number>,
  model = 'claude-opus-4-8',
  id?: string,
) =>
  line({
    type: 'assistant',
    message: { id, role: 'assistant', model, content, usage },
  });

const USAGE_100 = {
  input_tokens: 10,
  output_tokens: 20,
  cache_creation_input_tokens: 30,
  cache_read_input_tokens: 40,
};

const userPrompt = (text: string) =>
  line({ type: 'user', message: { role: 'user', content: text } });

const toolResult = () =>
  line({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }],
    },
  });

describe('parseClaudeTranscript', () => {
  it('sums tokens across all usage buckets of assistant turns', () => {
    const jsonl = [
      assistant([{ type: 'text', text: 'hi' }], {
        input_tokens: 10,
        output_tokens: 20,
        cache_creation_input_tokens: 30,
        cache_read_input_tokens: 40,
      }),
      assistant([{ type: 'text', text: 'again' }], {
        input_tokens: 1,
        output_tokens: 2,
        cache_creation_input_tokens: 3,
        cache_read_input_tokens: 4,
      }),
    ].join('\n');
    // (10+20+30+40) + (1+2+3+4) = 100 + 10
    expect(parseClaudeTranscript(jsonl).tokens).toBe(110);
  });

  it('counts assistant turns and tool_use blocks', () => {
    const jsonl = [
      assistant(
        [
          { type: 'text', text: 'let me look' },
          { type: 'tool_use', id: 't1', name: 'Read', input: {} },
          { type: 'tool_use', id: 't2', name: 'Grep', input: {} },
        ],
        { output_tokens: 5 },
      ),
      assistant([{ type: 'tool_use', id: 't3', name: 'Bash', input: {} }], {
        output_tokens: 5,
      }),
    ].join('\n');
    const fp = parseClaudeTranscript(jsonl);
    expect(fp.agent_turns).toBe(2);
    expect(fp.tool_calls).toBe(3);
  });

  describe('one response split into several entries', () => {
    it('counts its usage and turn once per message.id', () => {
      const jsonl = [
        assistant(
          [{ type: 'thinking', thinking: '…' }],
          USAGE_100,
          undefined,
          'msg_1',
        ),
        assistant(
          [{ type: 'text', text: 'hi' }],
          USAGE_100,
          undefined,
          'msg_1',
        ),
        assistant(
          [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }],
          USAGE_100,
          undefined,
          'msg_1',
        ),
      ].join('\n');
      const fp = parseClaudeTranscript(jsonl);
      expect(fp.tokens).toBe(100);
      expect(fp.agent_turns).toBe(1);
      expect(fp.tool_calls).toBe(1);
    });

    it("counts only the last entry's usage, even when another response lies between", () => {
      const jsonl = [
        assistant([{ type: 'text', text: 'a' }], USAGE_100, undefined, 'msg_1'),
        assistant(
          [{ type: 'text', text: 'b' }],
          { input_tokens: 7 },
          undefined,
          'msg_2',
        ),
        assistant(
          [{ type: 'text', text: 'c' }],
          { input_tokens: 150 },
          undefined,
          'msg_1',
        ),
      ].join('\n');
      const fp = parseClaudeTranscript(jsonl);
      expect(fp.tokens).toBe(157);
      expect(fp.agent_turns).toBe(2);
    });

    it('still counts every tool_use block across its entries', () => {
      const toolUse = (id: string) =>
        assistant(
          [{ type: 'tool_use', id, name: 'Bash', input: {} }],
          USAGE_100,
          undefined,
          'msg_1',
        );
      const fp = parseClaudeTranscript(
        [toolUse('t1'), toolUse('t2'), toolUse('t3')].join('\n'),
      );
      expect(fp.tool_calls).toBe(3);
      expect(fp.agent_turns).toBe(1);
    });

    it('counts each entry without message.id as its own turn', () => {
      const jsonl = [
        assistant([{ type: 'text', text: 'a' }], USAGE_100),
        assistant([{ type: 'text', text: 'b' }], USAGE_100),
      ].join('\n');
      const fp = parseClaudeTranscript(jsonl);
      expect(fp.tokens).toBe(200);
      expect(fp.agent_turns).toBe(2);
    });
  });

  it('counts user prompts (string content) and their words, ignoring tool results', () => {
    const jsonl = [
      userPrompt('fix the bug please'), // 4 words
      toolResult(), // not a prompt
      userPrompt('now add a test'), // 4 words
      assistant([{ type: 'text', text: 'ok' }], { output_tokens: 1 }),
    ].join('\n');
    const fp = parseClaudeTranscript(jsonl);
    expect(fp.user_prompts).toBe(2);
    expect(fp.user_prompt_words).toBe(8);
  });

  it('captures the model from the last assistant turn', () => {
    const jsonl = [
      assistant(
        [{ type: 'text', text: 'a' }],
        { output_tokens: 1 },
        'claude-sonnet-5',
      ),
      assistant(
        [{ type: 'text', text: 'b' }],
        { output_tokens: 1 },
        'claude-opus-4-8',
      ),
    ].join('\n');
    expect(parseClaudeTranscript(jsonl).model).toBe('claude-opus-4-8');
  });

  it('is tolerant of blank and malformed lines and never throws', () => {
    const jsonl = [
      '',
      '   ',
      '{not json',
      line({ type: 'summary' }),
      userPrompt('hello world'),
      assistant([{ type: 'text', text: 'hi' }], { output_tokens: 7 }),
      '{"partial":',
    ].join('\n');
    const fp = parseClaudeTranscript(jsonl);
    expect(fp.tokens).toBe(7);
    expect(fp.agent_turns).toBe(1);
    expect(fp.user_prompts).toBe(1);
    expect(fp.user_prompt_words).toBe(2);
  });

  it('returns an all-zero footprint for an empty transcript', () => {
    expect(parseClaudeTranscript('')).toEqual({
      tokens: 0,
      duration_s: 0,
      agent_turns: 0,
      tool_calls: 0,
      user_prompts: 0,
      user_prompt_words: 0,
      active_s: 0,
    });
  });

  it('derives duration_s from the first→last entry timestamps (BB-151)', () => {
    const jsonl = [
      line({
        type: 'user',
        timestamp: '2026-07-16T15:29:48.000Z',
        message: { role: 'user', content: 'go' },
      }),
      line({
        type: 'assistant',
        timestamp: '2026-07-16T15:30:00.500Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      }),
      line({
        type: 'user',
        timestamp: '2026-07-16T15:32:18.900Z',
        message: { role: 'user', content: 'more' },
      }),
    ].join('\n');
    // 15:29:48.000 → 15:32:18.900 = 150.9s → floored to 150.
    const fp = parseClaudeTranscript(jsonl);
    expect(fp.duration_s).toBe(150);
    // 138.4s between turn end and the second prompt is human wait.
    expect(fp.active_s).toBe(12);
  });

  it('duration_s is 0 when fewer than two entries carry a timestamp (BB-151)', () => {
    const jsonl = [
      userPrompt('no timestamp here'),
      line({
        type: 'assistant',
        timestamp: '2026-07-16T15:29:48.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      }),
    ].join('\n');
    const fp = parseClaudeTranscript(jsonl);
    expect(fp.duration_s).toBe(0);
    expect(fp.active_s).toBe(0);
  });

  describe('active_s', () => {
    /** Stamp an entry with a time of day on a fixed date. */
    const at = (time: string, entry: Record<string, unknown>) =>
      line({ ...entry, timestamp: `2026-07-16T${time}.000Z` });
    const prompt = (text = 'go') => ({
      type: 'user',
      message: { role: 'user', content: text },
    });
    const reply = (content: unknown[] = [{ type: 'text', text: 'ok' }]) => ({
      type: 'assistant',
      message: { role: 'assistant', content },
    });
    const result = (id: string) => ({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }],
      },
    });
    const ask = (id: string, name: string) =>
      reply([{ type: 'tool_use', id, name, input: {} }]);

    it('equals duration_s when no human wait occurs', () => {
      const fp = parseClaudeTranscript(
        [
          at('10:00:00', prompt()),
          at('10:00:30', ask('t1', 'Bash')),
          at('10:01:00', result('t1')),
          at('10:02:00', reply()),
        ].join('\n'),
      );
      expect(fp.duration_s).toBe(120);
      expect(fp.active_s).toBe(120);
    });

    it('subtracts the gap between turn end and the next user prompt', () => {
      const fp = parseClaudeTranscript(
        [
          at('10:00:00', prompt()),
          at('10:00:10', reply()),
          at('11:00:10', prompt()),
          at('11:00:20', reply()),
        ].join('\n'),
      );
      expect(fp.duration_s).toBe(3620);
      expect(fp.active_s).toBe(20);
    });

    it('measures from the last assistant entry, not from entries written at prompt time', () => {
      const fp = parseClaudeTranscript(
        [
          at('10:00:00', prompt()),
          at('10:00:10', reply()),
          at('11:00:09', { type: 'attachment' }),
          at('11:00:10', prompt()),
          at('11:00:20', reply()),
        ].join('\n'),
      );
      expect(fp.active_s).toBe(20);
    });

    it('counts an open AskUserQuestion as waiting without counting its answer as a prompt', () => {
      const fp = parseClaudeTranscript(
        [
          at('10:00:00', prompt()),
          at('10:00:10', ask('q1', 'AskUserQuestion')),
          at('18:00:10', result('q1')),
          at('18:00:20', reply()),
        ].join('\n'),
      );
      expect(fp.active_s).toBe(20);
      expect(fp.user_prompts).toBe(1);
    });

    it('treats ExitPlanMode like AskUserQuestion', () => {
      const fp = parseClaudeTranscript(
        [
          at('10:00:00', prompt()),
          at('10:00:10', ask('p1', 'ExitPlanMode')),
          at('18:00:10', result('p1')),
          at('18:00:20', reply()),
        ].join('\n'),
      );
      expect(fp.active_s).toBe(20);
    });

    it('does not count the same wait twice when a prompt follows an answered question', () => {
      const fp = parseClaudeTranscript(
        [
          at('10:00:00', prompt()),
          at('10:00:10', ask('q1', 'AskUserQuestion')),
          at('11:00:10', result('q1')),
          at('11:00:15', prompt()),
          at('11:00:20', reply()),
        ].join('\n'),
      );
      // Only the open question waits; answer → typed prompt is not recounted.
      expect(fp.active_s).toBe(20);
    });

    it('adds no wait before the first prompt or between back-to-back prompts', () => {
      const fp = parseClaudeTranscript(
        [
          at('10:00:00', prompt()),
          at('10:05:00', prompt()),
          at('10:05:10', reply()),
        ].join('\n'),
      );
      expect(fp.active_s).toBe(310);
    });

    it('does not count background-agent work announced by a task notification as waiting', () => {
      const fp = parseClaudeTranscript(
        [
          at('10:00:00', prompt()),
          at('10:00:10', reply()),
          at(
            '10:30:10',
            prompt('<task-notification>agent finished</task-notification>'),
          ),
          at('10:30:20', reply()),
          at('11:30:20', prompt()),
          at('11:30:30', reply()),
        ].join('\n'),
      );
      // Only the hour before the typed prompt is human wait.
      expect(fp.duration_s).toBe(5430);
      expect(fp.active_s).toBe(1830);
    });

    it('starts the wait at a trailing task notification when no reply follows it', () => {
      const fp = parseClaudeTranscript(
        [
          at('10:00:00', prompt()),
          at('10:00:10', reply()),
          at(
            '10:30:10',
            prompt('<task-notification>agent finished</task-notification>'),
          ),
          at('11:30:10', prompt()),
          at('11:30:20', reply()),
        ].join('\n'),
      );
      expect(fp.active_s).toBe(1820);
    });

    it('skips entries without a timestamp', () => {
      const fp = parseClaudeTranscript(
        [
          at('10:00:00', prompt()),
          at('10:00:10', reply()),
          line(reply()),
          at('11:00:10', prompt()),
          at('11:00:20', reply()),
        ].join('\n'),
      );
      expect(fp.active_s).toBe(20);
    });
  });

  it('is wired as the ClaudeAgent.parseFootprint implementation', () => {
    const agent = new ClaudeAgent({});
    const jsonl = assistant([{ type: 'text', text: 'hi' }], {
      output_tokens: 3,
    });
    expect(agent.parseFootprint(jsonl).tokens).toBe(3);
  });
});
