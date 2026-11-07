import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import grokAgentDefault, { GrokAgent, grokAgent } from '../src/index.js';

const addonRoot = new URL('..', import.meta.url).pathname;
const hostPackage = new URL('../../../host/package.json', import.meta.url);

describe('workspace package structure', () => {
  it('uses the standard conductor-addon package contract', () => {
    const pkg = JSON.parse(
      readFileSync(join(addonRoot, 'package.json'), 'utf8'),
    ) as {
      name: string;
      exports: Record<string, string>;
      peerDependencies: Record<string, string>;
    };
    const tsconfig = JSON.parse(
      readFileSync(join(addonRoot, 'tsconfig.json'), 'utf8'),
    ) as { extends: string };

    expect(pkg.name).toBe('@bakers-build/addon-grok');
    expect(pkg.exports).toEqual({
      '.': './dist/src/index.js',
      './preset': './dist/src/preset.js',
    });
    expect(pkg.peerDependencies).toEqual({
      '@bakers-build/conductor': 'workspace:^',
      '@bakers-build/core': 'workspace:^',
    });
    expect(tsconfig.extends).toBe('../../tsconfig.base.json');
    expect(existsSync(join(addonRoot, 'src/index.ts'))).toBe(true);
    expect(existsSync(join(addonRoot, 'src/footprint.ts'))).toBe(true);
    expect(existsSync(join(addonRoot, 'src/preset.ts'))).toBe(true);
  });

  it('is a runtime dependency of the published bakers.build host', () => {
    const host = JSON.parse(readFileSync(hostPackage, 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(host.dependencies['@bakers-build/addon-grok']).toBe('workspace:^');
  });
});

describe('default export', () => {
  it('is the named factory and returns a grok agent plugin', () => {
    expect(grokAgentDefault).toBe(grokAgent);
    expect(grokAgentDefault().kind).toBe('agent');
    expect(grokAgentDefault().id).toBe('grok');
  });
});

const SANDBOXED =
  "--sandbox workspace --permission-mode acceptEdits --allow 'Bash(*)' --deny 'MCPTool(*)'";
const SANDBOXED_ARGV = [
  '--sandbox',
  'workspace',
  '--permission-mode',
  'acceptEdits',
  '--allow',
  'Bash(*)',
  '--deny',
  'MCPTool(*)',
];

describe('GrokAgent security: shared project and machine layers', () => {
  it('applies a shared allow_write and reports the keys it cannot express', () => {
    const plugin = grokAgent({
      shared_security: {
        machine: {
          sandbox: {
            allow_write: ['/data/cache'],
            deny_read: ['~/.aws'],
            trusted_commands: ['make'],
          },
        },
      },
    } as never);
    expect(plugin.security?.sandbox.allow_write.entries).toEqual([
      { value: '/data/cache', source: 'machine' },
    ]);
    expect(plugin.security?.not_applied).toEqual([
      { key: 'deny_read', source: 'machine', reason: 'unsupported' },
      { key: 'trusted_commands', source: 'machine', reason: 'unsupported' },
    ]);
  });

  it('starts a shared allow_write through the managed profile', () => {
    const agent = new GrokAgent({
      shared_security: { project: { sandbox: { allow_write: ['/data/x'] } } },
    } as never);
    expect(agent.launchCommand('work')).toContain('managed-launch');
  });
});

describe('GrokAgent security', () => {
  it('starts writable-path runs through a managed native profile', () => {
    const agent = new GrokAgent({ sandbox: { allow_write: ['/data/cache'] } });
    const command = agent.launchCommand('work');
    expect(command).toContain('managed-launch');
    expect(command).toContain('--sandbox bakers-managed');
    expect(command).not.toContain('bypassPermissions');
  });

  it('rejects malformed grants and managed-session reuse before launch', () => {
    for (const path of [
      'relative',
      '/tmp/*',
      '/tmp/a?',
      '/tmp/[x]',
      ' /tmp',
      '/tmp\n',
    ]) {
      expect(() => new GrokAgent({ sandbox: { allow_write: [path] } })).toThrow(
        /literal/,
      );
    }
    for (const args of [
      ['--resume=x'],
      ['-cr'],
      ['--continue'],
      ['--fork-session'],
      ['--restore-code'],
      ['--leader-socket', '/tmp/leader'],
    ]) {
      expect(
        () => new GrokAgent({ sandbox: { allow_write: ['/tmp/cache'] }, args }),
      ).toThrow(/reserved flag/);
    }
  });

  it('regression: sandbox mode, explicit or default, launches the native sandbox with a preflight', () => {
    for (const options of [{ security: 'sandbox' as const }, {}]) {
      const agent = new GrokAgent(options);
      expect(agent.launchCommand('BAKERS-32 inspection only')).toBe(
        `grok 'BAKERS-32 inspection only' ${SANDBOXED}`,
      );
      expect(typeof agent.sandboxPreflight).toBe('function');
    }
  });

  it('yolo keeps the permission bypass and system adds no security flag', () => {
    expect(new GrokAgent({ security: 'yolo' }).launchCommand('x')).toBe(
      "grok 'x' --permission-mode bypassPermissions",
    );
    expect(new GrokAgent({ security: 'system' }).launchCommand('x')).toBe(
      "grok 'x'",
    );
  });

  it('applies the shared security validation and rejects custom', () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ skip_permissions: true }, /skip_permissions was removed/],
      [{ security: 'nope' }, /security must be one of/],
      [{ config: { a: 1 } }, /config is only valid with security: 'custom'/],
      [
        { security: 'yolo', sandbox: { network: ['*'] } },
        /sandbox is only valid with security: 'sandbox'/,
      ],
      [{ sandbox: { nope: [] } }, /unknown sandbox key nope/],
      [
        { security: 'custom', config: { a: 1 } },
        /Grok has no config flags for security: 'custom'/,
      ],
    ];
    for (const [options, error] of cases) {
      expect(() => new GrokAgent(options as never)).toThrow(error);
    }
  });

  it('accepts the sandbox keys it enforces and rejects the rest by name', () => {
    expect(
      new GrokAgent({
        sandbox: { network: ['*'], mcp_servers: {} },
      }).launchCommand('x'),
    ).toBe(`grok 'x' ${SANDBOXED}`);
    const rejected: [Record<string, unknown>, RegExp][] = [
      [{ network: [] }, /sandbox\.network: its workspace profile/],
      [{ network: ['example.com'] }, /sandbox\.network/],
      [{ mcp_servers: { docs: {} } }, /sandbox\.mcp_servers/],
      [
        { trusted_commands: ['make'] },
        /no command exception.*trusted_commands/,
      ],
      [{ deny_read: ['~/.ssh'] }, /sandbox\.deny_read is unsupported/],
    ];
    for (const [sandbox, error] of rejected) {
      expect(() => new GrokAgent({ sandbox })).toThrow(error);
    }
  });

  it('rejects args that would replace the flags sandbox mode owns', () => {
    for (const args of [
      ['--sandbox', 'off'],
      ['--sandbox=off'],
      ['--always-approve'],
      ['--allow', 'X'],
      ['--allowedTools', 'X'],
      ['--allowed-tools', 'X'],
      ['--add-dir', '/'],
      ['--cwd', '/'],
      ['--cwd=/'],
      ['--agents', '{}'],
      ['--agents={}'],
      ['--agent', 'x'],
      ['--agent=x'],
      ['-w'],
      // Grok splits short-flag clusters: -cw is --continue --worktree
      ['-cw'],
      ['-vw'],
      ['-rw'],
      ['--worktree', 'n'],
      ['--permission-mode', 'x'],
    ]) {
      expect(() => new GrokAgent({ args })).toThrow(/reserved flag/);
    }
    expect(
      new GrokAgent({
        security: 'system',
        args: ['--sandbox', 'p'],
      }).launchCommand('x'),
    ).toBe("grok 'x' '--sandbox' 'p'");
  });

  it('rejects bare args in sandbox mode, which Grok would parse as a subcommand', () => {
    for (const args of [
      ['wrap', 'bash'],
      ['agent', 'stdio'],
      ['help'],
      // the cluster's value is attached (`-pm` is `-p m`), so the next token is a subcommand
      ['-pm', 'wrap'],
      ['-rm', 'wrap'],
      ['-mm', 'agent'],
      ['-mbar', 'agent'],
    ]) {
      expect(() => new GrokAgent({ args })).toThrow(/args contains/);
    }
    for (const args of [
      ['-m', 'grok-4'],
      ['-cm', 'grok-4'],
      ['--rules', 'x'],
      ['-r', 'abc'],
      ['--deny', 'X'],
      ['--max-turns=3'],
    ]) {
      expect(() => new GrokAgent({ args })).not.toThrow();
    }
    expect(
      new GrokAgent({
        security: 'yolo',
        args: ['agent', 'stdio'],
      }).launchCommand('x'),
    ).toBe("grok 'x' --permission-mode bypassPermissions 'agent' 'stdio'");
  });
});

describe('GrokAgent.sandboxPreflight', () => {
  function host(platform: NodeJS.Platform, ok = true) {
    const calls: string[][] = [];
    return {
      calls,
      platform,
      onPath: () => true,
      run: async (cmd: string, args: string[]) => {
        calls.push([cmd, ...args]);
        return { ok, stderr: '' };
      },
    };
  }

  it('passes on Linux when Landlock is active and on macOS', async () => {
    const linux = host('linux');
    await expect(new GrokAgent().sandboxPreflight(linux)).resolves.toEqual({
      ok: true,
    });
    expect(linux.calls).toEqual([
      ['grep', '-qw', 'landlock', '/sys/kernel/security/lsm'],
    ]);
    await expect(
      new GrokAgent().sandboxPreflight(host('darwin')),
    ).resolves.toEqual({ ok: true });
  });

  it('fails with a cause and fix without Landlock or on an unsupported platform', async () => {
    await expect(
      new GrokAgent().sandboxPreflight(host('linux', false)),
    ).resolves.toEqual({
      ok: false,
      cause: 'Landlock is not active in this kernel',
      fix: "boot a kernel with landlock in its lsm= list, or set security: 'system' or 'yolo' for Grok",
    });
    await expect(
      new GrokAgent().sandboxPreflight(host('win32')),
    ).resolves.toEqual({
      ok: false,
      cause: "Grok's sandbox does not support win32",
      fix: "set security: 'system' or 'yolo' for Grok",
    });
  });

  it('requires bubblewrap for managed profiles without changing the empty-grant preflight', async () => {
    const linux = { ...host('linux'), onPath: () => false };
    await expect(
      new GrokAgent({
        sandbox: { allow_write: ['/tmp/cache'] },
      }).sandboxPreflight(linux),
    ).resolves.toMatchObject({
      ok: false,
      cause: expect.stringContaining('bubblewrap'),
    });
    expect(linux.calls).toEqual([]);
    await expect(new GrokAgent().sandboxPreflight(linux)).resolves.toEqual({
      ok: true,
    });
  });

  it('does not probe yolo or system agents', async () => {
    for (const security of ['yolo', 'system'] as const) {
      const linux = host('linux', false);
      await expect(
        new GrokAgent({ security }).sandboxPreflight(linux),
      ).resolves.toEqual({ ok: true });
      expect(linux.calls).toEqual([]);
    }
  });
});

describe('GrokAgent.launchCommand', () => {
  it('uses the CLI default when no model is configured', async () => {
    for (const options of [undefined, {}, { model: undefined }]) {
      expect(new GrokAgent(options).launchCommand('x')).toBe(
        `grok 'x' ${SANDBOXED}`,
      );
      const agent = await grokAgent(options).createAgent({} as never);
      expect(agent.launchCommand('x')).toBe(`grok 'x' ${SANDBOXED}`);
    }
  });

  it('preserves an explicitly empty model', () => {
    expect(new GrokAgent({ model: '' }).launchCommand('x')).toBe(
      `grok 'x' ${SANDBOXED} -m ''`,
    );
  });

  it('preserves long model passthrough precedence', () => {
    for (const args of [
      ['--model', 'chosen-model'],
      ['--model=chosen-model'],
    ]) {
      expect(
        captureArgv(
          'grok',
          new GrokAgent({ model: 'grok-4.5', args }).launchCommand('x'),
        ),
      ).toEqual(['grok', 'x', ...SANDBOXED_ARGV, ...args]);
    }
  });

  it('starts the interactive session with a positional prompt and the pinned model', () => {
    expect(
      new GrokAgent({ model: 'grok-4.5' }).launchCommand('do the thing'),
    ).toBe(`grok 'do the thing' ${SANDBOXED} -m 'grok-4.5'`);
  });

  it('never falls back to the single-turn headless mode', () => {
    // `-p/--single` prints one answer to stdout and EXITS, so the agent would
    // never hold the herdr tab it is dispatched into. The prompt has to stay
    // positional — that is the interactive form Grok Build documents.
    for (const prompt of ['do the thing', '', 'para one\n\npara two']) {
      const command = new GrokAgent().launchCommand(prompt);
      expect(command).not.toMatch(/(^|\s)-p(\s|$)/);
      expect(command).not.toContain('--single');
      expect(command).not.toContain('--prompt-file');
      expect(command).not.toContain('--output-format');
    }
  });

  it('adds a configured reasoning effort and never creates a worktree', () => {
    const command = new GrokAgent({
      model: 'grok-4.5',
      reasoningEffort: 'medium',
    }).launchCommand('do it');
    expect(command).toBe(
      `grok 'do it' ${SANDBOXED} -m 'grok-4.5' --reasoning-effort 'medium'`,
    );
    expect(command).not.toContain('--worktree');
  });

  it('uses the CLI default and omits the prompt argument for an empty prompt', () => {
    expect(new GrokAgent().launchCommand('')).toBe(`grok ${SANDBOXED}`);
  });

  it('POSIX-quotes a multi-line prompt for the sh-evaluated launch file, without a shell wrapper', () => {
    const prompt = 'para one\n\npara two';
    const command = new GrokAgent().launchCommand(prompt);
    expect(command).toBe(`grok 'para one\n\npara two' ${SANDBOXED}`);
    expect(command.startsWith('bash -c')).toBe(false);
    expect(command).not.toContain('base64');
  });

  it('R4: pins the session id via --session-id when a run is given (BB-473)', () => {
    const command = new GrokAgent({ model: 'grok-4.5' }).launchCommand(
      'do the thing',
      { sessionId: '00000000-0000-4000-8000-0000000000aa' },
    );
    expect(command).toBe(
      `grok 'do the thing' ${SANDBOXED} -m 'grok-4.5' --session-id 00000000-0000-4000-8000-0000000000aa`,
    );
  });

  it('omits --session-id when no run is given (unchanged behaviour)', () => {
    expect(new GrokAgent({ model: 'grok-4.5' }).launchCommand('x')).toBe(
      `grok 'x' ${SANDBOXED} -m 'grok-4.5'`,
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

describe('GrokAgent args and effort', () => {
  it('prefers effort over reasoningEffort and quotes both values', () => {
    const command = new GrokAgent({
      model: 'grok-4.5',
      reasoningEffort: 'low',
      effort: 'high',
      args: ['--rules', 'a b'],
    }).launchCommand('task');
    expect(captureArgv('grok', command)).toEqual([
      'grok',
      'task',
      ...SANDBOXED_ARGV,
      '-m',
      'grok-4.5',
      '--reasoning-effort',
      'high',
      '--rules',
      'a b',
    ]);
  });

  it('suppresses generated model and effort when args override them', () => {
    const command = new GrokAgent({
      model: 'grok-4.5',
      effort: 'low',
      args: ['-m', 'grok-4.6', '--reasoning-effort', 'high'],
    }).launchCommand('x');
    expect(captureArgv('grok', command)).toEqual([
      'grok',
      'x',
      ...SANDBOXED_ARGV,
      '-m',
      'grok-4.6',
      '--reasoning-effort',
      'high',
    ]);
  });

  it('recognizes attached -mVALUE and --effort equals forms', () => {
    const command = new GrokAgent({
      model: 'grok-4.5',
      effort: 'low',
      args: ['-mgrok-4.6', '--effort=high'],
    }).launchCommand('x');
    expect(captureArgv('grok', command)).toEqual([
      'grok',
      'x',
      ...SANDBOXED_ARGV,
      '-mgrok-4.6',
      '--effort=high',
    ]);
  });

  it('rejects reserved permission-mode and session-id flags', () => {
    expect(() => new GrokAgent({ args: ['--permission-mode'] })).toThrow(
      /reserved flag/,
    );
    expect(() => new GrokAgent({ args: ['--session-id=x'] })).toThrow(
      /reserved flag/,
    );
    expect(() => new GrokAgent({ args: ['-s', 'x'] })).toThrow(/reserved flag/);
    expect(
      () => new GrokAgent({ security: 'yolo', args: ['-cs', 'x'] }),
    ).toThrow(/reserved flag -s/);
    // letters after a value-taking -m are its value, not flags
    expect(
      new GrokAgent({ security: 'system', args: ['-mws'] }).launchCommand('x'),
    ).toBe("grok 'x' '-mws'");
  });
});

describe('GrokAgent.sessionExists', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(
      roots
        .splice(0)
        .map((path) =>
          import('node:fs/promises').then(({ rm }) =>
            rm(path, { recursive: true, force: true }),
          ),
        ),
    );
  });

  it('is true when the session dir already carries a summary.json', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bakers-grok-'));
    roots.push(home);
    const dir = join(
      home,
      '.grok/sessions/%2Ftmp%2Fbakers-wt-grok/00000000-0000-4000-8000-000000000001',
    );
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'summary.json'),
      JSON.stringify({ info: { cwd: '/tmp/bakers-wt-grok' } }),
    );
    expect(
      await new GrokAgent(undefined, home).sessionExists(
        '/tmp/bakers-wt-grok',
        '00000000-0000-4000-8000-000000000001',
      ),
    ).toBe(true);
  });

  it('is false when the session dir is absent (fresh dispatch)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bakers-grok-'));
    roots.push(home);
    expect(
      await new GrokAgent(undefined, home).sessionExists(
        '/tmp/bakers-wt-grok',
        '00000000-0000-4000-8000-000000000001',
      ),
    ).toBe(false);
  });
});

describe('GrokAgent.getRunLog', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(
      roots
        .splice(0)
        .map((path) =>
          import('node:fs/promises').then(({ rm }) =>
            rm(path, { recursive: true, force: true }),
          ),
        ),
    );
  });

  it('encodes the cwd exactly like Grok Build', async () => {
    const { encodeGrokSessionCwd } = await import('../src/index.js');
    expect(encodeGrokSessionCwd('/home/cw/projects/bakers')).toBe(
      '%2Fhome%2Fcw%2Fprojects%2Fbakers',
    );
  });

  it('returns a bundle for the newest summary whose cwd exactly matches', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bakers-grok-'));
    roots.push(home);
    const sessions = join(home, '.grok/sessions/%2Ftmp%2Fbakers-wt-grok');
    const older = join(sessions, '00000000-0000-4000-8000-000000000001');
    const newer = join(sessions, '00000000-0000-4000-8000-000000000002');
    const wrong = join(sessions, '00000000-0000-4000-8000-000000000003');
    await Promise.all(
      [older, newer, wrong].map((path) => mkdir(path, { recursive: true })),
    );
    const writeSession = async (
      dir: string,
      cwd: string,
      updatedAt: string,
      marker: number,
    ) => {
      await writeFile(
        join(dir, 'summary.json'),
        JSON.stringify({
          info: { cwd },
          updated_at: updatedAt,
          current_model_id: 'grok-4.5',
        }),
      );
      await writeFile(
        join(dir, 'signals.json'),
        JSON.stringify({ assistantMessageCount: marker }),
      );
      await writeFile(join(dir, 'chat_history.jsonl'), '');
      await writeFile(join(dir, 'updates.jsonl'), '');
    };
    await writeSession(older, '/tmp/bakers-wt-grok', '2026-08-12T10:00:00Z', 1);
    await writeSession(newer, '/tmp/bakers-wt-grok', '2026-08-12T11:00:00Z', 2);
    await writeSession(wrong, '/tmp/not-this-run', '2026-08-12T12:00:00Z', 3);

    const log = await new GrokAgent(undefined, home).getRunLog(
      '/tmp/bakers-wt-grok',
    );
    expect(JSON.parse(log).signals.assistantMessageCount).toBe(2);
  });

  it('returns an empty string for missing or unmatched sessions', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bakers-grok-'));
    roots.push(home);
    await expect(
      new GrokAgent(undefined, home).getRunLog('/tmp/missing'),
    ).resolves.toBe('');
  });

  it('R4: given a run identity, selects THAT session dir, not the newer foreign one (BB-473)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bakers-grok-'));
    roots.push(home);
    const sessions = join(home, '.grok/sessions/%2Ftmp%2Fbakers-wt-grok');
    const ours = join(sessions, '00000000-0000-4000-8000-0000000000aa');
    const foreign = join(sessions, '00000000-0000-4000-8000-0000000000bb');
    await Promise.all(
      [ours, foreign].map((path) => mkdir(path, { recursive: true })),
    );
    const writeSession = async (
      dir: string,
      updatedAt: string,
      marker: number,
    ) => {
      await writeFile(
        join(dir, 'summary.json'),
        JSON.stringify({
          info: { cwd: '/tmp/bakers-wt-grok' },
          updated_at: updatedAt,
          current_model_id: 'grok-4.5',
        }),
      );
      await writeFile(
        join(dir, 'signals.json'),
        JSON.stringify({ assistantMessageCount: marker }),
      );
      await writeFile(join(dir, 'chat_history.jsonl'), '');
      await writeFile(join(dir, 'updates.jsonl'), '');
    };
    // Ours is older; the foreign session is newer — a naive "newest" scan
    // would wrongly pick the foreign one.
    await writeSession(ours, '2026-08-12T10:00:00Z', 1);
    await writeSession(foreign, '2026-08-12T11:00:00Z', 2);

    const log = await new GrokAgent(undefined, home).getRunLog(
      '/tmp/bakers-wt-grok',
      { sessionId: '00000000-0000-4000-8000-0000000000aa' },
    );
    expect(JSON.parse(log).signals.assistantMessageCount).toBe(1);
  });

  it('AC-5: falls through to the scan when the pinned session dir is absent — a run dispatched before this change does not finalise with an empty log (BB-473)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bakers-grok-'));
    roots.push(home);
    const sessions = join(home, '.grok/sessions/%2Ftmp%2Fbakers-wt-grok');
    const preExisting = join(sessions, '00000000-0000-4000-8000-0000000000cc');
    await mkdir(preExisting, { recursive: true });
    await writeFile(
      join(preExisting, 'summary.json'),
      JSON.stringify({
        info: { cwd: '/tmp/bakers-wt-grok' },
        updated_at: '2026-08-12T10:00:00Z',
        current_model_id: 'grok-4.5',
      }),
    );
    await writeFile(
      join(preExisting, 'signals.json'),
      JSON.stringify({ assistantMessageCount: 7 }),
    );
    await writeFile(join(preExisting, 'chat_history.jsonl'), '');
    await writeFile(join(preExisting, 'updates.jsonl'), '');

    const log = await new GrokAgent(undefined, home).getRunLog(
      '/tmp/bakers-wt-grok',
      // No summary.json under this sessionId — as if this run was
      // dispatched before the addon started pinning `--session-id`.
      { sessionId: 'never-pinned' },
    );
    expect(JSON.parse(log).signals.assistantMessageCount).toBe(7);
  });

  it('round 4 (review round 3, Critical 1): a pinned session dir older than startedAt is a stale prior attempt — falls through to the scan instead of being read directly', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bakers-grok-'));
    roots.push(home);
    const sessions = join(home, '.grok/sessions/%2Ftmp%2Fbakers-wt-grok');
    // Attempt 1 pinned this dir name (the run's own uuid) and wrote to it.
    const staleAttempt1 = join(sessions, 're-dispatched-run');
    await mkdir(staleAttempt1, { recursive: true });
    await writeFile(
      join(staleAttempt1, 'summary.json'),
      JSON.stringify({
        info: { cwd: '/tmp/bakers-wt-grok' },
        updated_at: new Date(500).toISOString(),
        current_model_id: 'grok-4.5',
      }),
    );
    await writeFile(
      join(staleAttempt1, 'signals.json'),
      JSON.stringify({ assistantMessageCount: 1 }),
    );
    await writeFile(join(staleAttempt1, 'chat_history.jsonl'), '');
    await writeFile(join(staleAttempt1, 'updates.jsonl'), '');
    await utimes(staleAttempt1, new Date(1_000), new Date(1_000));
    // Attempt 2's actual, unpinned session dir — its own updated_at is after
    // the re-stamped `startedAt` the conductor records at the second dispatch.
    const attempt2 = join(sessions, 'agent-minted-uuid');
    await mkdir(attempt2, { recursive: true });
    await writeFile(
      join(attempt2, 'summary.json'),
      JSON.stringify({
        info: { cwd: '/tmp/bakers-wt-grok' },
        updated_at: new Date(3_000).toISOString(),
        current_model_id: 'grok-4.5',
      }),
    );
    await writeFile(
      join(attempt2, 'signals.json'),
      JSON.stringify({ assistantMessageCount: 2 }),
    );
    await writeFile(join(attempt2, 'chat_history.jsonl'), '');
    await writeFile(join(attempt2, 'updates.jsonl'), '');

    const log = await new GrokAgent(undefined, home).getRunLog(
      '/tmp/bakers-wt-grok',
      { sessionId: 're-dispatched-run', startedAt: new Date(2_000) },
    );
    expect(JSON.parse(log).signals.assistantMessageCount).toBe(2);
  });
});
