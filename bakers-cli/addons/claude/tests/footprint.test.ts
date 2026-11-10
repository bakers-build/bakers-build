import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
) =>
  line({
    type: 'assistant',
    message: { role: 'assistant', model, content, usage },
  });

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

describe('ClaudeAgent.permissionDenials', () => {
  const agent = new ClaudeAgent({ permissions: 'sandbox' });
  const toolUse = (id: string, name: string, input: object, message?: string) =>
    JSON.stringify({
      type: 'assistant',
      message: {
        id: message,
        content: [{ type: 'tool_use', id, name, input }],
      },
    });
  const toolResult = (id: string, content: string, is_error = false) =>
    JSON.stringify({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: id, content, is_error }],
      },
    });
  const said = (text: string) =>
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text }] },
    });
  // Recorded from `claude --permission-mode dontAsk`, with paths moved to a box home.
  const recorded = readFileSync(
    fileURLToPath(new URL('./fixtures/dontask-denial.jsonl', import.meta.url)),
    'utf8',
  );

  // The recording ends on the denial result; the agent's closing reply ends its turn.
  const stopped = `${recorded.trimEnd()}\n${said('I am blocked.')}`;

  it('names every action the dontAsk mode denied, tool and argument, in order', () => {
    expect(agent.permissionDenials(stopped)).toEqual([
      'Read(/home/coder/.claude/plugins/cache/bakers/bakers/0.64.0/skills/bb-workflow/references/read-ticket.md)',
      'Write(/home/coder/outside.txt)',
    ]);
  });

  it('ignores ordinary tool errors and a transcript without denials', () => {
    const errorsOnly = recorded
      .split('\n')
      .filter((l) => !l.includes("don't ask mode"))
      .join('\n');
    expect(agent.permissionDenials(errorsOnly)).toEqual([]);
    expect(agent.permissionDenials('')).toEqual([]);
    expect(agent.permissionDenials('not json\n')).toEqual([]);
  });

  it('reports nothing while the model has not replied to the denial yet', () => {
    expect(agent.permissionDenials(recorded)).toEqual([]);
  });

  it('counts only text as a reply, not a thinking entry before it', () => {
    const thought = `${recorded.trimEnd()}\n${JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'thinking', thinking: 'Blocked.' }] },
    })}`;
    expect(agent.permissionDenials(thought)).toEqual([]);
    expect(
      agent.permissionDenials(`${thought}\n${said('I am blocked.')}`),
    ).toHaveLength(2);
  });

  it('judges parallel results as one batch, whatever their order', () => {
    const deny = toolResult(
      'toolu_a',
      "Permission to use Read has been denied because Claude Code is running in don't ask mode.",
      true,
    );
    const ok = toolResult('toolu_b', '1\t# readme');
    for (const results of [
      [deny, ok],
      [ok, deny],
    ]) {
      const log = [
        toolUse('toolu_a', 'Read', { file_path: '/x' }),
        toolUse('toolu_b', 'Read', { file_path: 'README.md' }),
        ...results,
        said('I am blocked.'),
      ].join('\n');
      expect(agent.permissionDenials(log)).toEqual(['Read(/x)']);
    }
  });

  it('keeps a denial when the same response calls on after its result', () => {
    const log = [
      toolUse('toolu_a', 'Read', { file_path: '/x' }, 'msg_1'),
      toolResult(
        'toolu_a',
        "Permission to use Read has been denied because Claude Code is running in don't ask mode.",
        true,
      ),
      toolUse('toolu_b', 'Read', { file_path: 'README.md' }, 'msg_1'),
      toolResult('toolu_b', '1\t# readme'),
      said('I am blocked.'),
    ].join('\n');
    expect(agent.permissionDenials(log)).toEqual(['Read(/x)']);
  });

  it('reports nothing once the agent worked on after an earlier denial', () => {
    const later = [
      toolUse('toolu_ok', 'Read', { file_path: 'README.md' }),
      toolResult('toolu_ok', '1\t# readme'),
    ].join('\n');
    expect(agent.permissionDenials(`${recorded.trimEnd()}\n${later}`)).toEqual(
      [],
    );
  });

  it('reports nothing while a tool call is outstanding, such as a sub-agent', () => {
    const waiting = toolUse('toolu_task', 'Task', { prompt: 'run the suite' });
    expect(
      agent.permissionDenials(`${recorded.trimEnd()}\n${waiting}`),
    ).toEqual([]);
  });

  it('names the path a Glob or Grep call searched, not its pattern', () => {
    const glob = [
      toolUse('toolu_glob', 'Glob', {
        pattern: '**/*.md',
        path: '/home/coder/x',
      }),
      toolResult(
        'toolu_glob',
        "Permission to use Glob has been denied because Claude Code is running in don't ask mode.",
        true,
      ),
      said('I am blocked.'),
    ].join('\n');
    expect(agent.permissionDenials(glob)).toEqual(['Glob(/home/coder/x)']);
  });

  it('reports nothing for a run outside the sandbox', () => {
    for (const permissions of ['system', 'yolo'] as const) {
      expect(
        new ClaudeAgent({ permissions }).permissionDenials(stopped),
      ).toEqual([]);
    }
  });
});
