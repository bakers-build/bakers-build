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
import { CodexAgent } from '../src/index.js';

const probe = {
  url: 'https://probe.invalid/probe.git',
  ref: 'vA',
  plugins: ['probe-plugin'],
};

let root: string;
let user: string;
let calls: string;

// A `codex` stub: records each call with its CODEX_HOME and answers like the CLI.
function stubCodex(fail = 'no-failure-configured') {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'codex'),
    `#!/bin/sh
echo "CODEX_HOME=$CODEX_HOME HOME=$HOME $*" >> "${calls}"
case "$*" in
  *"${fail}"*) echo 'Error: plugin probe-plugin not found' >&2; exit 1;;
  "plugin marketplace add"*) echo 'Added marketplace \`probe-market\` from https://probe.invalid/probe.git#vA.';;
  *) echo 'Added plugin \`probe-plugin\` from marketplace \`probe-market\`.';;
esac
`,
  );
  chmodSync(join(bin, 'codex'), 0o755);
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bakers-codex-plugins-'));
  user = join(root, 'user');
  mkdirSync(join(user, '.codex', 'sessions'), { recursive: true });
  writeFileSync(join(user, '.codex', 'auth.json'), '{"token":"t"}');
  calls = join(root, 'calls.log');
  vi.stubEnv('XDG_CACHE_HOME', join(root, 'cache'));
  vi.stubEnv('CODEX_HOME', '');
  stubCodex();
});
afterEach(() => vi.unstubAllEnvs());

const agentFor = (options = {}) => {
  const agent = new CodexAgent({ permissions: 'sandbox', ...options }, user);
  agent.useMarketplaces([probe]);
  return agent;
};

describe('CodexAgent.installPlugins', () => {
  it('installs with codex plugin commands under CODEX_HOME=<home>, once, and bypasses hook trust', async () => {
    const agent = agentFor();
    const home = join(root, 'home');
    const launch = await agent.installPlugins([probe], home);
    expect(launch).toEqual({
      env: { CODEX_HOME: home },
      args: ['--dangerously-bypass-hook-trust'],
      home: 'built',
      trust_bypass: ['hook trust'],
    });
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual([
      `CODEX_HOME=${home} HOME=${process.env.HOME} plugin marketplace add https://probe.invalid/probe.git --ref vA`,
      `CODEX_HOME=${home} HOME=${process.env.HOME} plugin add probe-plugin@probe-market`,
    ]);
    expect((await agent.installPlugins([probe], home)).home).toBe('reused');
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('links only auth.json and leaves the user home untouched', async () => {
    const agent = agentFor();
    const home = join(root, 'home');
    await agent.installPlugins([probe], home);
    const links = readdirSync(home).filter((name) =>
      lstatSync(join(home, name)).isSymbolicLink(),
    );
    expect(links).toEqual(['auth.json']);
    expect(readlinkSync(join(home, 'auth.json'))).toBe(
      join(user, '.codex', 'auth.json'),
    );
    expect(readdirSync(join(user, '.codex')).sort()).toEqual([
      'auth.json',
      'sessions',
    ]);
  });

  it('fails, naming the missing auth.json', async () => {
    rmSync(join(user, '.codex', 'auth.json'));
    await expect(
      agentFor().installPlugins([probe], join(root, 'home')),
    ).rejects.toThrow(/auth\.json/);
    expect(existsSync(join(root, 'home'))).toBe(false);
  });

  it('fails, naming the plugin and the harness output, when an install fails', async () => {
    stubCodex('plugin add');
    await expect(
      agentFor().installPlugins([probe], join(root, 'home')),
    ).rejects.toThrow(/probe-plugin.*plugin probe-plugin not found/);
  });
});

describe('CodexAgent with plugins on', () => {
  it('trusts the worktree and passes the plugin args once', () => {
    const cmd = agentFor({ permissions: 'system' }).launchCommand(
      'go',
      undefined,
      '/srv/ws/BB-1',
      undefined,
      {},
      ['--dangerously-bypass-hook-trust'],
    );
    expect(cmd).toContain(`-c 'projects."/srv/ws/BB-1".trust_level="trusted"'`);
    expect(cmd.match(/--dangerously-bypass-hook-trust/g)).toHaveLength(1);
    const yolo = agentFor({ permissions: 'yolo' }).launchCommand(
      'go',
      undefined,
      '/srv/ws/BB-1',
      undefined,
      {},
      ['--dangerously-bypass-hook-trust'],
    );
    expect(yolo.match(/--dangerously-bypass-hook-trust/g)).toHaveLength(1);
  });

  it('reads transcripts from <agent home>/sessions', async () => {
    const agent = agentFor();
    const dir = join(agent.configDir, 'sessions', '2026', '11', '10');
    mkdirSync(dir, { recursive: true });
    const log = `${JSON.stringify({ type: 'session_meta', payload: { cwd: '/srv/ws/BB-1' } })}\n`;
    writeFileSync(join(dir, 'rollout.jsonl'), log);
    expect(await agent.getRunLog('/srv/ws/BB-1')).toBe(log);
  });

  it('reads transcripts from $CODEX_HOME/sessions with plugins off', async () => {
    const own = join(root, 'own-codex');
    vi.stubEnv('CODEX_HOME', own);
    const agent = new CodexAgent({ plugins: false }, user);
    agent.useMarketplaces([probe]);
    expect(agent.pluginsDisabled).toBe(true);
    expect(agent.configDir).toBe(own);
  });
});
