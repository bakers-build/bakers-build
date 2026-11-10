import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeAgent, encodeClaudeProjectDir } from '../src/index.js';

const probe = {
  url: 'https://probe.invalid/probe.git',
  ref: 'vA',
  plugins: ['probe-plugin'],
};

let root: string;
let user: string;
let calls: string;

// A `claude` stub: records each call with its CLAUDE_CONFIG_DIR and answers like the CLI's --json.
function stubClaude(fail = '') {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'claude'),
    `#!/bin/sh
echo "CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR HOME=$HOME $*" >> "${calls}"
case "$*" in
  *"${fail || 'no-failure-configured'}"*) echo 'Plugin "probe-plugin" not found in marketplace' >&2; exit 1;;
  "plugin marketplace add"*) echo '{"outcome":"ok","marketplace":"probe-market"}';;
  *) echo '{"outcome":"ok"}';;
esac
`,
  );
  chmodSync(join(bin, 'claude'), 0o755);
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bakers-claude-plugins-'));
  user = join(root, 'user');
  mkdirSync(join(user, '.claude'), { recursive: true });
  writeFileSync(join(user, '.claude', '.credentials.json'), '{"token":"t"}');
  calls = join(root, 'calls.log');
  vi.stubEnv('XDG_CACHE_HOME', join(root, 'cache'));
  stubClaude();
});
afterEach(() => vi.unstubAllEnvs());

const agentFor = async (options = {}) => {
  const agent = new ClaudeAgent({ permissions: 'yolo', ...options }, user);
  agent.useMarketplaces([probe]);
  return agent;
};

describe('ClaudeAgent.installPlugins', () => {
  it('installs with claude plugin commands under CLAUDE_CONFIG_DIR=<home>, once', async () => {
    const agent = await agentFor();
    const home = join(root, 'home');
    const launch = await agent.installPlugins([probe], home);
    expect(launch).toEqual({
      env: { CLAUDE_CONFIG_DIR: home },
      args: [],
      home: 'built',
    });
    const log = readFileSync(calls, 'utf8').trim().split('\n');
    expect(log).toEqual([
      `CLAUDE_CONFIG_DIR=${home} HOME=${process.env.HOME} plugin marketplace add https://probe.invalid/probe.git#vA --json`,
      `CLAUDE_CONFIG_DIR=${home} HOME=${process.env.HOME} plugin install probe-plugin@probe-market --json`,
    ]);
    expect((await agent.installPlugins([probe], home)).home).toBe('reused');
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('links only the credential file and seeds a completed onboarding', async () => {
    const agent = await agentFor();
    const home = join(root, 'home');
    await agent.installPlugins([probe], home);
    const links = readdirSync(home).filter((name) =>
      lstatSync(join(home, name)).isSymbolicLink(),
    );
    expect(links).toEqual(['.credentials.json']);
    expect(readlinkSync(join(home, '.credentials.json'))).toBe(
      join(user, '.claude', '.credentials.json'),
    );
    expect(
      JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')),
    ).toMatchObject({ hasCompletedOnboarding: true });
    // The user's own agent home is untouched.
    expect(readdirSync(join(user, '.claude'))).toEqual(['.credentials.json']);
    expect(existsSync(join(user, '.claude.json'))).toBe(false);
  });

  it('fails, naming the missing credential file, when Claude keeps no file login', async () => {
    const agent = await agentFor();
    rmSync(join(user, '.claude', '.credentials.json'));
    await expect(
      agent.installPlugins([probe], join(root, 'home')),
    ).rejects.toThrow(/\.credentials\.json/);
    expect(existsSync(join(root, 'home'))).toBe(false);
  });

  it('fails, naming the plugin and the harness output, when an install fails', async () => {
    stubClaude('plugin install');
    const agent = await agentFor();
    await expect(
      agent.installPlugins([probe], join(root, 'home')),
    ).rejects.toThrow(/probe-plugin.*not found in marketplace/);
  });
});

describe('ClaudeAgent with plugins on', () => {
  it('launches without the sync-install variable', async () => {
    const agent = await agentFor();
    expect(agent.launchCommand('go')).toBe(
      "claude 'go' --dangerously-skip-permissions",
    );
  });

  it('reads the agent home settings, where the plugins are enabled, in sandbox mode', async () => {
    const agent = new ClaudeAgent({ permissions: 'sandbox' }, user);
    agent.useMarketplaces([probe]);
    expect(agent.launchCommand('go', undefined, root)).toContain(
      "--setting-sources 'user,project,local'",
    );
    expect(
      new ClaudeAgent({ permissions: 'sandbox' }, user).launchCommand(
        'go',
        undefined,
        root,
      ),
    ).toContain("--setting-sources 'project,local'");
  });

  it('reads transcripts from the agent home it installed into', async () => {
    const agent = await agentFor();
    expect(agent.configDir).toMatch(
      new RegExp(
        `^${join(root, 'cache', 'bakers', 'agent-homes', 'claude')}/[0-9a-f]{16}$`,
      ),
    );
    const dir = join(
      agent.configDir,
      'projects',
      encodeClaudeProjectDir('/srv/ws/BB-1'),
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'r-1.jsonl'), '{"x":1}\n');
    expect(await agent.sessionExists('/srv/ws/BB-1', 'r-1')).toBe(true);
    expect(await agent.getRunLog('/srv/ws/BB-1', { sessionId: 'r-1' })).toBe(
      '{"x":1}\n',
    );
  });

  it('plugins: false keeps the user home and reports plugins disabled', async () => {
    const agent = await agentFor({ plugins: false });
    expect(agent.pluginsDisabled).toBe(true);
    expect(agent.configDir).toBe(join(user, '.claude'));
    expect(agent.launchCommand('go')).toMatch(
      /^CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1 /,
    );
  });
});
