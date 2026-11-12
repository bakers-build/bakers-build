import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { bwrapRuntime } from '../src/backend.js';

let root: string;
let ws: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bb-bwrap-'));
  const main = join(root, 'main');
  ws = join(root, 'tree');
  mkdirSync(main);
  mkdirSync(join(root, 'cli'));
  git(main, 'init', '-q');
  git(
    main,
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@test',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'base',
  );
  git(main, 'worktree', 'add', '-q', ws, '-b', 'run');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const run = { uuid: 'test-run', id: 1 };
const make = () =>
  bwrapRuntime(
    { readPaths: [] },
    {
      cachePath: join(root, 'cache'),
      cliRoot: join(root, 'cli'),
      env: process.env,
    },
  );

it('creates a private home, keeps secrets out of argv, and records namespace/proc policy', async () => {
  const runtime = make();
  const context = await runtime.prepareRun!(run);
  const launch = await runtime.wrap({
    command: 'true',
    env: { MODEL_TOKEN: 'test-secret' },
    workspacePath: ws,
    run,
    harness: 'any',
    ...context,
  });
  expect(existsSync(context.homePath)).toBe(true);
  expect(launch.env.MODEL_TOKEN).toBe('test-secret');
  expect(launch.command).not.toContain('test-secret');
  const plan = JSON.parse(
    readFileSync(join(root, 'cache/test-run.launch.json'), 'utf8'),
  );
  expect(plan.argv).toContain('--unshare-pid');
  expect(plan.argv).toContain('--unshare-user');
  expect(plan.argv).toContain('--proc');
  expect(plan.argv).not.toContain('--unshare-net');
  expect(plan.argv).toContain('/proc');
  expect(JSON.stringify(plan)).not.toContain('test-secret');
  await runtime.cleanup(run);
  expect(existsSync(context.homePath)).toBe(false);
});

it('rejects invalid run names and refuses a main checkout', async () => {
  const runtime = make();
  await expect(
    runtime.prepareRun!({ uuid: '../escape', id: 1 }),
  ).rejects.toThrow(/uuid/);
  const context = await runtime.prepareRun!(run);
  await expect(
    runtime.wrap({
      command: 'true',
      env: {},
      workspacePath: join(root, 'main'),
      run,
      harness: 'any',
      ...context,
    }),
  ).rejects.toThrow(/linked Git worktree/);
});

const canBwrap =
  process.platform === 'linux' &&
  spawnSync('bwrap', [
    '--unshare-user',
    '--unshare-pid',
    '--ro-bind',
    '/',
    '/',
    '--proc',
    '/proc',
    '--',
    '/bin/true',
  ]).status === 0;
it.skipIf(!canBwrap)(
  'isolates the real process, home, host secrets and inherited environment while Git works',
  async () => {
    const runtime = make();
    const context = await runtime.prepareRun!(run);
    writeFileSync(join(root, 'host-secret'), 'secret');
    const command = `set -eu
test "$HOME" = '${context.homePath}'
test ! -e '${join(root, 'host-secret')}'
test ! -e /var/run/docker.sock
test ! -e /home/cw/.ssh
test ! -e /home/cw/.bakers
test ! -e /proc/${process.pid}
test -z "\${HOST_SECRET:-}"
test "$MODEL_TOKEN" = test-secret
echo x > work.txt
git add work.txt
git -c user.name=t -c user.email=t@t commit -qm run
if git config --local malicious.value x 2>/dev/null; then exit 1; fi
echo isolated`;
    const launch = await runtime.wrap({
      command,
      env: { MODEL_TOKEN: 'test-secret' },
      workspacePath: ws,
      run,
      harness: 'any',
      ...context,
    });
    const result = spawnSync('sh', ['-c', launch.command], {
      env: { ...process.env, ...launch.env, HOST_SECRET: 'hidden' },
      encoding: 'utf8',
      timeout: 15000,
    });
    expect(result.stderr).not.toContain('test-secret');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('isolated');
    expect(git(ws, 'log', '-1', '--format=%s')).toBe('run');
    await runtime.cleanup(run);
  },
);

it('rejects relative grants and writable aliases of protected Git metadata', async () => {
  const runtime = make();
  const context = await runtime.prepareRun!(run);
  const input = {
    command: 'true',
    env: {},
    workspacePath: ws,
    run,
    harness: 'any',
    ...context,
  };
  await expect(
    runtime.wrap({ ...input, readPaths: ['relative'] }),
  ).rejects.toThrow(/relative/);
  const alias = join(root, 'git-alias');
  symlinkSync(join(root, 'main/.git'), alias);
  await expect(runtime.wrap({ ...input, writePaths: [alias] })).rejects.toThrow(
    /protected/,
  );
  await runtime.cleanup(run);
});

it.skipIf(!canBwrap)(
  'stops a running sandbox before removing its home',
  async () => {
    const runtime = make();
    const context = await runtime.prepareRun!(run);
    const launch = await runtime.wrap({
      command: 'echo ready > ready; exec sleep 60',
      env: {},
      workspacePath: ws,
      run,
      harness: 'any',
      ...context,
    });
    const child = spawn('sh', ['-c', launch.command], {
      env: { ...process.env, ...launch.env },
      stdio: 'ignore',
    });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    try {
      for (let i = 0; i < 100 && !existsSync(join(ws, 'ready')); i++)
        await new Promise((resolve) => setTimeout(resolve, 20));
      expect(existsSync(join(ws, 'ready'))).toBe(true);
      await runtime.cleanup(run);
      await exited;
      expect(existsSync(context.homePath)).toBe(false);
      expect(child.exitCode).not.toBeNull();
    } finally {
      child.kill('SIGKILL');
    }
  },
);
