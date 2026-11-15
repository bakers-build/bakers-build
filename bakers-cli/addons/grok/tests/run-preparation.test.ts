import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { encodeGrokSessionCwd, GrokAgent } from '../src/index.js';
import { prepareGrokRun } from '../src/run.js';

let root: string;
let source: string;
let homePath: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bb-grok-run-'));
  source = join(root, '.grok');
  homePath = join(root, 'private');
  mkdirSync(source);
  mkdirSync(homePath);
  for (const name of ['config.toml', 'sandbox.toml', 'requirements.toml'])
    writeFileSync(join(source, name), `# ${name}\n`);
  writeFileSync(join(source, 'auth.json'), '{"token":"login"}', {
    mode: 0o600,
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const prepare = (
  env: Record<string, string> = {},
  hostEnv: Record<string, string> = {},
) =>
  prepareGrokRun({ homePath, workspacePath: '/w/tree', env }, source, hostEnv);

it('builds a private GROK_HOME with copies of the configuration and policy', () => {
  const out = prepare();
  const home = join(homePath, '.grok');
  expect(out.env.GROK_HOME).toBe(home);
  for (const name of ['config.toml', 'sandbox.toml', 'requirements.toml']) {
    expect(readFileSync(join(home, name), 'utf8')).toBe(`# ${name}\n`);
    expect(lstatSync(join(home, name)).isSymbolicLink()).toBe(false);
  }
  expect(out.readPaths).toEqual([]);
});

it('shares the host login file and this worktree transcript folder', () => {
  const out = prepare();
  const home = join(homePath, '.grok');
  const login = join(home, 'auth.json');
  expect(readFileSync(login, 'utf8')).toBe('');
  expect(out.bindPaths).toEqual([
    { source: realpathSync(join(source, 'auth.json')), target: login },
  ]);
  const transcripts = join(source, 'sessions', encodeGrokSessionCwd('/w/tree'));
  expect(out.writePaths).toEqual([transcripts]);
  expect(
    realpathSync(join(home, 'sessions', encodeGrokSessionCwd('/w/tree'))),
  ).toBe(transcripts);
});

it('lets a run or host XAI_API_KEY win over the stored login', () => {
  const run = prepare({ XAI_API_KEY: 'run-key' }, { XAI_API_KEY: 'host-key' });
  expect(run.bindPaths).toBeUndefined();
  expect(run.env.XAI_API_KEY).toBeUndefined();
  rmSync(homePath, { recursive: true });
  mkdirSync(homePath);
  const host = prepare({}, { XAI_API_KEY: 'host-key' });
  expect(host.bindPaths).toBeUndefined();
  expect(host.env.XAI_API_KEY).toBe('host-key');
});

it('GrokAgent.prepareRun prepares from the user Grok home', () => {
  const out = new GrokAgent({}, root).prepareRun({
    homePath,
    workspacePath: '/w/tree',
    env: {},
  });
  expect(out.env.GROK_HOME).toBe(join(homePath, '.grok'));
  expect(out.bindPaths?.[0]?.source).toBe(
    realpathSync(join(source, 'auth.json')),
  );
});

it('hands the managed launcher the run GROK_HOME, else the user Grok home', () => {
  const agent = new GrokAgent(
    { permissions: 'sandbox', sandbox: { allow_write: ['/data/cache'] } },
    root,
  );
  expect(
    agent.launchCommand('work', undefined, '/w', undefined, {
      GROK_HOME: '/run/home/.grok',
    }),
  ).toContain(" '/run/home/.grok' ");
  expect(agent.launchCommand('work')).toContain(` '${source}' `);
});
