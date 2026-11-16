import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CodexAgent } from '../src/index.js';
import { prepareCodexRun } from '../src/run.js';

let root: string;
let source: string;
let homePath: string;
let hostLogin: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bb-codex-run-'));
  source = join(root, 'agent');
  homePath = join(root, 'private');
  mkdirSync(join(source, 'plugins'), { recursive: true });
  mkdirSync(join(source, 'rules'));
  mkdirSync(homePath);
  writeFileSync(join(source, 'config.toml'), 'model = "gpt-5"\n');
  writeFileSync(join(source, 'rules', 'default.rules'), 'prefix_rule()\n');
  hostLogin = join(root, 'host-auth.json');
  writeFileSync(hostLogin, '{"tokens":{}}', { mode: 0o600 });
  // An agent home links the operator's login, as installPlugins does.
  symlinkSync(hostLogin, join(source, 'auth.json'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const prepare = (
  env: Record<string, string> = {},
  hostEnv: Record<string, string> = {},
) =>
  prepareCodexRun({ homePath, workspacePath: '/w/tree', env }, source, hostEnv);

it('builds a private CODEX_HOME with the configuration and read-only plugins', () => {
  const out = prepare();
  const home = join(homePath, '.codex');
  expect(out.env.CODEX_HOME).toBe(home);
  expect(readFileSync(join(home, 'config.toml'), 'utf8')).toBe(
    'model = "gpt-5"\n',
  );
  expect(lstatSync(join(home, 'config.toml')).isSymbolicLink()).toBe(false);
  expect(readFileSync(join(home, 'rules', 'default.rules'), 'utf8')).toBe(
    'prefix_rule()\n',
  );
  expect(lstatSync(join(home, 'rules')).isSymbolicLink()).toBe(false);
  expect(realpathSync(join(home, 'plugins'))).toBe(join(source, 'plugins'));
  expect(out.readPaths).toEqual([join(source, 'plugins')]);
});

it('takes the source home from the run env CODEX_HOME', () => {
  const other = join(root, 'other');
  mkdirSync(other);
  writeFileSync(join(other, 'config.toml'), 'model = "o3"\n');
  const out = prepare({ CODEX_HOME: other });
  expect(
    readFileSync(join(out.env.CODEX_HOME as string, 'config.toml'), 'utf8'),
  ).toBe('model = "o3"\n');
  expect(out.writePaths).toEqual([join(other, 'sessions')]);
});

it('shares the single host login file and the transcript folder, never copies', () => {
  const out = prepare();
  const home = join(homePath, '.codex');
  const login = join(home, 'auth.json');
  expect(readFileSync(login, 'utf8')).toBe('');
  expect(out.bindPaths).toEqual([
    { source: realpathSync(hostLogin), target: login },
  ]);
  expect(out.writePaths).toEqual([join(source, 'sessions')]);
  expect(realpathSync(join(home, 'sessions'))).toBe(join(source, 'sessions'));
  // A write path or bind source inside a read path is refused by the runtimes.
  for (const read of out.readPaths)
    for (const write of [...out.writePaths, realpathSync(hostLogin)])
      expect(write.startsWith(`${read}/`)).toBe(false);
});

it('lets a run or host API key win over the stored login', () => {
  for (const key of ['CODEX_API_KEY', 'OPENAI_API_KEY']) {
    rmSync(homePath, { recursive: true });
    mkdirSync(homePath);
    const run = prepare({ [key]: 'run-key' }, { [key]: 'host-key' });
    expect(run.bindPaths).toBeUndefined();
    expect(run.env[key]).toBeUndefined();
    rmSync(homePath, { recursive: true });
    mkdirSync(homePath);
    const host = prepare({}, { [key]: 'host-key' });
    expect(host.bindPaths).toBeUndefined();
    expect(host.env[key]).toBe('host-key');
  }
});

it('starts without a login when neither a key nor a login file exists', () => {
  rmSync(join(source, 'auth.json'));
  const out = prepare();
  expect(out.bindPaths).toBeUndefined();
});

it('CodexAgent.prepareRun prepares from its configured home', () => {
  const agent = new CodexAgent({}, root);
  agent.configDir = source;
  const out = agent.prepareRun({ homePath, workspacePath: '/w', env: {} });
  expect(out.env.CODEX_HOME).toBe(join(homePath, '.codex'));
  expect(out.readPaths).toEqual([join(source, 'plugins')]);
});

it('shares only the allow-listed directories of a previously used agent home', () => {
  const shared = ['plugins', 'skills', 'packages', '.tmp/marketplaces'];
  const stale = [
    'thread-writer-locks',
    '.tmp/plugins',
    'cache',
    'tui-thread-reference-capabilities',
  ];
  for (const dir of [...shared, ...stale])
    mkdirSync(join(source, dir), { recursive: true });
  writeFileSync(join(source, 'history.jsonl'), '');
  const out = prepare();
  const home = join(homePath, '.codex');
  expect(out.readPaths).toEqual(shared.map((dir) => join(source, dir)));
  for (const dir of shared)
    expect(realpathSync(join(home, dir))).toBe(join(source, dir));
  for (const dir of [
    'thread-writer-locks',
    'cache',
    'tui-thread-reference-capabilities',
  ])
    expect(existsSync(join(home, dir))).toBe(false);
  expect(lstatSync(join(home, '.tmp')).isDirectory()).toBe(true);
  expect(out.writePaths).toEqual([join(source, 'sessions')]);
  expect(out.bindPaths).toEqual([
    { source: realpathSync(hostLogin), target: join(home, 'auth.json') },
  ]);
});

it('takes the key from the secrets the conductor hands out', () => {
  const agent = new CodexAgent();
  expect(agent.secretEnv).toEqual(['CODEX_API_KEY', 'OPENAI_API_KEY']);
  const out = prepareCodexRun(
    {
      homePath,
      workspacePath: '/w/tree',
      env: {},
      secrets: { OPENAI_API_KEY: 'from-file' },
    },
    source,
  );
  expect(out.env.OPENAI_API_KEY).toBe('from-file');
});
