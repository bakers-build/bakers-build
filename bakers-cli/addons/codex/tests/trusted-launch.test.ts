import { exec, spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexAgent } from '../src/index.js';

const execute = promisify(exec);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});

/** An operator home with a Codex home and a `codex` stand-in that reports what it sees. */
async function fixture(config = 'model = "gpt-5"\n') {
  const root = await mkdtemp(join(tmpdir(), 'codex-trusted-'));
  roots.push(root);
  const home = join(root, 'operator');
  const codexHome = join(home, '.codex');
  const bin = join(root, 'bin');
  const cwd = join(root, 'workspace');
  for (const p of [join(codexHome, 'rules'), bin, cwd])
    await mkdir(p, { recursive: true });
  await writeFile(join(codexHome, 'config.toml'), config);
  await writeFile(join(codexHome, 'auth.json'), 'login');
  await writeFile(
    join(codexHome, 'rules', 'default.rules'),
    'prefix_rule(pattern=["make"], decision="allow")\n',
  );
  await writeFile(
    join(bin, 'codex'),
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
if (process.argv[2] === '--version') { console.log(process.env.TEST_CODEX_VERSION || 'codex-cli 0.167.2'); process.exit(0); }
const home = process.env.CODEX_HOME;
const rules = {};
// Real Codex skips linked .rules files; report only regular ones.
for (const name of fs.readdirSync(path.join(home, 'rules'))) if (fs.lstatSync(path.join(home, 'rules', name)).isFile()) rules[name] = fs.readFileSync(path.join(home, 'rules', name), 'utf8');
console.log(JSON.stringify({ home, rules, args: process.argv.slice(2),
  config: fs.readFileSync(path.join(home, 'config.toml'), 'utf8'),
  sessions: fs.realpathSync(path.join(home, 'sessions')) }));
fs.writeFileSync(path.join(home, 'auth.json'), 'refreshed');
if (process.env.TEST_HOLD) setInterval(() => {}, 1000);
else setTimeout(() => { process.exitCode = Number(process.env.TEST_EXIT || 0); }, 300);
`,
    { mode: 0o700 },
  );
  const options = {
    cwd,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      PATH: `${bin}:${process.env.PATH}`,
    },
  };
  const command = (trusted: string[]) =>
    new CodexAgent(
      { permissions: 'sandbox', sandbox: { trusted_commands: trusted } },
      home,
    ).launchCommand('work', undefined, cwd);
  return { root, codexHome, options, command };
}

const ownRule = (rules: Record<string, string>) =>
  Object.entries(rules)
    .filter(([name]) => name !== 'default.rules')
    .map(([, text]) => text)
    .join('');

describe('Codex sandbox.trusted_commands', () => {
  it('runs Codex with this launch’s rules beside the operator’s, then removes them', async () => {
    const f = await fixture();
    const seen = JSON.parse(
      (await execute(f.command(['ddev', 'git push']), f.options)).stdout,
    );
    expect(seen.home).not.toBe(f.codexHome);
    expect(ownRule(seen.rules)).toContain(
      'prefix_rule(pattern=["ddev"], decision="allow"',
    );
    expect(ownRule(seen.rules)).toContain(
      'prefix_rule(pattern=["git", "push"], decision="allow"',
    );
    expect(seen.rules['default.rules']).toContain('["make"]');
    // The run keeps its sandbox and never prompts; no shared daemon serves another home's rules.
    expect(seen.args.slice(0, 3)).toEqual(['--no-daemon', '-a', 'never']);
    expect(seen.args).toContain('default_permissions="bakers"');
    expect(seen.config).toBe('model = "gpt-5"\n');
    expect(seen.sessions).toBe(await realpath(join(f.codexHome, 'sessions')));
    // Credential writes reach the operator's file; the private home is gone.
    expect(await readFile(join(f.codexHome, 'auth.json'), 'utf8')).toBe(
      'refreshed',
    );
    expect(await readdir(join(f.root, 'operator'))).toEqual(['.codex']);
    expect(await readdir(join(f.codexHome, 'rules'))).toEqual([
      'default.rules',
    ]);
  });

  it('gives overlapping launches their own lists and no stale grant', async () => {
    const f = await fixture();
    const [ddev, git] = await Promise.all(
      [['ddev'], ['git']].map(async (list) =>
        JSON.parse((await execute(f.command(list), f.options)).stdout),
      ),
    );
    expect(ddev.home).not.toBe(git.home);
    expect(ownRule(ddev.rules)).not.toContain('"git"');
    expect(ownRule(git.rules)).not.toContain('"ddev"');
    const without = new CodexAgent(
      { permissions: 'sandbox', sandbox: { trusted_commands: [] } },
      join(f.root, 'operator'),
    ).launchCommand('work');
    expect(without).toMatch(/^codex -a never /);
  });

  it('passes on the exit status', async () => {
    const f = await fixture();
    await expect(
      execute(f.command(['ddev']), {
        ...f.options,
        env: { ...f.options.env, TEST_EXIT: '7' },
      }),
    ).rejects.toMatchObject({ code: 7 });
    expect(await readdir(join(f.root, 'operator'))).toEqual(['.codex']);
  });

  it('removes the private home when the run is stopped', async () => {
    const f = await fixture();
    const child = spawn('sh', ['-c', `exec ${f.command(['ddev'])}`], {
      ...f.options,
      env: { ...f.options.env, TEST_HOLD: '1' },
    });
    await new Promise((r) => child.stdout.once('data', r));
    child.kill('SIGTERM');
    const code = await new Promise((r) => child.once('exit', r));
    expect(code).toBe(143);
    expect(await readdir(join(f.root, 'operator'))).toEqual(['.codex']);
  });

  it.each([
    [{ TEST_CODEX_VERSION: 'codex-cli 0.165.9' }, '', /0\.166\.0 or newer/],
    [{}, 'cli_auth_credentials_store = "keyring"\n', /file-backed login/],
  ])('fails clearly when Codex cannot carry the rules', async (env, config, message) => {
    const f = await fixture(config || undefined);
    const failed = execute(f.command(['ddev']), {
      ...f.options,
      env: { ...f.options.env, ...env },
    });
    await expect(failed).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(message),
    });
    expect(await readdir(join(f.root, 'operator'))).toEqual(['.codex']);
  });

  it.each([
    '',
    ' ',
    'ddev *',
    'dd?v',
    'git push; rm -rf /',
    "ddev 'init'",
    '$HOME/bin/x',
    'a`b`',
  ])('rejects %j at load: entries are literal command prefixes', (entry) => {
    expect(
      () =>
        new CodexAgent({
          permissions: 'sandbox',
          sandbox: { trusted_commands: [entry] },
        }),
    ).toThrow(/sandbox.trusted_commands/);
  });
});
