import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
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
    const agent = new ClaudeAgent({
      model: 'claude-opus-4-8',
      security: 'yolo',
    });
    expect(agent.launchCommand('do the thing')).toBe(
      "CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1 claude 'do the thing' --model 'claude-opus-4-8' --dangerously-skip-permissions",
    );
  });
  it('omits --model when no model is set', () => {
    expect(new ClaudeAgent({ security: 'yolo' }).launchCommand('x')).toBe(
      "CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1 claude 'x' --dangerously-skip-permissions",
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
      "CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1 claude 'para one\n\npara two' --dangerously-skip-permissions",
    );
  });
});

describe('ClaudeAgent.launchCommand in a worktree', () => {
  const trust = fileURLToPath(
    new URL('../trust/claude-trust.mjs', import.meta.url),
  );
  const measure = fileURLToPath(
    new URL('../measure/claude-measure.mjs', import.meta.url),
  );

  it('trusts the worktree through the trust wrapper before claude starts', () => {
    expect(
      new ClaudeAgent({ security: 'yolo' }).launchCommand(
        'x',
        undefined,
        "/w/it's",
      ),
    ).toBe(
      `CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1 node '${trust}' '/w/it'\\''s' claude 'x' --dangerously-skip-permissions`,
    );
  });
  it('puts the trust wrapper in front of the measure wrapper', () => {
    expect(
      new ClaudeAgent({ security: 'yolo', measure: true }).launchCommand(
        'x',
        undefined,
        '/w',
      ),
    ).toMatch(
      `CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1 node '${trust}' '/w' node '${measure}' claude 'x'`,
    );
  });
  it('trusts nothing without a worktree or a prompt', () => {
    const agent = new ClaudeAgent({ security: 'yolo' });
    expect(agent.launchCommand('x')).not.toContain('claude-trust');
    expect(agent.launchCommand('', undefined, '/w')).toBe('claude');
  });
  it('runs its node:test suite', () => {
    execFileSync(
      process.execPath,
      ['--test', trust.replace(/\.mjs$/, '.test.mjs')],
      { stdio: 'pipe' },
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
      "CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1 claude 'do the thing' --dangerously-skip-permissions --session-id r-123",
    );
  });
  it('omits --session-id when no run is given (unchanged behaviour)', () => {
    const agent = new ClaudeAgent({ security: 'yolo' });
    expect(agent.launchCommand('x')).toBe(
      "CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1 claude 'x' --dangerously-skip-permissions",
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

describe('ClaudeAgent security: shared project and machine layers', () => {
  const shared_security = {
    project: { sandbox: { trusted_commands: ['$inherit', 'make'] } },
    machine: {
      sandbox: {
        allow_write: ['/srv/cache'],
        deny_read: ['$inherit', '~/.aws'],
      },
    },
  };

  it('applies them in the generated settings and reports their sources', async () => {
    const plugin = claudeAgent({ shared_security } as never);
    const agent = await plugin.createAgent({} as never);
    const settings = JSON.parse(
      flagValue(captureArgv('claude', agent.launchCommand('x')), '--settings'),
    );
    expect(settings.sandbox.excludedCommands).toEqual([
      'bakers *',
      'git *',
      'make *',
    ]);
    expect(settings.sandbox.filesystem.allowWrite).toEqual(['/srv/cache']);
    expect(settings.sandbox.filesystem.denyRead).toEqual([
      '~/.ssh',
      '~/.bakers',
      '~/.aws',
    ]);
    expect(settings.permissions.deny).toContain('Read(~/.aws/**)');
    expect(plugin.security?.sandbox.trusted_commands.entries).toContainEqual({
      value: 'make',
      source: 'project',
    });
  });
});

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
      excludedCommands: ['bakers *', 'git *'],
      filesystem: {
        denyRead: ['~/.ssh', '~/.bakers'],
        allowWrite: [],
        denyWrite: [],
      },
      network: { allowedDomains: ['*'] },
    });
    expect(settings.disableClaudeAiConnectors).toBe(true);
    // The conductor's server binds every call to the run, so its tools need no prompt.
    expect(settings.permissions.allow).toEqual([
      'Bash',
      'Edit(./**)',
      'AskUserQuestion',
      'mcp__bakers',
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
          trusted_commands: ['git', 'make', 'docker compose *'],
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
      'make *',
      'docker compose *',
    ]);
    expect(settings.sandbox.filesystem).toEqual({
      denyRead: ['~/.aws', '/etc/secret', '~/.netrc'],
      allowWrite: ['/srv/cache'],
      denyWrite: [],
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

  it('grants the worktree its own Git metadata, never the shared Git dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'claude-git-'));
    const main = join(dir, 'main');
    const worktree = join(dir, 'work');
    try {
      execFileSync('git', ['init', '-q', main]);
      execFileSync('git', [
        '-C',
        main,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '--allow-empty',
        '-qm',
        'initial',
      ]);
      execFileSync('git', [
        '-C',
        main,
        'worktree',
        'add',
        '-qb',
        't',
        worktree,
      ]);
      const common = execFileSync(
        'git',
        ['-C', main, 'rev-parse', '--path-format=absolute', '--git-dir'],
        { encoding: 'utf8' },
      ).trim();
      const launch = (path: string) =>
        captureArgv(
          'claude',
          new ClaudeAgent({
            sandbox: { allow_write: ['/srv/cache'] },
          }).launchCommand('x', undefined, path, {
            url: 'http://127.0.0.1:4100',
          }),
        );
      const filesystem = (path: string) =>
        JSON.parse(flagValue(launch(path), '--settings')).sandbox.filesystem;
      // Git grants and conductor tools combine in one sandboxed launch.
      expect(
        JSON.parse(flagValue(launch(worktree), '--mcp-config')).mcpServers,
      ).toHaveProperty('bakers');
      const own = join(common, 'worktrees', 'work');
      expect(filesystem(worktree).allowWrite).toEqual([
        '/srv/cache',
        own,
        join(common, 'objects'),
        join(common, 'refs'),
        join(common, 'logs'),
      ]);
      // The redirects inside the own git dir stay unwritable.
      expect(filesystem(worktree).denyWrite).toEqual([
        join(own, 'commondir'),
        join(own, 'gitdir'),
      ]);
      expect(filesystem(main).allowWrite).toEqual(['/srv/cache', common]);
      expect(filesystem(main).denyWrite).toEqual([
        join(common, 'config'),
        join(common, 'hooks'),
        join(common, 'worktrees'),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ignores an allow_write entry in a Git directory with one warning each', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const settings = JSON.parse(
        flagValue(
          captureArgv(
            'claude',
            new ClaudeAgent({
              sandbox: { allow_write: ['/repo/.git', '/srv/cache'] },
            }).launchCommand('x'),
          ),
          '--settings',
        ),
      );
      expect(settings.sandbox.filesystem.allowWrite).toEqual(['/srv/cache']);
      expect(warn.mock.calls.map(([m]) => m)).toEqual([
        expect.stringContaining('/repo/.git;'),
      ]);
    } finally {
      warn.mockRestore();
    }
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
  it('system adds no security flag', () => {
    expect(
      captureArgv(
        'claude',
        new ClaudeAgent({ security: 'system' }).launchCommand('x'),
      ),
    ).toEqual(['claude', 'x']);
  });

  it("yolo restores today's bypass launch and keeps denied env vars", () => {
    const agent = new ClaudeAgent({ security: 'yolo' });
    expect(captureArgv('claude', agent.launchCommand('x'))).toEqual([
      'claude',
      'x',
      '--dangerously-skip-permissions',
    ]);
    expect(agent.runEnvPolicy.drop).toBe(false);
  });

  it('custom passes config verbatim as the only settings', () => {
    const config = { permissions: { defaultMode: 'acceptEdits' } };
    const a = captureArgv(
      'claude',
      new ClaudeAgent({ security: 'custom', config }).launchCommand('x'),
    );
    expect(a).toEqual(['claude', 'x', '--settings', JSON.stringify(config)]);
  });
});

describe('ClaudeAgent conductor tools', () => {
  const tools = { url: 'http://127.0.0.1:4100' };
  const conductorServer = {
    type: 'http',
    url: 'http://127.0.0.1:4100',
    headers: { Authorization: 'Bearer ${BB_CONDUCTOR_TOKEN}' },
  };
  const launch = (agent: ClaudeAgent) =>
    captureArgv(
      'claude',
      agent.launchCommand('x', undefined, undefined, tools),
    );

  it('merges the bakers server into the sandbox MCP config, the token by env reference only', () => {
    const agent = new ClaudeAgent({
      sandbox: { mcp_servers: { playwright: { command: 'npx' } } },
    });
    const a = launch(agent);
    expect(a).toContain('--strict-mcp-config');
    expect(JSON.parse(flagValue(a, '--mcp-config'))).toEqual({
      mcpServers: {
        playwright: { command: 'npx' },
        bakers: conductorServer,
      },
    });
    expect(agent.launchWarnings).toEqual([]);
  });

  it("replaces a sandbox MCP server named bakers with the conductor's, and warns", () => {
    const agent = new ClaudeAgent({
      sandbox: { mcp_servers: { bakers: { command: 'old-bakers-mcp' } } },
    });
    expect(JSON.parse(flagValue(launch(agent), '--mcp-config'))).toEqual({
      mcpServers: { bakers: conductorServer },
    });
    expect(agent.launchWarnings).toEqual([
      "sandbox.mcp_servers.bakers is replaced by the conductor's bakers server",
    ]);
  });

  it('keeps a sandbox MCP server named bakers, without a warning, in a run without the conductor server', () => {
    const agent = new ClaudeAgent({
      sandbox: { mcp_servers: { bakers: { command: 'old-bakers-mcp' } } },
    });
    const a = captureArgv('claude', agent.launchCommand('x'));
    expect(JSON.parse(flagValue(a, '--mcp-config'))).toEqual({
      mcpServers: { bakers: { command: 'old-bakers-mcp' } },
    });
    expect(agent.launchWarnings).toEqual([]);
  });

  it('adds the bakers server in the system, yolo and custom modes too', () => {
    for (const options of [
      { security: 'system' },
      { security: 'yolo' },
      { security: 'custom', config: {} },
    ] as const) {
      const a = launch(new ClaudeAgent(options));
      expect(a).not.toContain('--strict-mcp-config');
      expect(JSON.parse(flagValue(a, '--mcp-config'))).toEqual({
        mcpServers: { bakers: conductorServer },
      });
    }
  });

  it('leaves a measured run without MCP servers', () => {
    const command = new ClaudeAgent({
      security: 'system',
      measure: true,
    }).launchCommand('x', undefined, '/w', tools);
    expect(command).not.toContain('127.0.0.1:4100');
    expect(command).toContain(`'--mcp-config' '{"mcpServers":{}}'`);
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
