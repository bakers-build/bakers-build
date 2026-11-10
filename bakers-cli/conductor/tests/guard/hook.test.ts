// The PreToolUse hook both harnesses call before a shell command (AC-6).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runHook } from '../../src/guard/hook.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'bb-guard-hook-')));
const worktree = join(root, 'wt');
mkdirSync(worktree);

function env(extra: Record<string, string> = {}) {
  return {
    BAKERS_WORKTREE: worktree,
    BAKERS_BRANCH: 'feat/x-1',
    BAKERS_GUARD_LOG: join(root, `guard-${Math.random()}.jsonl`),
    TMPDIR: join(root, 'tmp'),
    HOME: join(root, 'home'),
    ...extra,
  };
}

const claudeInput = (command: string) =>
  JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    cwd: worktree,
  });

describe('guard hook', () => {
  it('lets an allowed command run, writing nothing', () => {
    const e = env();
    const out = runHook(claudeInput('git status'), e);
    expect(out).toEqual({ exitCode: 0, stderr: '' });
    expect(() => readFileSync(e.BAKERS_GUARD_LOG)).toThrow();
  });

  it('blocks a refused command with the rule and alternative, and logs it', () => {
    const e = env();
    const out = runHook(claudeInput('git push --force'), e);
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toMatch(/bakers run guard refused/);
    expect(out.stderr).toMatch(/git-push/);
    expect(out.stderr).toMatch(/git push origin HEAD:feat\/x-1/);
    const lines = readFileSync(e.BAKERS_GUARD_LOG, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      command: 'git push --force',
      rule: 'git-push',
    });
  });

  it('reads a Codex shell call given as an argv list', () => {
    const out = runHook(
      JSON.stringify({
        tool_name: 'shell',
        tool_input: { command: ['rm', '-rf', '/etc'] },
        cwd: worktree,
      }),
      env(),
    );
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toMatch(/delete-outside/);
  });

  it('reads a shell call whose argv comes as cmd', () => {
    const out = runHook(
      JSON.stringify({
        tool_name: 'exec_command',
        tool_input: { cmd: ['rm', '-rf', '/etc'] },
        cwd: worktree,
      }),
      env(),
    );
    expect(out.exitCode).toBe(2);
  });

  it('pushes HEAD only while the worktree is on an owned branch', () => {
    const repo = join(root, 'repo');
    mkdirSync(repo);
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    const push = (on: string) => {
      execFileSync('git', ['-C', repo, 'checkout', '-q', '-B', on]);
      return runHook(
        JSON.stringify({
          tool_name: 'Bash',
          tool_input: { command: 'git push -u origin HEAD' },
          cwd: repo,
        }),
        env({ BAKERS_WORKTREE: repo }),
      ).exitCode;
    };
    expect(push('feat/x-1')).toBe(0);
    expect(push('main')).toBe(2);
  });

  it('ignores a tool that is not a shell', () => {
    const out = runHook(
      JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/x' } }),
      env(),
    );
    expect(out.exitCode).toBe(0);
  });

  it('on its own failure, blocks only destructive verbs', () => {
    expect(runHook('{not json', env()).exitCode).toBe(0);
    expect(runHook('{"cmd": "git push -f', env()).exitCode).toBe(2);
    expect(
      runHook(claudeInput('ls -la'), { ...env(), BAKERS_WORKTREE: '' }).exitCode,
    ).toBe(0);
    expect(
      runHook(claudeInput('rm x'), { ...env(), BAKERS_WORKTREE: '' }).exitCode,
    ).toBe(2);
  });
});
