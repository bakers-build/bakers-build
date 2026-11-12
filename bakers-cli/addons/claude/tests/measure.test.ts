import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ClaudeAgent } from '../src/index.js';
import * as preset from '../src/preset.js';

const run = promisify(execFile);
const measureDir = fileURLToPath(new URL('../measure/', import.meta.url));
const wrapper = join(measureDir, 'claude-measure.mjs');

/** A stand-in for `claude`: reports what the wrapper handed it, then exits 3. */
const FAKE_CLAUDE = `
const fs = require('node:fs');
const net = require('node:net');
const base = process.env.ANTHROPIC_BASE_URL || null;
const settingsPath = process.argv[process.argv.lastIndexOf('--settings') + 1];
const settings = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : null;
if (process.env.FAKE_CLAUDE_SIGNAL) process.kill(process.pid, process.env.FAKE_CLAUDE_SIGNAL);
const report = (listening) => {
  console.log(JSON.stringify({ base, settings, settingsPath, listening, logDir: process.env.BB_PROXY_LOG_DIR ?? null, argv: process.argv.slice(1) }));
  process.exit(3);
};
if (!base) report(false);
else {
  const s = net.connect(Number(new URL(base).port), '127.0.0.1');
  s.on('connect', () => { s.end(); report(true); });
  s.on('error', () => report(false));
}`;

async function worktree(ignoreAssets: boolean): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'claude-measure-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  if (ignoreAssets) {
    await writeFile(
      join(dir, '.gitignore'),
      '/assets-ai/\n/.bakers/claude-measure.settings.json\n',
    );
  }
  return dir;
}

async function measured(
  cwd: string,
  state: string,
  extraEnv: Record<string, string> = {},
  callerArgs: string[] = ['extra-arg'],
  settingsArgs: string[] = SETTINGS_ARGS,
  wrapperArgs: string[] = [],
) {
  try {
    await run(
      process.execPath,
      [
        wrapper,
        ...wrapperArgs,
        process.execPath,
        '-e',
        FAKE_CLAUDE,
        ...callerArgs,
        ...settingsArgs,
      ],
      {
        cwd,
        timeout: 10_000,
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: '',
          BAKERS_STATE: state,
          BAKERS_TICKET_IDENTIFIER: 'BB-569',
          BAKERS_RUN_UUID: '',
          ...extraEnv,
        },
      },
    );
    throw new Error('wrapper should pass the child exit code 3 through');
  } catch (err) {
    const e = err as { code?: number; stdout: string; stderr: string };
    if (e.code !== 3) throw err;
    return { ...JSON.parse(e.stdout.trim()), stderr: e.stderr };
  }
}

const SETTINGS_ARGS = ['--settings', '.bakers/claude-measure.settings.json'];

const bundled = (group: string) =>
  readFile(join(measureDir, `keytec-${group}.json`), 'utf8');

describe('claude-measure launch wrapper', () => {
  it.each([
    'qualification',
    'coding',
    'review',
  ])('loads versioned public recipe packages for %s', async (state) => {
    const out = await measured(await worktree(true), state);
    const settings = JSON.parse(out.settings);
    expect(settings.extraKnownMarketplaces.mattpocock.source).toEqual({
      source: 'github',
      repo: 'mattpocock/skills',
      ref: 'v1.3.2',
    });
    expect(settings.enabledPlugins['mattpocock-skills@mattpocock']).toBe(true);
    expect(settings.enabledPlugins).not.toHaveProperty(
      'mattpocock-skills@keytec-mattpocock',
    );
    expect(settings.extraKnownMarketplaces['superpowers-dev']?.source).toEqual({
      source: 'github',
      repo: 'obra/superpowers',
      ref: 'v7.0.0',
    });
    expect(settings.enabledPlugins['superpowers@superpowers-dev']).toBe(true);
    expect(settings.enabledPlugins['superpowers@claude-plugins-official']).toBe(
      false,
    );
    if (state === 'coding') {
      expect(settings.extraKnownMarketplaces.designbook?.source).toEqual({
        source: 'github',
        repo: 'pen-drop/designbook',
        ref: 'a4fea9d7cf8d2e06321d132e6d24892d17c0a480',
      });
    }
  });

  it('folds an inline --settings JSON into the profile, joining permission lists', async () => {
    const cwd = await worktree(true);
    const inline = {
      sandbox: { enabled: true },
      permissions: { allow: ['Bash'], deny: ['Read(~/.ssh/**)'] },
    };
    const out = await measured(cwd, 'coding', {}, undefined, [
      '--settings',
      JSON.stringify(inline),
    ]);
    expect(out.settingsPath).toBe('.bakers/claude-measure.settings.json');
    const settings = JSON.parse(out.settings);
    const profile = JSON.parse(await bundled('coding'));
    expect(settings.sandbox).toEqual({ enabled: true });
    expect(settings.effortLevel).toBe(profile.effortLevel);
    expect(settings.permissions.allow).toEqual(['Bash']);
    expect(settings.permissions.deny).toEqual([
      ...profile.permissions.deny,
      'Read(~/.ssh/**)',
    ]);
  });

  it('copies the state group, runs claude through a live loopback proxy, and exits with its code', async () => {
    const cwd = await worktree(true);
    const out = await measured(cwd, 'coding');
    expect(out.base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(out.listening).toBe(true);
    expect(out.settings).toBe(await bundled('coding'));
    expect(out.argv).toEqual(['extra-arg', ...SETTINGS_ARGS]);
  });

  it('logs each run into a subdirectory named by its run uuid', async () => {
    const cwd = await worktree(true);
    const runUuid = '123d5bbe-6c90-4d17-98ef-e0bb448c5066';
    const out = await measured(cwd, 'coding', { BAKERS_RUN_UUID: runUuid });
    expect(out.logDir).toBe(
      join(await realpath(cwd), 'assets-ai', 'BB-569', 'node', runUuid),
    );
  });

  it('logs into the ticket directory when no run uuid is set', async () => {
    const cwd = await worktree(true);
    const out = await measured(cwd, 'coding');
    expect(out.logDir).toBe(
      join(await realpath(cwd), 'assets-ai', 'BB-569', 'node'),
    );
  });

  it.each([
    ['qualification', 'plan'],
    ['diagnose', 'plan'],
    ['review', 'review'],
    ['summary', 'ops'],
  ])('maps %s onto the %s settings', async (state, group) => {
    const out = await measured(await worktree(true), state);
    expect(out.settings).toBe(await bundled(group));
  });

  it("lets the project's own enabledPlugins win over the profile", async () => {
    const cwd = await worktree(true);
    await mkdir(join(cwd, '.claude'));
    await writeFile(
      join(cwd, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'bakers@bakers': false } }),
    );
    const out = await measured(cwd, 'coding');
    const profile = JSON.parse(await bundled('coding'));
    expect(JSON.parse(out.settings)).toEqual({
      ...profile,
      enabledPlugins: { ...profile.enabledPlugins, 'bakers@bakers': false },
    });
  });

  it('launches claude unmeasured when the log directory is not gitignored', async () => {
    const out = await measured(await worktree(false), 'coding');
    expect(out.base).toBeNull();
    expect(out.stderr).toMatch(/not ignored by git/);
    expect(out.settings).toBe(await bundled('coding'));
  });

  it('keeps the settings out of a repository that does not ignore them', async () => {
    const cwd = await worktree(false);
    const out = await measured(cwd, 'coding');
    expect(out.settings).toBe(await bundled('coding'));
    expect(out.settingsPath.startsWith(tmpdir())).toBe(true);
    expect(existsSync(out.settingsPath)).toBe(false);
    expect(
      execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }),
    ).toBe('');
  });

  it("rewrites the measure flag's --settings, not an alias's earlier one", async () => {
    const out = await measured(await worktree(false), 'coding', {}, [
      'extra-arg',
      '--settings',
      'alias.json',
    ]);
    expect(out.argv.slice(0, 3)).toEqual([
      'extra-arg',
      '--settings',
      'alias.json',
    ]);
    expect(out.settingsPath.startsWith(tmpdir())).toBe(true);
  });

  it('removes the temporary settings when the command cannot start', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'claude-measure-tmp-'));
    const err = await run(
      process.execPath,
      [wrapper, 'does-not-exist-claude', ...SETTINGS_ARGS],
      {
        cwd: await worktree(false),
        timeout: 10_000,
        env: { ...process.env, TMPDIR: tmp, BAKERS_STATE: 'coding' },
      },
    ).catch((e: { code?: number }) => e);
    expect((err as { code?: number }).code).toBe(127);
    expect(readdirSync(tmp)).toEqual([]);
  });

  it('exits with 128 plus the signal number when claude is killed', async () => {
    const err = await run(
      process.execPath,
      [
        wrapper,
        process.execPath,
        '-e',
        FAKE_CLAUDE,
        'extra-arg',
        ...SETTINGS_ARGS,
      ],
      {
        cwd: await worktree(true),
        timeout: 10_000,
        env: {
          ...process.env,
          BAKERS_STATE: 'coding',
          BAKERS_TICKET_IDENTIFIER: 'BB-569',
          FAKE_CLAUDE_SIGNAL: 'SIGTERM',
        },
      },
    ).catch((e: { code?: number }) => e);
    expect((err as { code?: number }).code).toBe(143);
  });
});

describe('claude-measure --capture', () => {
  const inline = ['--settings', '{"sandbox":{"enabled":true}}'];
  const runUuid = '9f0c2c1e-3b4a-4d5e-8f60-718293a4b5c6';

  it('passes argv and the caller settings through, writes no settings file, and proxies the child', async () => {
    const cwd = await worktree(true);
    const out = await measured(
      cwd,
      'coding',
      { BAKERS_RUN_UUID: runUuid },
      ['extra-arg'],
      inline,
      ['--capture'],
    );
    expect(out.argv).toEqual(['extra-arg', ...inline]);
    expect(existsSync(join(cwd, '.bakers'))).toBe(false);
    expect(out.base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(out.listening).toBe(true);
    expect(out.logDir).toBe(
      join(await realpath(cwd), 'assets-ai', 'BB-569', 'node', runUuid),
    );
  });

  it('runs the command unlogged with a warning when assets-ai is not ignored', async () => {
    const cwd = await worktree(false);
    const out = await measured(cwd, 'coding', {}, ['extra-arg'], inline, [
      '--capture',
    ]);
    expect(out.argv).toEqual(['extra-arg', ...inline]);
    expect(out.base).toBeNull();
    expect(out.stderr).toMatch(/not ignored by git/);
    expect(
      execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }),
    ).toBe('');
  });
});

describe('ClaudeAgent measure', () => {
  it('wraps the launch in the measure script and appends the settings flags', () => {
    const cmd = new ClaudeAgent({
      model: 'opus',
      measure: true,
      permissions: 'yolo',
      args: ['--verbose'],
    }).launchCommand('go');
    expect(cmd).toBe(
      `CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1 node '${wrapper}' claude 'go' --model 'opus' --dangerously-skip-permissions '--verbose' '--setting-sources' 'project,local' '--settings' '.bakers/claude-measure.settings.json' '--strict-mcp-config' '--mcp-config' '{"mcpServers":{}}'`,
    );
  });

  it('passes each overlapping flag once in sandbox mode, with the sandbox settings inline', () => {
    const argv = execFileSync(
      'bash',
      [
        '-c',
        `node() { printf '%s\\0' "$@"; }; ${new ClaudeAgent({ permissions: 'sandbox', measure: true }).launchCommand('go')}`,
      ],
      { encoding: 'utf8' },
    )
      .split('\0')
      .slice(0, -1);
    for (const flag of [
      '--setting-sources',
      '--settings',
      '--strict-mcp-config',
      '--mcp-config',
    ]) {
      expect(argv.filter((a) => a === flag)).toHaveLength(1);
    }
    const settings = JSON.parse(argv[argv.indexOf('--settings') + 1] as string);
    expect(settings.sandbox.enabled).toBe(true);
  });

  it('leaves the launch untouched without measure', () => {
    expect(
      new ClaudeAgent({ model: 'opus', permissions: 'yolo' }).launchCommand(
        'go',
      ),
    ).toBe(
      "CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1 claude 'go' --model 'opus' --dangerously-skip-permissions",
    );
  });

  it('omits measure for an empty prompt', () => {
    expect(new ClaudeAgent({ measure: true }).launchCommand('')).toBe('claude');
  });

  it('withholds the conductor tools from a measured run only', () => {
    expect(new ClaudeAgent({ measure: true }).withoutConductorTools).toBe(true);
    expect(new ClaudeAgent().withoutConductorTools).toBe(false);
  });

  it('rejects a non-boolean measure option', () => {
    expect(() => new ClaudeAgent({ measure: 'yes' as never })).toThrow(
      /measure must be a boolean/,
    );
  });

  it('carries measure into every catalog variant and contributes no hook listener', async () => {
    const candidates = await preset.agents([], { measure: true });
    expect(candidates.map(({ alias }) => alias)).toEqual([
      'opus',
      'sonnet',
      'fable',
      'opus-proxy',
    ]);
    for (const c of candidates) {
      const agent = await c.agent.createAgent({} as never);
      expect(agent.launchCommand('go')).toContain(`node '${wrapper}' claude`);
      expect(agent.launchCommand('go')).toContain(`--model '${c.model}'`);
      expect(agent.withoutConductorTools).toBe(true);
    }
    expect('hooks' in preset).toBe(false);
  });
});

describe('ClaudeAgent proxy', () => {
  const tools = { url: 'http://127.0.0.1:4100/mcp' };
  const launch = (options: object) =>
    new ClaudeAgent({
      model: 'opus',
      permissions: 'system',
      ...options,
    }).launchCommand('go', { sessionId: 's-1' } as never, '/w', tools);

  it('prefixes the unchanged launch with the capture wrapper', () => {
    const plain = launch({});
    expect(launch({ proxy: true })).toBe(
      plain.replace(` claude 'go'`, ` node '${wrapper}' --capture claude 'go'`),
    );
    expect(plain).toContain('127.0.0.1:4100');
  });

  it('keeps the conductor tools', () => {
    expect(new ClaudeAgent({ proxy: true }).withoutConductorTools).toBe(false);
  });

  it('launches plain claude for an empty prompt', () => {
    expect(new ClaudeAgent({ proxy: true }).launchCommand('')).toBe('claude');
  });

  it('lets measure win when both are set', () => {
    expect(launch({ measure: true, proxy: true })).toBe(
      launch({ measure: true }),
    );
  });

  it('rejects a non-boolean proxy option', () => {
    expect(() => new ClaudeAgent({ proxy: 'yes' as never })).toThrow(
      /proxy must be a boolean/,
    );
  });
});

describe('agent-proxy unit tests', () => {
  it('passes node:test', () => {
    execFileSync(
      process.execPath,
      ['--test', join(measureDir, 'agent-proxy.test.mjs')],
      { stdio: 'pipe' },
    );
  });
});
