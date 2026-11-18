import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeAgent,
  claudeAgent,
  encodeClaudeProjectDir,
} from '../src/index.js';

const probe = {
  url: 'https://probe.invalid/probe.git',
  ref: 'vA',
  plugins: ['probe-plugin'],
};

const login = (expiresAt: number) =>
  JSON.stringify({
    claudeAiOauth: { accessToken: `a${expiresAt}`, expiresAt },
  });

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
  "plugin marketplace list"*) cat "${root}/markets.json" 2>/dev/null || echo '[]';;
  "plugin list"*) cat "${root}/plugins.json" 2>/dev/null || echo '[]';;
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
  vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', '');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  stubClaude();
});
afterEach(() => vi.unstubAllEnvs());

const agentFor = async (options = {}) => {
  const agent = new ClaudeAgent(
    { permissions: 'yolo', home: 'individual', ...options },
    user,
  );
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

  it('keeps a token refreshed inside the home as the host login and relinks on the next use', async () => {
    const agent = await agentFor();
    const home = join(root, 'home');
    const host = join(user, '.claude', '.credentials.json');
    await agent.installPlugins([probe], home);
    // Claude Code refreshes by writing a temp file and renaming it over the path.
    writeFileSync(join(home, 'tmp'), login(3000));
    renameSync(join(home, 'tmp'), join(home, '.credentials.json'));
    expect((await agent.installPlugins([probe], home)).home).toBe('reused');
    expect(readlinkSync(join(home, '.credentials.json'))).toBe(host);
    expect(readFileSync(host, 'utf8')).toBe(login(3000));
  });

  it('a home drifted before the host login was renewed uses the renewed login on its next use', async () => {
    const agent = await agentFor();
    const home = join(root, 'home');
    const host = join(user, '.claude', '.credentials.json');
    await agent.installPlugins([probe], home);
    rmSync(join(home, '.credentials.json'));
    writeFileSync(join(home, '.credentials.json'), login(2000));
    writeFileSync(host, login(3000));
    await agent.installPlugins([probe], home);
    expect(readlinkSync(join(home, '.credentials.json'))).toBe(host);
    expect(readFileSync(host, 'utf8')).toBe(login(3000));
  });

  it('fails, naming the credential file and both token variables, without any login', async () => {
    const agent = await agentFor();
    rmSync(join(user, '.claude', '.credentials.json'));
    await expect(
      agent.installPlugins([probe], join(root, 'home')),
    ).rejects.toThrow(
      /\.credentials\.json.*CLAUDE_CODE_OAUTH_TOKEN.*ANTHROPIC_API_KEY/,
    );
    expect(existsSync(join(root, 'home'))).toBe(false);
  });

  it('logs in with an OAuth token from the secrets and makes no credential file', async () => {
    const agent = await agentFor();
    rmSync(join(user, '.claude', '.credentials.json'));
    const home = join(root, 'home');
    const launch = await agent.installPlugins([probe], home, {
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
    });
    expect(launch.home).toBe('built');
    expect(existsSync(join(home, '.credentials.json'))).toBe(false);
    expect(existsSync(join(user, '.claude', '.credentials.json'))).toBe(false);
  });

  it('accepts a token exported in the shell when no secrets are passed', async () => {
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'shell-token');
    const agent = await agentFor();
    rmSync(join(user, '.claude', '.credentials.json'));
    expect((await agent.installPlugins([probe], join(root, 'home'))).home).toBe(
      'built',
    );
  });

  it('approves an API key from the secrets in the home, so the run does not ask', async () => {
    const agent = await agentFor();
    rmSync(join(user, '.claude', '.credentials.json'));
    const home = join(root, 'home');
    const key = 'sk-ant-0123456789-abcdefghijklmnopqrst';
    await agent.installPlugins([probe], home, { ANTHROPIC_API_KEY: key });
    expect(
      JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')),
    ).toMatchObject({
      hasCompletedOnboarding: true,
      customApiKeyResponses: { approved: [key.slice(-20)] },
    });
    expect(existsSync(join(home, '.credentials.json'))).toBe(false);
  });

  it('leaves the home state file alone when onboarding and the API key are already recorded', async () => {
    const agent = await agentFor();
    const home = join(root, 'home');
    const key = 'sk-ant-0123456789-abcdefghijklmnopqrst';
    await agent.installPlugins([probe], home, { ANTHROPIC_API_KEY: key });
    const state = join(home, '.claude.json');
    const past = new Date('2020-01-01T00:00:00Z');
    utimesSync(state, past, past);
    await agent.installPlugins([probe], home, { ANTHROPIC_API_KEY: key });
    expect(statSync(state).mtime).toEqual(past);
    expect(existsSync(`${home}.lock`)).toBe(false);
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

const inAgentHome = (agent: ClaudeAgent) =>
  expect(agent.configDir.startsWith(join(root, 'cache', 'bakers'))).toBe(true);

describe('ClaudeAgent home selection', () => {
  it.each([
    'system',
    'yolo',
  ] as const)('%s mode runs in the host ~/.claude even when marketplaces are declared', (permissions) => {
    const agent = new ClaudeAgent({ permissions }, user);
    agent.useMarketplaces([probe]);
    expect(agent.configDir).toBe(join(user, '.claude'));
    // The conductor's own CLAUDE_CONFIG_DIR never reaches the run; project-declared
    // plugins still install before the first turn.
    expect(agent.launchCommand('go')).toMatch(
      /^env -u CLAUDE_CONFIG_DIR CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1 /,
    );
  });

  it("home: 'individual' opts into the per-marketplace agent home in system mode", () => {
    const agent = new ClaudeAgent(
      { permissions: 'system', home: 'individual' },
      user,
    );
    agent.useMarketplaces([probe]);
    inAgentHome(agent);
  });

  it('an unknown home value fails, naming the option and its values', () => {
    expect(
      () =>
        new ClaudeAgent({ permissions: 'system', home: 'x' as never }, user),
    ).toThrow(/home.*'host'.*'individual'/);
  });

  it.each([
    ['sandbox', false],
    ['custom', false],
    ['system', true],
  ] as const)('%s mode (isolating runtime: %s) keeps the agent home', async (permissions, isolates) => {
    const plugin = claudeAgent({
      permissions,
      ...(permissions === 'custom' ? { config: {} } : {}),
    });
    const agent = (await plugin.createAgent({
      marketplaces: [probe],
      runtime: { isolates },
    } as never)) as ClaudeAgent;
    inAgentHome(agent);
    expect(agent.launchCommand('go')).not.toContain('env -u');
  });

  it("an explicit home: 'host' where only the agent home works fails, naming the option", () => {
    const agent = new ClaudeAgent(
      { permissions: 'sandbox', home: 'host' },
      user,
    );
    expect(() => agent.useMarketplaces([probe])).toThrow(/home: 'host'/);
    const isolated = new ClaudeAgent(
      { permissions: 'yolo', home: 'host' },
      user,
    );
    expect(() => isolated.useMarketplaces([probe], true)).toThrow(
      /home: 'host'/,
    );
  });
});

describe('ClaudeAgent.installPlugins in the host ~/.claude', () => {
  const hostAgent = (options = {}) => {
    const agent = new ClaudeAgent({ permissions: 'system', ...options }, user);
    agent.useMarketplaces([probe]);
    return agent;
  };
  const listed = (markets: unknown[], plugins: unknown[]) => {
    writeFileSync(join(root, 'markets.json'), JSON.stringify(markets, null, 2));
    writeFileSync(join(root, 'plugins.json'), JSON.stringify(plugins, null, 2));
  };
  const host = () => `CLAUDE_CONFIG_DIR= HOME=${user}`;
  const log = () => readFileSync(calls, 'utf8').trim().split('\n');

  it('adds the missing marketplace and plugin with Claude commands, without a credential file', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', join(root, 'elsewhere'));
    rmSync(join(user, '.claude', '.credentials.json'));
    const launch = await hostAgent().installPlugins(
      [probe],
      join(root, 'home'),
    );
    expect(launch).toEqual({ env: {}, args: [], home: 'host' });
    expect(log()).toEqual([
      `${host()} plugin marketplace list --json`,
      `${host()} plugin list --json`,
      `${host()} plugin marketplace add https://probe.invalid/probe.git#vA --json`,
      `${host()} plugin install probe-plugin@probe-market --json`,
    ]);
    expect(existsSync(join(root, 'home'))).toBe(false);
  });

  it('changes nothing that is installed at the pinned ref and enabled', async () => {
    listed(
      [
        {
          name: 'probe-market',
          source: 'git',
          url: 'https://probe.invalid/probe/',
          ref: 'vA',
        },
      ],
      [
        { id: 'probe-plugin@probe-market', scope: 'project', enabled: false },
        { id: 'probe-plugin@probe-market', scope: 'user', enabled: true },
      ],
    );
    const launch = await hostAgent().installPlugins(
      [probe],
      join(root, 'home'),
    );
    expect(launch).toEqual({ env: {}, args: [], home: 'host' });
    expect(log()).toHaveLength(2);
  });

  it('warns, leaving them unchanged, about a marketplace at another ref and a disabled plugin', async () => {
    listed(
      [
        {
          name: 'probe-market',
          source: 'git',
          url: 'https://probe.invalid/probe.git',
          ref: 'vB',
        },
      ],
      [{ id: 'probe-plugin@probe-market', scope: 'user', enabled: false }],
    );
    const launch = await hostAgent().installPlugins(
      [probe],
      join(root, 'home'),
    );
    expect(launch.warnings).toEqual([
      'marketplace probe-market (https://probe.invalid/probe.git): installed ref vB, pinned vA; left unchanged (plugins: probe-plugin)',
      'plugin probe-plugin@probe-market is installed but disabled; left disabled',
    ]);
    expect(log()).toHaveLength(2);
  });

  it.each([
    [
      'a github repo',
      { source: 'github', repo: 'o/r' },
      'https://github.com/o/r.git',
    ],
    [
      'an ssh url',
      { source: 'git', url: 'git@github.com:o/r.git' },
      'https://github.com/o/r',
    ],
  ])('matches a marketplace listed as %s to the declared https url', async (_, source, url) => {
    listed(
      [{ name: 'probe-market', ref: 'vA', ...source }],
      [{ id: 'probe-plugin@probe-market', scope: 'user', enabled: true }],
    );
    const launch = await hostAgent().installPlugins(
      [{ ...probe, url }],
      join(root, 'home'),
    );
    expect(launch.warnings).toBeUndefined();
    expect(log()).toHaveLength(2);
  });

  it('installs a missing plugin from a marketplace already added without a ref', async () => {
    listed(
      [
        {
          name: 'probe-market',
          source: 'git',
          url: 'https://probe.invalid/probe.git',
        },
      ],
      [],
    );
    const launch = await hostAgent().installPlugins(
      [probe],
      join(root, 'home'),
    );
    expect(launch.warnings?.[0]).toContain('installed ref default, pinned vA');
    expect(log().slice(2)).toEqual([
      `${host()} plugin install probe-plugin@probe-market --json`,
    ]);
  });
});

describe('plugins: false', () => {
  it.each([
    'system',
    'yolo',
    'sandbox',
    'custom',
  ] as const)('skips every plugin install in %s mode', async (permissions) => {
    const agent = await claudeAgent({
      permissions,
      ...(permissions === 'custom' ? { config: {} } : {}),
      plugins: false,
    }).createAgent({ marketplaces: [probe] } as never);
    expect(agent.pluginsDisabled).toBe(true);
    expect((agent as ClaudeAgent).configDir).toBe(
      join(process.env.HOME ?? '', '.claude'),
    );
  });
});
