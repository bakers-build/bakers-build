import { exec, spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { GrokAgent } from '../src/index.js';

const execute = promisify(exec);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'grok-profile-'));
  roots.push(root);
  const home = join(root, 'operator');
  const grokHome = join(home, '.grok');
  const cwd = join(root, 'workspace');
  const grant = join(root, 'cache');
  const bin = join(root, 'bin');
  for (const p of [grokHome, cwd, grant, bin])
    await mkdir(p, { recursive: true });
  const original =
    '# User profile without final newline\n[profiles.personal]\nextends = "strict"';
  await writeFile(join(grokHome, 'sandbox.toml'), original);
  await writeFile(join(grokHome, 'auth.json'), 'original login store');
  await writeFile(
    join(bin, 'grok'),
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
if (process.argv.includes('--version')) { console.log(process.env.TEST_GROK_VERSION || 'grok 1.0.70 (test) [stable]'); process.exit(0); }
const home = process.env.GROK_HOME;
const profile = path.join(home, 'sandbox.toml');
console.log(JSON.stringify({home, profile: fs.readFileSync(profile, 'utf8'), args: process.argv.slice(2)}));
if (process.env.TEST_EDIT_PROFILE) fs.appendFileSync(profile, '\\n# concurrent user change\\n');
if (process.env.TEST_HOLD) setInterval(() => {}, 1000);
else process.exitCode = Number(process.env.TEST_EXIT || 0);
`,
    { mode: 0o700 },
  );
  const options = {
    cwd,
    env: { ...process.env, GROK_HOME: '', PATH: `${bin}:${process.env.PATH}` },
  };
  const command = new GrokAgent(
    { sandbox: { allow_write: [grant] } },
    home,
  ).launchCommand('work');
  return { home, grokHome, grant, command, options, original };
}

it('selects a unique workspace profile and restores original config without relocating credentials', async () => {
  const f = await fixture();
  await writeFile(join(f.grokHome, 'requirements.toml'), '');
  const first = JSON.parse((await execute(f.command, f.options)).stdout);
  const second = JSON.parse((await execute(f.command, f.options)).stdout);
  expect(first.home).toBe(f.grokHome);
  const profile = first.args[first.args.indexOf('--sandbox') + 1];
  expect(profile).toMatch(/^bakers_[a-f0-9_]+$/);
  expect(first.profile).toContain(
    `[profiles.${profile}]\nextends = "workspace"\nread_write = `,
  );
  const grants = JSON.parse(first.profile.split('read_write = ')[1].trim());
  expect(grants).toEqual([f.grant]);
  expect(second.args).not.toContain(profile);
  expect(await readFile(join(f.grokHome, 'sandbox.toml'), 'utf8')).toBe(
    f.original,
  );
  expect(await readFile(join(f.grokHome, 'auth.json'), 'utf8')).toBe(
    'original login store',
  );
  await expect(
    readFile(join(f.grokHome, '.bakers-profile.lock')),
  ).rejects.toThrow();
});

it('cleans its profile even when Grok exits unsuccessfully and preserves that exit status', async () => {
  const f = await fixture();
  await expect(
    execute(f.command, {
      ...f.options,
      env: { ...f.options.env, TEST_EXIT: '7' },
    }),
  ).rejects.toMatchObject({ code: 7 });
  expect(await readFile(join(f.grokHome, 'sandbox.toml'), 'utf8')).toBe(
    f.original,
  );
});

it('refuses a conflicting policy, symlink profile or unsupported client before Grok starts', async () => {
  const f = await fixture();
  await expect(
    execute(f.command, {
      ...f.options,
      env: { ...f.options.env, TEST_GROK_VERSION: 'grok 1.0.69' },
    }),
  ).rejects.toMatchObject({ code: 1, stdout: '' });
  await writeFile(
    join(f.grokHome, 'requirements.toml'),
    '[sandbox]\nprofile = "strict"\n',
  );
  await expect(execute(f.command, f.options)).rejects.toMatchObject({
    code: 1,
    stdout: '',
  });
  await rm(join(f.grokHome, 'requirements.toml'));
  await rm(join(f.grokHome, 'sandbox.toml'));
  await symlink(
    join(f.grokHome, 'auth.json'),
    join(f.grokHome, 'sandbox.toml'),
  );
  await expect(execute(f.command, f.options)).rejects.toMatchObject({
    code: 1,
    stdout: '',
  });
  expect(await readFile(join(f.grokHome, 'auth.json'), 'utf8')).toBe(
    'original login store',
  );
});

it('preserves concurrent operator edits and reports the profile that requires cleanup', async () => {
  const f = await fixture();
  await expect(
    execute(f.command, {
      ...f.options,
      env: { ...f.options.env, TEST_EDIT_PROFILE: '1' },
    }),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining('changed during the run'),
  });
  const current = await readFile(join(f.grokHome, 'sandbox.toml'), 'utf8');
  expect(current.startsWith(f.original)).toBe(true);
  expect(current).toContain('# concurrent user change');
  await expect(execute(f.command, f.options)).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining('unfinished Bakers profile'),
  });
});

it('reports unwritable profile storage as a filesystem error instead of a busy run', async () => {
  const f = await fixture();
  // chmod cannot force EACCES when the CI container runs as root.
  const preload = join(f.home, 'deny-lock.cjs');
  await writeFile(
    preload,
    `const fs = require('node:fs/promises');
const { syncBuiltinESMExports } = require('node:module');
const open = fs.open;
fs.open = async (path, ...args) => {
  if (path === ${JSON.stringify(join(f.grokHome, '.bakers-profile.lock'))}) {
    throw Object.assign(new Error('EACCES: permission denied, open ' + path), { code: 'EACCES' });
  }
  return open(path, ...args);
};
syncBuiltinESMExports();
`,
  );
  await expect(
    execute(f.command, {
      ...f.options,
      env: {
        ...f.options.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${preload}`,
      },
    }),
  ).rejects.toMatchObject({
    code: 1,
    stdout: '',
    stderr: expect.stringContaining('EACCES'),
  });
  expect(await readFile(join(f.grokHome, 'sandbox.toml'), 'utf8')).toBe(
    f.original,
  );
});

it('fails closed for a concurrent run and cleans up after termination', async () => {
  const f = await fixture();
  const child = spawn('/bin/sh', ['-c', `exec ${f.command}`], {
    ...f.options,
    env: { ...f.options.env, TEST_HOLD: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exit = new Promise((resolve) => child.once('exit', resolve));
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', () => resolve());
      child.once('error', reject);
      child.once('exit', () =>
        reject(new Error('launcher ended before test readiness')),
      );
    });
    await expect(execute(f.command, f.options)).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: expect.stringContaining('profile busy'),
    });
  } finally {
    child.kill('SIGTERM');
    await exit;
  }
  expect(await readFile(join(f.grokHome, 'sandbox.toml'), 'utf8')).toBe(
    f.original,
  );
});

it('rejects missing/non-directory grants and a conflicting Grok home before agent execution', async () => {
  const f = await fixture();
  for (const grant of [
    join(f.home, 'missing'),
    join(f.grokHome, 'auth.json'),
  ]) {
    const command = new GrokAgent(
      { sandbox: { allow_write: [grant] } },
      f.home,
    ).launchCommand('work');
    await expect(execute(command, f.options)).rejects.toMatchObject({
      code: 1,
      stdout: '',
    });
  }
  await expect(
    execute(f.command, {
      ...f.options,
      env: { ...f.options.env, GROK_HOME: '/tmp/other' },
    }),
  ).rejects.toMatchObject({ code: 1, stdout: '' });
  expect(await readFile(join(f.grokHome, 'sandbox.toml'), 'utf8')).toBe(
    f.original,
  );
});
