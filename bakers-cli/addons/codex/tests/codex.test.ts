import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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
    const agent = new CodexAgent({ model: 'gpt-5', security: 'yolo' });
    expect(agent.launchCommand('do the thing')).toBe(
      "codex --sandbox danger-full-access --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust --model 'gpt-5' 'do the thing'",
    );
  });

  it('omits --model when no model is set', () => {
    expect(new CodexAgent({ security: 'yolo' }).launchCommand('x')).toBe(
      "codex --sandbox danger-full-access --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust 'x'",
    );
  });

  it('returns codex with run flags for an empty prompt', () => {
    expect(new CodexAgent({ security: 'yolo' }).launchCommand('')).toBe(
      'codex --sandbox danger-full-access --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust',
    );
  });

  it('POSIX-quotes a multi-line prompt for the sh-evaluated launch file', () => {
    const cmd = new CodexAgent({ security: 'yolo' }).launchCommand(
      'para one\n\npara two',
    );
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
      security: 'yolo',
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
      security: 'yolo',
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
      security: 'yolo',
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
      security: 'yolo',
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
      '-a',
      '--ask-for-approval',
      '--ask-for-approval=never',
    ]) {
      expect(() => new CodexAgent({ args: [flag] })).toThrow(/reserved flag/);
    }
  });

  it('does not append args for an empty prompt', () => {
    const command = new CodexAgent({
      security: 'yolo',
      args: ['--foo'],
    }).launchCommand('');
    expect(command).not.toContain('--foo');
  });
});

/** The profile's absolute-path filesystem entries: path → access. */
function gitEntries(profile: string | undefined): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const m of (profile ?? '').matchAll(
    /("(?:[^"\\]|\\.)*") = "(read|write)"/g,
  )) {
    const path = JSON.parse(m[1] as string) as string;
    if (path.startsWith('/')) entries[path] = m[2] as string;
  }
  return entries;
}

/**
 * A Git write grant. Codex mounts a read-only `.git`, `.agents`, `.codex` and
 * `.aws` into every writable entry, creating each missing one in the real
 * repository; granting them write is what stops it.
 */
function grant(root: string): Record<string, string> {
  return Object.fromEntries(
    ['', '/.git', '/.agents', '/.codex', '/.aws'].map((name) => [
      `${root}${name}`,
      'write',
    ]),
  );
}

async function homeWithCodexMcp(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'codex-home-'));
  await mkdir(join(home, '.codex'), { recursive: true });
  await writeFile(
    join(home, '.codex', 'config.toml'),
    [
      'model = "gpt-5"',
      '[mcp_servers.gitlab]',
      'command = "gitlab-mcp"',
      '[mcp_servers.gitlab.env]',
      'TOKEN = "x"',
      '[mcp_servers.playwright]',
      'command = "npx"',
    ].join('\n'),
  );
  return home;
}

describe('CodexAgent security: sandbox (default)', () => {
  it('grants Git metadata writes for the dispatched worktree without granting its parent repository', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-git-'));
    const main = join(dir, 'main "quoted" $name\nsecond line');
    const worktree = join(dir, 'work "quoted" $name');
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
        'test',
        worktree,
      ]);
      const argv = captureArgv(
        'codex',
        new CodexAgent().launchCommand('x', undefined, worktree),
      );
      const profile = argv.find((arg) => arg.startsWith('permissions.bakers='));
      expect(argv).toContain('default_permissions="bakers"');
      expect(profile).toContain('extends = ":workspace"');
      const common = join(main, '.git');
      const own = execFileSync(
        'git',
        ['-C', worktree, 'rev-parse', '--path-format=absolute', '--git-dir'],
        { encoding: 'utf8' },
      ).replace(/\n$/, '');
      expect(own.startsWith(join(common, 'worktrees'))).toBe(true);
      // The run writes its own git dir and the shared objects, refs and reflogs.
      expect(gitEntries(profile)).toEqual({
        ...grant(own),
        ...grant(join(common, 'objects')),
        ...grant(join(common, 'refs')),
        ...grant(join(common, 'logs')),
        // Redirects an unsandboxed Git command follows stay read-only.
        [join(own, 'commondir')]: 'read',
        [join(own, 'gitdir')]: 'read',
      });
      expect(profile).not.toMatch(/"\.(codex|agents|aws)"\s*=\s*"write"/);
      for (const path of ['.git', '.codex', '.agents', '.aws']) {
        expect(profile).toContain(`${JSON.stringify(path)} = "read"`);
      }
      expect(argv).not.toContain('--sandbox');
      expect(argv).not.toContain('--dangerously-bypass-approvals-and-sandbox');
      expect(argv).toContain('never');
      const mainArgv = captureArgv(
        'codex',
        new CodexAgent().launchCommand('x', undefined, main),
      );
      // Only protected entries that exist: no placeholder for bwrap to create.
      expect(
        gitEntries(
          mainArgv.find((arg) => arg.startsWith('permissions.bakers=')),
        ),
      ).toEqual({
        ...grant(common),
        [join(common, 'config')]: 'read',
        [join(common, 'hooks')]: 'read',
        [join(common, 'worktrees')]: 'read',
      });
      expect(() =>
        new CodexAgent().launchCommand('x', undefined, join(dir, 'missing')),
      ).toThrow(/Cannot resolve workspace Git directories/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('extends workspace permissions without approvals, bypass flags or the user MCP servers', async () => {
    const home = await homeWithCodexMcp();
    expect(
      captureArgv(
        'codex',
        new CodexAgent({}, home).launchCommand('x', undefined, home),
      ),
    ).toEqual([
      'codex',
      '-a',
      'never',
      '-c',
      'default_permissions="bakers"',
      '-c',
      'permissions.bakers={ extends = ":workspace", filesystem = { ":workspace_roots" = { ".git" = "read", ".agents" = "read", ".codex" = "read", ".aws" = "read" } }, workspace_roots = {  }, network = { enabled = true } }',
      '-c',
      'mcp_servers.gitlab.enabled=false',
      '-c',
      'mcp_servers.playwright.enabled=false',
      'x',
    ]);
  });

  it('keeps allowed MCP servers, adds workspace roots for allow_write and turns network off for []', async () => {
    const home = await homeWithCodexMcp();
    const argv = captureArgv(
      'codex',
      new CodexAgent(
        {
          sandbox: {
            mcp_servers: { playwright: {} },
            allow_write: ['/srv/cache', '~/.cache/pnpm'],
            network: [],
          },
        },
        home,
      ).launchCommand('x'),
    );
    expect(argv.join(' ')).toContain('network = { enabled = false }');
    expect(argv).toContain('mcp_servers.gitlab.enabled=false');
    expect(argv).not.toContain('mcp_servers.playwright.enabled=false');
    expect(argv.join(' ')).toContain(
      `workspace_roots = { "/srv/cache" = true, ${JSON.stringify(join(home, '.cache/pnpm'))} = true }`,
    );
  });

  it('ignores an allow_write entry in a Git directory with one warning each', async () => {
    const home = await homeWithCodexMcp();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const argv = captureArgv(
        'codex',
        new CodexAgent(
          {
            sandbox: {
              allow_write: ['/repo/.git', '/srv/cache', '/repo/.git/objects'],
            },
          },
          home,
        ).launchCommand('x', undefined, home),
      );
      expect(argv.join(' ')).toContain(
        'workspace_roots = { "/srv/cache" = true }',
      );
      expect(warn.mock.calls.map(([m]) => m)).toEqual([
        expect.stringContaining('/repo/.git;'),
        expect.stringContaining('/repo/.git/objects;'),
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it('disables user servers in every TOML form, including prototype-like names', async () => {
    const home = await mkdtemp(join(tmpdir(), 'codex-home-'));
    await mkdir(join(home, '.codex'), { recursive: true });
    await writeFile(
      join(home, '.codex', 'config.toml'),
      [
        'mcp_servers.gamma.command = "echo"',
        "[mcp_servers.'delta']",
        'command = "echo"',
        '[mcp_servers.toString]',
        'command = "echo"',
        '[mcp_servers]',
        'beta = { command = "echo" }',
        'eps.command = "echo"',
        '# [mcp_servers.commented]',
      ].join('\n'),
    );
    const argv = captureArgv(
      'codex',
      new CodexAgent({}, home).launchCommand('x'),
    );
    expect(argv.filter((a) => a.startsWith('mcp_servers.')).sort()).toEqual([
      'mcp_servers.beta.enabled=false',
      'mcp_servers.delta.enabled=false',
      'mcp_servers.eps.enabled=false',
      'mcp_servers.gamma.enabled=false',
      'mcp_servers.toString.enabled=false',
    ]);
  });

  it('reads the config under CODEX_HOME', async () => {
    const home = await homeWithCodexMcp();
    vi.stubEnv('CODEX_HOME', join(home, '.codex'));
    try {
      const argv = captureArgv(
        'codex',
        new CodexAgent({}, '/nonexistent-home').launchCommand('x'),
      );
      expect(argv).toContain('mcp_servers.gitlab.enabled=false');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    ['mcp_servers = { a = { command = "echo" } }'],
    ['[mcp_servers."my.srv"]'],
    ['[[mcp_servers]]'],
  ])('refuses to launch when it cannot disable a server: %s', async (line) => {
    const home = await mkdtemp(join(tmpdir(), 'codex-home-'));
    await mkdir(join(home, '.codex'), { recursive: true });
    await writeFile(join(home, '.codex', 'config.toml'), line);
    expect(() => new CodexAgent({}, home).launchCommand('x')).toThrow(
      /mcp_servers/,
    );
  });

  it('runs without a Codex config file', () => {
    const argv = captureArgv(
      'codex',
      new CodexAgent({}, '/nonexistent-home').launchCommand('x'),
    );
    expect(argv.some((a) => a.startsWith('mcp_servers.'))).toBe(false);
  });

  it('drops denied env vars, or keeps them in yolo', () => {
    expect(new CodexAgent({}).runEnvPolicy.drop).toBe(true);
    expect(new CodexAgent({ security: 'yolo' }).runEnvPolicy.drop).toBe(false);
    expect(new CodexAgent({ env_deny: [] }).runEnvPolicy.deny).toEqual([]);
  });
});

describe('CodexAgent security: system, yolo, custom', () => {
  it('system adds no security flag', () => {
    expect(
      captureArgv(
        'codex',
        new CodexAgent({ security: 'system' }).launchCommand('x'),
      ),
    ).toEqual(['codex', 'x']);
  });

  it('custom passes each config entry as one -c key=value', () => {
    expect(
      captureArgv(
        'codex',
        new CodexAgent({
          security: 'custom',
          config: {
            sandbox_mode: 'read-only',
            'sandbox_workspace_write.writable_roots': ['/a'],
          },
        }).launchCommand('x'),
      ),
    ).toEqual([
      'codex',
      '-c',
      'sandbox_mode=read-only',
      '-c',
      'sandbox_workspace_write.writable_roots=["/a"]',
      'x',
    ]);
  });
});

describe('CodexAgent security load errors', () => {
  it.each([
    [
      { sandbox: { trusted_commands: ['git'] } },
      /Codex does not support sandbox.trusted_commands/,
    ],
    [
      { sandbox: { deny_read: ['~/.ssh'] } },
      /Codex does not support sandbox.deny_read/,
    ],
    [{ skip_permissions: true }, /security: 'yolo'/],
    [{ security: 'custom' }, /requires config/],
    [{ security: 'custom', config: { x: { y: 1 } } }, /config.x.*dotted key/],
  ])('%j fails loading', (options, message) => {
    expect(() => new CodexAgent(options as never)).toThrow(message);
  });

  it('accepts empty trusted_commands and deny_read', () => {
    expect(
      () =>
        new CodexAgent({ sandbox: { trusted_commands: [], deny_read: [] } }),
    ).not.toThrow();
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

describe('CodexAgent.sandboxPreflight', () => {
  const host = (
    tools: string[],
    probe: { ok: boolean; stderr: string } = { ok: true, stderr: '' },
  ) => {
    const calls: string[][] = [];
    return {
      calls,
      host: {
        platform: 'linux' as NodeJS.Platform,
        onPath: (name: string) => tools.includes(name),
        run: async (cmd: string, args: string[]) => {
          calls.push([cmd, ...args]);
          return probe;
        },
      },
    };
  };

  it('reports the cause from a failing `codex sandbox true`', async () => {
    const { host: h, calls } = host(['codex'], {
      ok: false,
      stderr:
        'WARNING: proceeding, even though we could not create PATH aliases\nbwrap: No permissions to create a new namespace\n',
    });
    const result = await new CodexAgent().sandboxPreflight(h);
    expect(calls).toEqual([['codex', 'sandbox', 'true']]);
    expect(result).toMatchObject({
      ok: false,
      cause:
        'codex sandbox cannot start: bwrap: No permissions to create a new namespace',
    });
  });

  it('gives no Linux namespace advice when the probe fails on macOS', async () => {
    const { host: h } = host(['codex'], {
      ok: false,
      stderr: 'sandbox-exec: denied',
    });
    const result = await new CodexAgent().sandboxPreflight({
      ...h,
      platform: 'darwin',
    });
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toMatch(/Linux|namespace/);
  });

  it('is ok when the probe starts', async () => {
    const { host: h } = host(['codex']);
    expect(await new CodexAgent().sandboxPreflight(h)).toEqual({ ok: true });
  });

  it('is ok when this Codex release has no `sandbox` subcommand', async () => {
    const { host: h } = host(['codex'], {
      ok: false,
      stderr:
        "error: unrecognized subcommand 'sandbox'\n\nUsage: codex [OPTIONS] [PROMPT]\n",
    });
    expect(await new CodexAgent().sandboxPreflight(h)).toEqual({ ok: true });
  });

  it('is ok without probing when the codex binary is missing', async () => {
    const { host: h, calls } = host([]);
    expect(await new CodexAgent().sandboxPreflight(h)).toEqual({ ok: true });
    expect(calls).toEqual([]);
  });

  it.each([
    'system',
    'yolo',
  ] as const)('skips the probe in %s mode', async (security) => {
    const { host: h, calls } = host(['codex'], { ok: false, stderr: 'x' });
    expect(await new CodexAgent({ security }).sandboxPreflight(h)).toEqual({
      ok: true,
    });
    expect(calls).toEqual([]);
  });
});
