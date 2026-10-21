import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import codexAgentDefault, {
  CodexAgent,
  codexAgent,
  parseCodexTranscript,
} from '../src/index.js';

describe('default export', () => {
  it('is the same factory reference as the named `codexAgent` export', () => {
    expect(codexAgentDefault).toBe(codexAgent);
  });
  it('builds an agent plugin descriptor (kind "agent")', () => {
    expect(codexAgentDefault().kind).toBe('agent');
  });
});

describe('CodexAgent.launchCommand', () => {
  it('includes the prompt, model, sandbox, and bypass flag', () => {
    const agent = new CodexAgent({ model: 'gpt-5' });
    expect(agent.launchCommand('do the thing')).toBe(
      "codex --sandbox danger-full-access --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust --model 'gpt-5' 'do the thing'",
    );
  });

  it('omits --model when no model is set', () => {
    expect(new CodexAgent({}).launchCommand('x')).toBe(
      "codex --sandbox danger-full-access --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust 'x'",
    );
  });

  it('returns codex with run flags for an empty prompt', () => {
    expect(new CodexAgent({}).launchCommand('')).toBe(
      'codex --sandbox danger-full-access --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust',
    );
  });

  it('POSIX-quotes a multi-line prompt for the sh-evaluated launch file', () => {
    const cmd = new CodexAgent({}).launchCommand('para one\n\npara two');
    expect(cmd).toBe(
      "codex --sandbox danger-full-access --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust 'para one\n\npara two'",
    );
  });
});

function captureArgv(binary: string, command: string): string[] {
  const output = execFileSync(
    'bash',
    ['-c', `${binary}() { printf '%s\\0' "${binary}" "$@"; }; ${command}`],
    { encoding: 'utf8' },
  );
  return output.split('\0').slice(0, -1);
}

describe('CodexAgent args and effort', () => {
  it('appends args after generated elements and serializes effort as one -c assignment', () => {
    const command = new CodexAgent({
      model: 'gpt-5',
      effort: 'medium',
      args: ['--foo', 'bar baz'],
    }).launchCommand('task');
    expect(captureArgv('codex', command)).toEqual([
      'codex',
      '--sandbox',
      'danger-full-access',
      '--dangerously-bypass-approvals-and-sandbox',
      '--dangerously-bypass-hook-trust',
      '--model',
      'gpt-5',
      '-c',
      'model_reasoning_effort="medium"',
      'task',
      '--foo',
      'bar baz',
    ]);
  });

  it('suppresses generated model and effort when -c assignments override them', () => {
    const command = new CodexAgent({
      model: 'gpt-5',
      effort: 'low',
      args: ['-c', 'model=gpt-6', '-c', 'model_reasoning_effort="high"'],
    }).launchCommand('x');
    expect(captureArgv('codex', command)).toEqual([
      'codex',
      '--sandbox',
      'danger-full-access',
      '--dangerously-bypass-approvals-and-sandbox',
      '--dangerously-bypass-hook-trust',
      'x',
      '-c',
      'model=gpt-6',
      '-c',
      'model_reasoning_effort="high"',
    ]);
  });

  it('leaves unrelated -c keys in place and still generates model', () => {
    const command = new CodexAgent({
      model: 'gpt-5',
      args: ['-c', 'sandbox_mode="danger-full-access"'],
    }).launchCommand('x');
    expect(captureArgv('codex', command)).toEqual([
      'codex',
      '--sandbox',
      'danger-full-access',
      '--dangerously-bypass-approvals-and-sandbox',
      '--dangerously-bypass-hook-trust',
      '--model',
      'gpt-5',
      'x',
      '-c',
      'sandbox_mode="danger-full-access"',
    ]);
  });

  it('does not treat JSON config values as independent flags', () => {
    const command = new CodexAgent({
      model: 'gpt-5',
      args: ['-c', 'notice="--model other"'],
    }).launchCommand('x');
    expect(captureArgv('codex', command)).toEqual([
      'codex',
      '--sandbox',
      'danger-full-access',
      '--dangerously-bypass-approvals-and-sandbox',
      '--dangerously-bypass-hook-trust',
      '--model',
      'gpt-5',
      'x',
      '-c',
      'notice="--model other"',
    ]);
  });

  it('rejects reserved sandbox and bypass flags including attached -s', () => {
    for (const flag of [
      '--sandbox',
      '-s',
      '-sfoo',
      '--dangerously-bypass-approvals-and-sandbox',
      '--dangerously-bypass-hook-trust',
    ]) {
      expect(() => new CodexAgent({ args: [flag] })).toThrow(/reserved flag/);
    }
  });

  it('does not append args for an empty prompt', () => {
    const command = new CodexAgent({
      args: ['--foo'],
    }).launchCommand('');
    expect(command).not.toContain('--foo');
  });
});

describe('CodexAgent.getRunLog', () => {
  it('returns the newest session whose metadata cwd matches the worktree', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bakers-codex-'));
    const oldDir = join(home, '.codex', 'sessions', '2026', '07', '17');
    const newDir = join(home, '.codex', 'sessions', '2026', '07', '18');
    await mkdir(oldDir, { recursive: true });
    await mkdir(newDir, { recursive: true });

    const session = (cwd: string, marker: string) =>
      `${JSON.stringify({ type: 'session_meta', payload: { cwd } })}\n${marker}`;
    const oldPath = join(oldDir, 'rollout-old.jsonl');
    const otherPath = join(newDir, 'rollout-other.jsonl');
    const newestPath = join(newDir, 'rollout-newest.jsonl');
    await writeFile(oldPath, session('/tmp/worktree', 'old'));
    await writeFile(otherPath, session('/tmp/other', 'other'));
    await writeFile(newestPath, session('/tmp/worktree', 'newest'));
    await utimes(oldPath, new Date(1_000), new Date(1_000));
    await utimes(otherPath, new Date(3_000), new Date(3_000));
    await utimes(newestPath, new Date(2_000), new Date(2_000));

    await expect(
      new CodexAgent({}, home).getRunLog('/tmp/worktree'),
    ).resolves.toContain('newest');
  });

  it('returns an empty string when no matching transcript exists', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bakers-codex-'));
    await expect(
      new CodexAgent({}, home).getRunLog('/tmp/worktree'),
    ).resolves.toBe('');
  });

  it('R4: never selects a transcript older than run.startedAt, even when it is the newest matching-cwd transcript (BB-473)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bakers-codex-'));
    const dir = join(home, '.codex', 'sessions', '2026', '07', '17');
    await mkdir(dir, { recursive: true });

    const session = (cwd: string, marker: string) =>
      `${JSON.stringify({ type: 'session_meta', payload: { cwd } })}\n${marker}`;
    // A leftover transcript from a PRIOR run in the same (reused) worktree —
    // it is the only cwd-matching transcript, so a plain newest-by-mtime scan
    // would select it; the startedAt lower bound must rule it out anyway.
    const stalePath = join(dir, 'rollout-stale.jsonl');
    await writeFile(stalePath, session('/tmp/worktree', 'stale-prior-run'));
    await utimes(stalePath, new Date(1_000), new Date(1_000));

    const log = await new CodexAgent({}, home).getRunLog('/tmp/worktree', {
      sessionId: 'r-1',
      startedAt: new Date(2_000),
    });
    expect(log).toBe('');
  });

  it('R4: still selects a transcript at/after run.startedAt (BB-473)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bakers-codex-'));
    const dir = join(home, '.codex', 'sessions', '2026', '07', '17');
    await mkdir(dir, { recursive: true });

    const session = (cwd: string, marker: string) =>
      `${JSON.stringify({ type: 'session_meta', payload: { cwd } })}\n${marker}`;
    const oursPath = join(dir, 'rollout-ours.jsonl');
    await writeFile(oursPath, session('/tmp/worktree', 'ours'));
    await utimes(oursPath, new Date(3_000), new Date(3_000));

    const log = await new CodexAgent({}, home).getRunLog('/tmp/worktree', {
      sessionId: 'r-1',
      startedAt: new Date(2_000),
    });
    expect(log).toContain('ours');
  });

  it("finding 3 (BB-473): the lower bound compares the session's own start (session_meta timestamp), not a still-advancing file mtime", async () => {
    const home = await mkdtemp(join(tmpdir(), 'bakers-codex-'));
    const dir = join(home, '.codex', 'sessions', '2026', '07', '17');
    await mkdir(dir, { recursive: true });

    // A PRIOR run's session, still open and appended to after THIS run
    // began: its session_meta says it started before our run, but its file
    // mtime — the last time it was appended to — is AFTER our run's start.
    // Comparing against mtime alone would wrongly let it survive the filter.
    const priorPath = join(dir, 'rollout-prior.jsonl');
    await writeFile(
      priorPath,
      `${JSON.stringify({
        type: 'session_meta',
        timestamp: '1970-01-01T00:00:01.000Z', // 1_000 ms — before our run
        payload: { cwd: '/tmp/worktree' },
      })}\nprior-still-open`,
    );
    await utimes(priorPath, new Date(3_000), new Date(3_000)); // after our run

    const log = await new CodexAgent({}, home).getRunLog('/tmp/worktree', {
      sessionId: 'r-1',
      startedAt: new Date(2_000),
    });
    expect(log).toBe('');
  });
});

describe('parseCodexTranscript', () => {
  it('extracts canonical metrics from a representative Codex transcript', () => {
    const line = (timestamp: string, type: string, payload: unknown) =>
      JSON.stringify({ timestamp, type, payload });
    const log = [
      line('2026-07-18T10:00:00.000Z', 'turn_context', {
        model: 'gpt-5.5',
      }),
      line('2026-07-18T10:00:01.000Z', 'event_msg', {
        type: 'user_message',
        message: 'fix this bug please',
      }),
      line('2026-07-18T10:00:02.000Z', 'response_item', {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'working' }],
      }),
      line('2026-07-18T10:00:03.000Z', 'response_item', {
        type: 'function_call',
        name: 'exec_command',
      }),
      line('2026-07-18T10:00:04.000Z', 'response_item', {
        type: 'custom_tool_call',
        name: 'apply_patch',
      }),
      line('2026-07-18T10:00:05.000Z', 'event_msg', {
        type: 'token_count',
        info: { total_token_usage: { total_tokens: 40 } },
      }),
      line('2026-07-18T10:00:10.900Z', 'event_msg', {
        type: 'token_count',
        info: { total_token_usage: { total_tokens: 75 } },
      }),
      line('2026-07-18T10:00:11.000Z', 'turn_context', {
        model: 'gpt-5.6',
      }),
    ].join('\n');

    expect(parseCodexTranscript(log)).toEqual({
      tokens: 75,
      duration_s: 11,
      agent_turns: 1,
      tool_calls: 2,
      user_prompts: 1,
      user_prompt_words: 4,
      active_s: 0,
      model: 'gpt-5.6',
    });
  });

  it('tolerates malformed and partial JSONL', () => {
    expect(() =>
      parseCodexTranscript('{bad\n\n{"type":"event_msg"}'),
    ).not.toThrow();
    expect(parseCodexTranscript('')).toEqual({
      tokens: 0,
      duration_s: 0,
      agent_turns: 0,
      tool_calls: 0,
      user_prompts: 0,
      user_prompt_words: 0,
      active_s: 0,
    });
  });

  it('is wired as the CodexAgent.parseFootprint implementation', () => {
    const log = JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { total_tokens: 9 } },
      },
    });
    expect(new CodexAgent({}).parseFootprint(log).tokens).toBe(9);
  });
});
