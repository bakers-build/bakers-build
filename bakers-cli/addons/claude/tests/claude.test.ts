import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import claudeAgentDefault, {
  ClaudeAgent,
  claudeAgent,
  encodeClaudeProjectDir,
} from '../src/index.js';

describe('default export', () => {
  it('is the same factory reference as the named `claudeAgent` export', () => {
    expect(claudeAgentDefault).toBe(claudeAgent);
  });
  it('builds an agent plugin descriptor (kind "agent")', () => {
    expect(claudeAgentDefault().kind).toBe('agent');
  });
});

describe('encodeClaudeProjectDir', () => {
  it('replaces every non-alphanumeric char with a dash', () => {
    expect(encodeClaudeProjectDir('/home/cw/foo.bar/keytec_gitlab')).toBe(
      '-home-cw-foo-bar-keytec-gitlab',
    );
  });
});

describe('ClaudeAgent.launchCommand', () => {
  it('includes the prompt, --model and the skip-permissions flag', () => {
    const agent = new ClaudeAgent({ model: 'claude-opus-4-8' });
    expect(agent.launchCommand('do the thing')).toBe(
      "claude 'do the thing' --model 'claude-opus-4-8' --dangerously-skip-permissions",
    );
  });
  it('omits --model when no model is set', () => {
    expect(new ClaudeAgent({}).launchCommand('x')).toBe(
      "claude 'x' --dangerously-skip-permissions",
    );
  });
  it('returns the bare command for an empty prompt', () => {
    expect(new ClaudeAgent({}).launchCommand('')).toBe('claude');
  });
  it('POSIX-quotes a multi-line prompt for the sh-evaluated launch file', () => {
    const cmd = new ClaudeAgent({}).launchCommand('para one\n\npara two');
    expect(cmd).toBe(
      "claude 'para one\n\npara two' --dangerously-skip-permissions",
    );
  });
});

describe('ClaudeAgent.sessionExists', () => {
  it('is true when <sessionId>.jsonl already exists under the encoded project dir', async () => {
    const home = await mkdtemp(join(tmpdir(), 'claude-home-'));
    const cwd = '/srv/ws/PROJ-1';
    const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'r-1.jsonl'), '{}');
    expect(await new ClaudeAgent({}, home).sessionExists(cwd, 'r-1')).toBe(
      true,
    );
  });
  it('is false when the file is absent (fresh dispatch, or no dir at all)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'claude-home-'));
    expect(
      await new ClaudeAgent({}, home).sessionExists('/srv/ws/PROJ-1', 'r-1'),
    ).toBe(false);
    expect(
      await new ClaudeAgent({}, home).sessionExists('/nope/missing', 'r-1'),
    ).toBe(false);
  });
});

describe('ClaudeAgent.getRunLog', () => {
  it('reads the newest .jsonl under the encoded project dir', async () => {
    const home = await mkdtemp(join(tmpdir(), 'claude-home-'));
    const cwd = '/srv/ws/PROJ-1';
    const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'old.jsonl'), 'old');
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(join(dir, 'new.jsonl'), 'newest');
    expect(await new ClaudeAgent({}, home).getRunLog(cwd)).toBe('newest');
  });
  it('returns empty string when no transcript dir exists', async () => {
    const home = await mkdtemp(join(tmpdir(), 'claude-home-'));
    expect(await new ClaudeAgent({}, home).getRunLog('/nope/missing')).toBe('');
  });

  it('R1: given a run identity, reads THAT session file, not the newer foreign one (BB-473)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'claude-home-'));
    const cwd = '/srv/ws/PROJ-1';
    const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd));
    await mkdir(dir, { recursive: true });
    // Ours is written FIRST (older mtime); the foreign one is written after
    // (newer mtime) — a naive mtime scan would wrongly pick the foreign one.
    await writeFile(join(dir, 'ours-session.jsonl'), 'ours');
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(join(dir, 'foreign-session.jsonl'), 'foreign');
    const log = await new ClaudeAgent({}, home).getRunLog(cwd, {
      sessionId: 'ours-session',
    });
    expect(log).toBe('ours');
  });

  it("R5: without a run identity, preserves today's newest-by-mtime scan", async () => {
    const home = await mkdtemp(join(tmpdir(), 'claude-home-'));
    const cwd = '/srv/ws/PROJ-2';
    const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'only-session.jsonl'), 'the-only-one');
    expect(await new ClaudeAgent({}, home).getRunLog(cwd)).toBe('the-only-one');
  });

  it('AC-5: falls through to the scan when the pinned session file is absent — a run dispatched before this change does not finalise with an empty log (BB-473)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'claude-home-'));
    const cwd = '/srv/ws/PROJ-3';
    const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd));
    await mkdir(dir, { recursive: true });
    // No file named after the run's sessionId — as if this run was dispatched
    // before the addon started pinning `--session-id`. Only a pre-existing,
    // differently-named transcript is present.
    await writeFile(join(dir, 'pre-existing.jsonl'), 'pre-existing');
    const log = await new ClaudeAgent({}, home).getRunLog(cwd, {
      sessionId: 'never-pinned',
    });
    expect(log).toBe('pre-existing');
  });

  it('AC-5: the fallback scan still honours the startedAt lower bound, so it cannot resurrect the old mtime trap', async () => {
    const home = await mkdtemp(join(tmpdir(), 'claude-home-'));
    const cwd = '/srv/ws/PROJ-4';
    const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd));
    await mkdir(dir, { recursive: true });
    const priorPath = join(dir, 'prior-run.jsonl');
    await writeFile(priorPath, 'prior-run');
    await utimes(priorPath, new Date(1_000), new Date(1_000));
    const log = await new ClaudeAgent({}, home).getRunLog(cwd, {
      sessionId: 'never-pinned',
      startedAt: new Date(2_000),
    });
    expect(log).toBe('');
  });

  it('round 4 (review round 3, Critical 1): a pinned file older than startedAt is a stale prior attempt, not this one — falls through to the scan instead of being read directly', async () => {
    const home = await mkdtemp(join(tmpdir(), 'claude-home-'));
    const cwd = '/srv/ws/PROJ-5';
    const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd));
    await mkdir(dir, { recursive: true });
    // Attempt 1 pinned `re-dispatched-run.jsonl` and wrote to it. A
    // re-dispatch of the SAME run omits the pin (`sessionExists` guards
    // against the collision), so the agent mints a fresh session id for
    // attempt 2 and writes a differently-named file — but the conductor
    // still hands `getRunLog` the run's own uuid as `sessionId`, which still
    // names attempt 1's file. Without the startedAt check, the direct read
    // below would succeed and silently return attempt 1's transcript forever.
    const staleAttempt1 = join(dir, 're-dispatched-run.jsonl');
    await writeFile(staleAttempt1, 'attempt-1-transcript');
    await utimes(staleAttempt1, new Date(1_000), new Date(1_000));
    // Attempt 2's actual, unpinned transcript — newer than the re-stamped
    // `startedAt` the conductor records at the second dispatch.
    await writeFile(
      join(dir, 'agent-minted-uuid.jsonl'),
      'attempt-2-transcript',
    );
    const log = await new ClaudeAgent({}, home).getRunLog(cwd, {
      sessionId: 're-dispatched-run',
      startedAt: new Date(2_000),
    });
    expect(log).toBe('attempt-2-transcript');
  });
});

describe('ClaudeAgent.launchCommand with a run identity', () => {
  it('pins the session id via --session-id when a run is given (BB-473)', () => {
    const agent = new ClaudeAgent({});
    const cmd = agent.launchCommand('do the thing', { sessionId: 'r-123' });
    expect(cmd).toBe(
      "claude 'do the thing' --dangerously-skip-permissions --session-id r-123",
    );
  });
  it('omits --session-id when no run is given (unchanged behaviour)', () => {
    const agent = new ClaudeAgent({});
    expect(agent.launchCommand('x')).toBe(
      "claude 'x' --dangerously-skip-permissions",
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

describe('ClaudeAgent args, effort and skip_permissions', () => {
  it('appends each args element as exactly one argv item, preserving order, duplicates and empty strings', () => {
    const agent = new ClaudeAgent({
      args: ['--effort', 'medium', '--effort', 'high', '', '--foo', "it's"],
    });
    const command = agent.launchCommand('task');
    // biome-ignore lint/suspicious/noControlCharactersInRegex: command must stay pty-safe
    expect(command).not.toMatch(/[\x00-\x1f\x7f]/);
    expect(captureArgv('claude', command)).toEqual([
      'claude',
      'task',
      '--dangerously-skip-permissions',
      '--effort',
      'medium',
      '--effort',
      'high',
      '',
      '--foo',
      "it's",
    ]);
  });

  it('quotes a model value with spaces as one --model argument', () => {
    const command = new ClaudeAgent({
      model: 'opus --injected',
    }).launchCommand('x');
    expect(captureArgv('claude', command)).toEqual([
      'claude',
      'x',
      '--model',
      'opus --injected',
      '--dangerously-skip-permissions',
    ]);
  });

  it('does not append args for an empty prompt', () => {
    expect(
      new ClaudeAgent({ args: ['--effort', 'high'] }).launchCommand(''),
    ).toBe('claude');
  });

  it('omits generated --model/--effort when args already override them', () => {
    const command = new ClaudeAgent({
      model: 'sonnet',
      effort: 'medium',
      args: ['--model', 'opus', '--effort', 'high'],
    }).launchCommand('x');
    expect(captureArgv('claude', command)).toEqual([
      'claude',
      'x',
      '--dangerously-skip-permissions',
      '--model',
      'opus',
      '--effort',
      'high',
    ]);
  });

  it('recognizes --model=VALUE and --effort=VALUE overrides', () => {
    const command = new ClaudeAgent({
      model: 'sonnet',
      effort: 'low',
      args: ['--model=opus', '--effort=high'],
    }).launchCommand('x');
    expect(captureArgv('claude', command)).toEqual([
      'claude',
      'x',
      '--dangerously-skip-permissions',
      '--model=opus',
      '--effort=high',
    ]);
  });

  it('rejects a missing value on a recognized override', () => {
    expect(() => new ClaudeAgent({ args: ['--model'] })).toThrow(
      /--model requires a value/,
    );
    expect(() => new ClaudeAgent({ args: ['--effort'] })).toThrow(
      /--effort requires a value/,
    );
  });

  it('rejects reserved session and permission flags in every listed form', () => {
    for (const flag of [
      '--session-id',
      '--session-id=abc',
      '--dangerously-skip-permissions',
      '--allow-dangerously-skip-permissions',
      '--permission-mode',
      '--permission-mode=bypass',
    ]) {
      expect(() => new ClaudeAgent({ args: [flag] })).toThrow(/reserved flag/);
    }
  });

  it('rejects tilde-leading paths and long-option assignments whose value starts with ~', () => {
    expect(() => new ClaudeAgent({ args: ['~/settings.json'] })).toThrow(
      /absolute path/,
    );
    expect(
      () => new ClaudeAgent({ args: ['--settings=~/.bakers/claude.json'] }),
    ).toThrow(/absolute path/);
  });

  it('keeps an absolute path with spaces and an embedded tilde as literal args', () => {
    const command = new ClaudeAgent({
      args: ['--settings', '/home/cw/My Settings/a~b.json'],
    }).launchCommand('x');
    expect(captureArgv('claude', command)).toEqual([
      'claude',
      'x',
      '--dangerously-skip-permissions',
      '--settings',
      '/home/cw/My Settings/a~b.json',
    ]);
  });

  it('rejects non-array args, non-string members, NUL, and invalid skip_permissions', () => {
    expect(() => new ClaudeAgent({ args: '--effort' as never })).toThrow(
      /args must be an array of strings/,
    );
    expect(() => new ClaudeAgent({ args: [1 as never] })).toThrow(
      /args\[0\] must be a string/,
    );
    expect(() => new ClaudeAgent({ args: ['ok\0no'] })).toThrow(/NUL/);
    expect(() => new ClaudeAgent({ model: 'x\0y' })).toThrow(/NUL/);
    expect(() => new ClaudeAgent({ skip_permissions: 'yes' as never })).toThrow(
      /skip_permissions must be a boolean/,
    );
  });

  it('copies args so later caller mutation cannot introduce a reserved flag', () => {
    const args = ['--fallback-model', 'sonnet'];
    const agent = new ClaudeAgent({ args });
    args.push('--session-id');
    expect(agent.launchCommand('x')).not.toContain('--session-id');
  });

  it('omits the bypass flag when skip_permissions is false and still defaults to emitting it', () => {
    expect(
      captureArgv(
        'claude',
        new ClaudeAgent({ skip_permissions: false }).launchCommand('x'),
      ),
    ).toEqual(['claude', 'x']);
    expect(
      captureArgv('claude', new ClaudeAgent({}).launchCommand('x')),
    ).toEqual(['claude', 'x', '--dangerously-skip-permissions']);
    expect(
      captureArgv(
        'claude',
        new ClaudeAgent({ skip_permissions: true }).launchCommand('x'),
      ),
    ).toEqual(['claude', 'x', '--dangerously-skip-permissions']);
  });
});
