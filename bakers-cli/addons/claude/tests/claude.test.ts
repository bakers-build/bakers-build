import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASK_REDIRECT, shellQuote } from '@bakers-build/core';
import { describe, expect, it } from 'vitest';
import claudeAgentDefault, {
  ClaudeAgent,
  claudeAgent,
  encodeClaudeProjectDir,
} from '../src/index.js';

/** The ask hook's command: an older or missing `bakers` blocks the dialog. */
const ASK_COMMAND = `bakers hook ask-user-question || { echo '${ASK_REDIRECT}' >&2; exit 2; }`;

/** The hooks-only settings every mode without its own settings JSON carries. */
const HOOKS_JSON = JSON.stringify({
  hooks: {
    PreToolUse: [
      {
        matcher: 'AskUserQuestion',
        hooks: [{ type: 'command', command: ASK_COMMAND }],
      },
    ],
  },
});
const HOOKS_ARGV = ['--settings', HOOKS_JSON];
const HOOKS_FLAG = ` --settings ${shellQuote(HOOKS_JSON)}`;

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
    const agent = new ClaudeAgent({
      model: 'claude-opus-4-8',
      security: 'yolo',
    });
    expect(agent.launchCommand('do the thing')).toBe(
      `CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1 claude 'do the thing' --model 'claude-opus-4-8' --dangerously-skip-permissions${HOOKS_FLAG}`,
    );
  });
  it('omits --model when no model is set', () => {
    expect(new ClaudeAgent({ security: 'yolo' }).launchCommand('x')).toBe(
      `CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1 claude 'x' --dangerously-skip-permissions${HOOKS_FLAG}`,
    );
  });
  it('returns the bare command for an empty prompt', () => {
    expect(new ClaudeAgent({ security: 'yolo' }).launchCommand('')).toBe(
      'claude',
    );
  });
  it('POSIX-quotes a multi-line prompt for the sh-evaluated launch file', () => {
    const cmd = new ClaudeAgent({ security: 'yolo' }).launchCommand(
      'para one\n\npara two',
    );
    expect(cmd).toBe(
      `CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1 claude 'para one\n\npara two' --dangerously-skip-permissions${HOOKS_FLAG}`,
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
    const agent = new ClaudeAgent({ security: 'yolo' });
    const cmd = agent.launchCommand('do the thing', { sessionId: 'r-123' });
    expect(cmd).toBe(
      "CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1 claude 'do the thing' --dangerously-skip-permissions" +
        HOOKS_FLAG +
        ' --session-id r-123',
    );
  });
  it('omits --session-id when no run is given (unchanged behaviour)', () => {
    const agent = new ClaudeAgent({ security: 'yolo' });
    expect(agent.launchCommand('x')).toBe(
      `CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1 claude 'x' --dangerously-skip-permissions${HOOKS_FLAG}`,
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

describe('ClaudeAgent args and effort', () => {
  it('appends each args element as exactly one argv item, preserving order, duplicates and empty strings', () => {
    const agent = new ClaudeAgent({
      security: 'yolo',
      args: ['--effort', 'medium', '--effort', 'high', '', '--foo', "it's"],
    });
    const command = agent.launchCommand('task');
    // biome-ignore lint/suspicious/noControlCharactersInRegex: command must stay pty-safe
    expect(command).not.toMatch(/[\x00-\x1f\x7f]/);
    expect(captureArgv('claude', command)).toEqual([
      'claude',
      'task',
      '--dangerously-skip-permissions',
      ...HOOKS_ARGV,
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
      security: 'yolo',
      model: 'opus --injected',
    }).launchCommand('x');
    expect(captureArgv('claude', command)).toEqual([
      'claude',
      'x',
      '--model',
      'opus --injected',
      '--dangerously-skip-permissions',
      ...HOOKS_ARGV,
    ]);
  });

  it('does not append args for an empty prompt', () => {
    expect(
      new ClaudeAgent({ args: ['--effort', 'high'] }).launchCommand(''),
    ).toBe('claude');
  });

  it('omits generated --model/--effort when args already override them', () => {
    const command = new ClaudeAgent({
      security: 'yolo',
      model: 'sonnet',
      effort: 'medium',
      args: ['--model', 'opus', '--effort', 'high'],
    }).launchCommand('x');
    expect(captureArgv('claude', command)).toEqual([
      'claude',
      'x',
      '--dangerously-skip-permissions',
      ...HOOKS_ARGV,
      '--model',
      'opus',
      '--effort',
      'high',
    ]);
  });

  it('recognizes --model=VALUE and --effort=VALUE overrides', () => {
    const command = new ClaudeAgent({
      security: 'yolo',
      model: 'sonnet',
      effort: 'low',
      args: ['--model=opus', '--effort=high'],
    }).launchCommand('x');
    expect(captureArgv('claude', command)).toEqual([
      'claude',
      'x',
      '--dangerously-skip-permissions',
      ...HOOKS_ARGV,
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
      '--resume',
      '--dangerously-skip-permissions',
      '--allow-dangerously-skip-permissions',
      '--permission-mode',
      '--permission-mode=bypass',
      '--settings',
      '--settings={}',
      '--setting-sources',
      '--strict-mcp-config',
      '--mcp-config',
    ]) {
      expect(() => new ClaudeAgent({ args: [flag] })).toThrow(/reserved flag/);
    }
  });

  it('rejects tilde-leading paths and long-option assignments whose value starts with ~', () => {
    expect(() => new ClaudeAgent({ args: ['~/settings.json'] })).toThrow(
      /absolute path/,
    );
    expect(() => new ClaudeAgent({ args: ['--add-dir=~/.bakers'] })).toThrow(
      /absolute path/,
    );
  });

  it('keeps an absolute path with spaces and an embedded tilde as literal args', () => {
    const command = new ClaudeAgent({
      security: 'yolo',
      args: ['--add-dir', '/home/cw/My Settings/a~b.json'],
    }).launchCommand('x');
    expect(captureArgv('claude', command)).toEqual([
      'claude',
      'x',
      '--dangerously-skip-permissions',
      ...HOOKS_ARGV,
      '--add-dir',
      '/home/cw/My Settings/a~b.json',
    ]);
  });

  it('rejects non-array args, non-string members and NUL', () => {
    expect(() => new ClaudeAgent({ args: '--effort' as never })).toThrow(
      /args must be an array of strings/,
    );
    expect(() => new ClaudeAgent({ args: [1 as never] })).toThrow(
      /args\[0\] must be a string/,
    );
    expect(() => new ClaudeAgent({ args: ['ok\0no'] })).toThrow(/NUL/);
    expect(() => new ClaudeAgent({ model: 'x\0y' })).toThrow(/NUL/);
  });

  it('copies args so later caller mutation cannot introduce a reserved flag', () => {
    const args = ['--fallback-model', 'sonnet'];
    const agent = new ClaudeAgent({ args });
    args.push('--session-id');
    expect(agent.launchCommand('x')).not.toContain('--session-id');
  });
});

function flagValue(argv: string[], flag: string): string {
  const at = argv.indexOf(flag);
  expect(at, `${flag} present`).toBeGreaterThan(-1);
  return argv[at + 1] as string;
}

describe('ClaudeAgent security: sandbox (default)', () => {
  const argv = () =>
    captureArgv('claude', new ClaudeAgent({}).launchCommand('x'));

  it('starts without a bypass, in default mode, with project/local settings only and no MCP server', () => {
    const a = argv();
    expect(a).not.toContain('--dangerously-skip-permissions');
    expect(flagValue(a, '--permission-mode')).toBe('default');
    expect(flagValue(a, '--setting-sources')).toBe('project,local');
    expect(a).toContain('--strict-mcp-config');
    expect(JSON.parse(flagValue(a, '--mcp-config'))).toEqual({
      mcpServers: {},
    });
  });

  it('generates OS-sandbox settings that fail closed and deny reads of ~/.ssh and ~/.bakers', () => {
    const settings = JSON.parse(flagValue(argv(), '--settings'));
    expect(settings.sandbox).toEqual({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      excludedCommands: ['bakers *', 'git *', 'ddev *'],
      filesystem: { denyRead: ['~/.ssh', '~/.bakers'], allowWrite: [] },
      network: { allowedDomains: ['*'] },
    });
    expect(settings.disableClaudeAiConnectors).toBe(true);
    expect(settings.permissions.allow).toEqual([
      'Bash',
      'Edit(./**)',
      'AskUserQuestion',
    ]);
    expect(settings.permissions.deny).toEqual([
      'Read(~/.ssh)',
      'Read(~/.ssh/**)',
      'Read(~/.bakers)',
      'Read(~/.bakers/**)',
    ]);
  });

  it('replaces each default with the configured sandbox key, lists not merged', () => {
    const a = captureArgv(
      'claude',
      new ClaudeAgent({
        sandbox: {
          trusted_commands: ['git', 'docker compose *'],
          deny_read: ['~/.aws', '/etc/secret', '~/.netrc'],
          allow_write: ['/srv/cache'],
          network: ['api.anthropic.com'],
          mcp_servers: { playwright: { command: 'npx', args: ['pw-mcp'] } },
        },
      }).launchCommand('x'),
    );
    const settings = JSON.parse(flagValue(a, '--settings'));
    expect(settings.sandbox.excludedCommands).toEqual([
      'git *',
      'docker compose *',
    ]);
    expect(settings.sandbox.filesystem).toEqual({
      denyRead: ['~/.aws', '/etc/secret', '~/.netrc'],
      allowWrite: ['/srv/cache'],
    });
    expect(settings.sandbox.network.allowedDomains).toEqual([
      'api.anthropic.com',
    ]);
    // A file entry is covered by itself; an absolute path takes `//`.
    expect(settings.permissions.deny).toEqual([
      'Read(~/.aws)',
      'Read(~/.aws/**)',
      'Read(//etc/secret)',
      'Read(//etc/secret/**)',
      'Read(~/.netrc)',
      'Read(~/.netrc/**)',
    ]);
    expect(JSON.parse(flagValue(a, '--mcp-config'))).toEqual({
      mcpServers: { playwright: { command: 'npx', args: ['pw-mcp'] } },
    });
  });

  it('exposes a dropping env policy with the default deny list, or env_deny', () => {
    expect(new ClaudeAgent({}).runEnvPolicy).toEqual({
      drop: true,
      deny: expect.arrayContaining(['ANTHROPIC_*', 'NODE_OPTIONS', 'GIT_*']),
    });
    expect(new ClaudeAgent({ env_deny: ['X_*'] }).runEnvPolicy).toEqual({
      drop: true,
      deny: ['X_*'],
    });
  });
});

describe('ClaudeAgent security: system, yolo, custom', () => {
  it('system adds only the hooks settings', () => {
    expect(
      captureArgv(
        'claude',
        new ClaudeAgent({ security: 'system' }).launchCommand('x'),
      ),
    ).toEqual(['claude', 'x', ...HOOKS_ARGV]);
  });

  it("yolo restores today's bypass launch and keeps denied env vars", () => {
    const agent = new ClaudeAgent({ security: 'yolo' });
    expect(captureArgv('claude', agent.launchCommand('x'))).toEqual([
      'claude',
      'x',
      '--dangerously-skip-permissions',
      ...HOOKS_ARGV,
    ]);
    expect(agent.runEnvPolicy.drop).toBe(false);
  });

  it('custom passes config as the only settings, plus the ask hook', () => {
    const config = { permissions: { defaultMode: 'acceptEdits' } };
    const a = captureArgv(
      'claude',
      new ClaudeAgent({ security: 'custom', config }).launchCommand('x'),
    );
    expect(a).toEqual([
      'claude',
      'x',
      '--settings',
      JSON.stringify({ ...config, ...JSON.parse(HOOKS_JSON) }),
    ]);
  });
});

describe('ClaudeAgent security load errors', () => {
  it.each([
    [{ skip_permissions: true }, /security: 'yolo'/],
    [{ security: 'open' }, /security must be one of/],
    [
      { security: 'yolo', config: {} },
      /config is only valid with security: 'custom'/,
    ],
    [{ security: 'custom' }, /security: 'custom' requires config/],
    [
      { security: 'system', sandbox: {} },
      /sandbox is only valid with security: 'sandbox'/,
    ],
    [
      { sandbox: { network: 'all' } },
      /sandbox.network must be an array of strings/,
    ],
    [{ sandbox: { nope: [] } }, /unknown sandbox key nope/],
    [{ env_deny: 'X' }, /env_deny must be an array of strings/],
  ])('%j fails loading', (options, message) => {
    expect(() => new ClaudeAgent(options as never)).toThrow(message);
  });
});

describe('ClaudeAgent.sandboxPreflight', () => {
  const host = (
    over: Partial<{
      platform: NodeJS.Platform;
      tools: string[];
      probe: { ok: boolean; stderr: string };
    }> = {},
  ) => {
    const calls: string[][] = [];
    const tools = over.tools ?? ['bwrap', 'socat', 'apt-get'];
    return {
      calls,
      host: {
        platform: over.platform ?? ('linux' as NodeJS.Platform),
        onPath: (name: string) => tools.includes(name),
        run: async (cmd: string, args: string[]) => {
          calls.push([cmd, ...args]);
          return over.probe ?? { ok: true, stderr: '' };
        },
      },
    };
  };

  it('names a missing socat and the apt install command', async () => {
    const { host: h } = host({ tools: ['bwrap', 'apt-get'] });
    expect(await new ClaudeAgent().sandboxPreflight(h)).toEqual({
      ok: false,
      cause: 'socat not found',
      fix: 'install it with sudo apt-get install -y socat',
    });
  });

  it('names both tools and the dnf command when bwrap and socat are missing', async () => {
    const { host: h, calls } = host({ tools: ['dnf'] });
    expect(await new ClaudeAgent().sandboxPreflight(h)).toEqual({
      ok: false,
      cause: 'bwrap and socat not found',
      fix: 'install it with sudo dnf install -y bubblewrap socat',
    });
    expect(calls).toEqual([]);
  });

  it('reports a refused user namespace from the bwrap probe', async () => {
    const { host: h } = host({
      probe: {
        ok: false,
        stderr:
          'bwrap: No permissions to create a new namespace, likely because the kernel does not allow non-privileged user namespaces.\n',
      },
    });
    const result = await new ClaudeAgent().sandboxPreflight(h);
    expect(result).toMatchObject({
      ok: false,
      cause:
        'bwrap cannot set up its sandbox: bwrap: No permissions to create a new namespace, likely because the kernel does not allow non-privileged user namespaces.',
    });
    expect(result.ok ? '' : result.fix).toContain('user namespaces');
  });

  it('is ok when both tools are present and the probe starts', async () => {
    const { host: h, calls } = host();
    expect(await new ClaudeAgent().sandboxPreflight(h)).toEqual({ ok: true });
    expect(calls[0]?.slice(0, 2)).toEqual(['bwrap', '--unshare-user']);
  });

  it.each([
    'system',
    'yolo',
  ] as const)('skips the probe in %s mode', async (security) => {
    const { host: h, calls } = host({ tools: [] });
    expect(await new ClaudeAgent({ security }).sandboxPreflight(h)).toEqual({
      ok: true,
    });
    expect(calls).toEqual([]);
  });

  it('skips the probe in custom mode', async () => {
    const { host: h } = host({ tools: [] });
    expect(
      await new ClaudeAgent({
        security: 'custom',
        config: {},
      }).sandboxPreflight(h),
    ).toEqual({ ok: true });
  });

  it('skips the probe on macOS (Seatbelt is built in)', async () => {
    const { host: h } = host({ platform: 'darwin', tools: [] });
    expect(await new ClaudeAgent().sandboxPreflight(h)).toEqual({ ok: true });
  });
});

describe('ClaudeAgent redirects the terminal dialog to the ticket question', () => {
  const askHook = {
    matcher: 'AskUserQuestion',
    hooks: [{ type: 'command', command: ASK_COMMAND }],
  };
  const settingsOf = (options: Record<string, unknown>) =>
    JSON.parse(
      flagValue(
        captureArgv(
          'claude',
          new ClaudeAgent(options as never).launchCommand('x'),
        ),
        '--settings',
      ),
    );

  it.each([
    ['sandbox', {}],
    ['system', { security: 'system' }],
    ['yolo', { security: 'yolo' }],
    [
      'custom',
      {
        security: 'custom',
        config: { permissions: { defaultMode: 'acceptEdits' } },
      },
    ],
  ])('%s carries the AskUserQuestion PreToolUse hook', (_mode, options) => {
    expect(settingsOf(options).hooks.PreToolUse).toContainEqual(askHook);
  });

  it('blocks the dialog with the redirect when the hook cannot run', () => {
    const command = settingsOf({}).hooks.PreToolUse.at(-1).hooks[0].command;
    let status = 0;
    let stderr = '';
    try {
      execFileSync('/bin/sh', ['-c', command], {
        env: { PATH: '/nonexistent' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      status = (error as { status: number }).status;
      stderr = String((error as { stderr: Buffer }).stderr);
    }
    expect(status).toBe(2);
    expect(stderr).toContain('# Question');
    expect(stderr).toContain('bakers_ticket_update');
  });

  it('passes the hook decision through when bakers answers', async () => {
    const bin = await mkdtemp(join(tmpdir(), 'bakers-hook-'));
    await writeFile(join(bin, 'bakers'), '#!/bin/sh\necho decided\n', {
      mode: 0o755,
    });
    const command = settingsOf({}).hooks.PreToolUse.at(-1).hooks[0].command;
    const out = execFileSync('/bin/sh', ['-c', command], {
      env: { PATH: `${bin}:/usr/bin:/bin` },
    });
    expect(String(out).trim()).toBe('decided');
  });

  it('keeps the terminal dialog allowed for interactive runs', () => {
    expect(settingsOf({}).permissions.allow).toContain('AskUserQuestion');
  });

  it("keeps a custom config's own hooks and settings", () => {
    const own = {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'audit' }],
    };
    const settings = settingsOf({
      security: 'custom',
      config: {
        permissions: { defaultMode: 'acceptEdits' },
        hooks: { PreToolUse: [own], Stop: [own] },
      },
    });
    expect(settings.permissions).toEqual({ defaultMode: 'acceptEdits' });
    expect(settings.hooks.PreToolUse).toEqual([own, askHook]);
    expect(settings.hooks.Stop).toEqual([own]);
  });
});

describe('ClaudeAgent resumes an earlier session', () => {
  it('forks the earlier session into the run’s own pinned session', () => {
    const a = captureArgv(
      'claude',
      new ClaudeAgent({ security: 'system' }).launchCommand('x', {
        sessionId: 'r-2',
        resumeSessionId: 'r-1',
      }),
    );
    expect(flagValue(a, '--resume')).toBe('r-1');
    expect(a).toContain('--fork-session');
    expect(flagValue(a, '--session-id')).toBe('r-2');
  });

  it('records only the resumed run’s own turns, not the forked earlier ones or the wait', async () => {
    const home = await mkdtemp(join(tmpdir(), 'claude-home-'));
    const cwd = '/srv/ws/PROJ-RESUME';
    const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd));
    await mkdir(dir, { recursive: true });
    const turn = (timestamp: string, text: string, output_tokens: number) =>
      JSON.stringify({
        type: 'assistant',
        timestamp,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text }],
          usage: { output_tokens },
        },
      });
    const prompt = (timestamp: string, content: string) =>
      JSON.stringify({
        type: 'user',
        timestamp,
        message: { role: 'user', content },
      });
    // `--fork-session` copies the asking run's turns, with their original
    // timestamps, into the new run's own file before its first turn.
    await writeFile(
      join(dir, 'r-2.jsonl'),
      [
        prompt('2026-01-01T09:00:00Z', 'work the ticket'),
        turn('2026-01-01T09:10:00Z', 'I have a question', 1000),
        prompt('2026-01-01T12:00:00Z', 'continue'),
        turn('2026-01-01T12:00:30Z', 'using the answer', 7),
      ].join('\n'),
    );
    const agent = new ClaudeAgent({}, home);
    const log = await agent.getRunLog(cwd, {
      sessionId: 'r-1',
      attemptFamily: ['r-1', 'r-2'],
      startedAt: new Date('2026-01-01T11:59:59Z'),
    });
    const footprint = agent.parseFootprint(log);
    expect(footprint.tokens).toBe(7);
    expect(footprint.agent_turns).toBe(1);
    expect(footprint.duration_s).toBe(30);
  });
});
