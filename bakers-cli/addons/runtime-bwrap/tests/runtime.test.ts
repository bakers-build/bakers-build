import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { protectedProjectPaths } from '@bakers-build/core';
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
function snapshot(path: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (relative: string) => {
    for (const name of readdirSync(join(path, relative))) {
      const file = join(relative, name);
      if (lstatSync(join(path, file)).isDirectory()) visit(file);
      else files[file] = readFileSync(join(path, file)).toString('hex');
    }
  };
  visit('');
  return files;
}

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
    const protectedDirs = ['.bakers', '.ddev'].map((path) => join(ws, path));
    for (const path of protectedDirs) mkdirSync(path);
    const protectedFiles = [
      join(ws, '.bakers/host.sh'),
      join(ws, '.ddev/config.yaml'),
    ];
    for (const path of protectedFiles) writeFileSync(path, 'trusted');
    const hostConfig = readFileSync(join(root, 'main/.git/config'), 'utf8');
    const main = join(root, 'main');
    const sibling = join(root, 'sibling');
    git(main, 'worktree', 'add', '-qb', 'sibling', sibling);
    const parentBranch = git(main, 'symbolic-ref', '--short', 'HEAD');
    const parentCommit = git(main, 'rev-parse', 'HEAD');
    const parentBefore = snapshot(join(main, '.git'));
    const siblingBefore = snapshot(sibling);
    const attackPaths = [
      join(main, '.git/refs/heads', parentBranch),
      join(main, '.git/index'),
      join(
        main,
        '.git/objects',
        parentCommit.slice(0, 2),
        parentCommit.slice(2),
      ),
      join(main, '.git/logs/HEAD'),
      join(main, '.git/config'),
      join(main, '.git/hooks/pre-commit'),
      join(main, '.git/worktrees/sibling/gitdir'),
    ];
    const command = `set -eu
test "$HOME" = '${context.homePath}'
test ! -e '${join(root, 'host-secret')}'
test ! -e /var/run/docker.sock
test ! -e /home/cw/.ssh
test ! -e /home/cw/.bakers
test ! -e /proc/${process.pid}
test -z "\${HOST_SECRET:-}"
test "$MODEL_TOKEN" = test-secret
test "$(cat '${join(ws, '.ddev/generated.yaml')}')" = generated
for path in ${protectedFiles.map((path) => `'${path}'`).join(' ')}; do
  if (printf attack > "$path") 2>/dev/null; then exit 1; fi
  if (printf attack > "$(dirname "$path")/created") 2>/dev/null; then exit 1; fi
  if mv "$path" "$path.moved" 2>/dev/null; then exit 1; fi
  if rm "$path" 2>/dev/null; then exit 1; fi
done
echo x > work.txt
git add work.txt
git -c user.name=t -c user.email=t@t commit -qm run
git config --local local.value x
git update-ref 'refs/heads/${parentBranch}' HEAD
git update-ref refs/heads/sibling HEAD
for path in ${attackPaths.map((path) => `'${path}'`).join(' ')}; do
  mkdir -p "$(dirname "$path")" 2>/dev/null || true
  (printf attack > "$path") 2>/dev/null || true
  mv "$path" "$path.moved" 2>/dev/null || true
  rm -f "$path.moved" 2>/dev/null || true
done
echo isolated`;
    const launch = await runtime.wrap({
      command,
      env: { MODEL_TOKEN: 'test-secret' },
      workspacePath: ws,
      readPaths: protectedDirs,
      run,
      harness: 'any',
      ...context,
    });
    writeFileSync(join(ws, '.ddev/generated.yaml'), 'generated');
    const protectedBefore = protectedDirs.map((path) => snapshot(path));
    const result = spawnSync('sh', ['-c', launch.command], {
      env: { ...process.env, ...launch.env, HOST_SECRET: 'hidden' },
      encoding: 'utf8',
      timeout: 15000,
    });
    expect(result.stderr).not.toContain('test-secret');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('isolated');
    expect(protectedDirs.map((path) => snapshot(path))).toEqual(
      protectedBefore,
    );
    expect(snapshot(join(main, '.git'))).toEqual(parentBefore);
    expect(snapshot(sibling)).toEqual(siblingBefore);
    expect(git(ws, 'log', '-1', '--format=%s')).toBe('base');
    const record = JSON.parse(
      readFileSync(join(root, 'cache/test-run.git.json'), 'utf8'),
    );
    const commit = git(ws, `--git-dir=${record.path}`, 'rev-parse', 'HEAD');
    expect(git(ws, `--git-dir=${record.path}`, 'rev-parse', parentBranch)).toBe(
      commit,
    );
    expect(git(ws, `--git-dir=${record.path}`, 'rev-parse', 'sibling')).toBe(
      commit,
    );
    await runtime.transferCommit!(run.uuid, commit);
    expect(git(ws, 'log', '-1', '--format=%s')).toBe('run');
    expect(git(main, 'rev-parse', parentBranch)).toBe(parentCommit);
    expect(git(main, 'rev-parse', 'sibling')).toBe(parentCommit);
    expect(readFileSync(join(root, 'main/.git/config'), 'utf8')).toBe(
      hostConfig,
    );
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

it('overlays private metadata while host refs and requested paths stay read-only', async () => {
  const runtime = make();
  const context = await runtime.prepareRun!(run);
  const readPath = join(ws, 'protected');
  mkdirSync(readPath);
  await runtime.wrap({
    command: 'true',
    env: {},
    workspacePath: ws,
    run,
    harness: 'any',
    readPaths: [readPath],
    ...context,
  });
  const record = JSON.parse(
    readFileSync(join(root, 'cache/test-run.git.json'), 'utf8'),
  );
  const plan = JSON.parse(
    readFileSync(join(root, 'cache/test-run.launch.json'), 'utf8'),
  );
  const mounts: string[][] = [];
  for (let index = 0; index < plan.argv.length; index++)
    if (['--bind', '--ro-bind'].includes(plan.argv[index]))
      mounts.push(plan.argv.slice(index, index + 3));
  expect(record.path).toBe(join(root, 'cache/test-run.git'));
  expect(record.path.startsWith(`${context.homePath}/`)).toBe(false);
  expect(mounts).toContainEqual(['--bind', record.path, record.gitDir]);
  expect(mounts).toContainEqual([
    '--ro-bind',
    join(ws, '.git'),
    join(ws, '.git'),
  ]);
  expect(mounts).toContainEqual(['--ro-bind', readPath, readPath]);
  expect(mounts).toContainEqual([
    '--ro-bind',
    record.commonDir,
    record.commonDir,
  ]);
  expect(
    mounts.some(
      ([mode, source]) =>
        mode === '--bind' &&
        (source === record.commonDir ||
          source.startsWith(`${record.commonDir}/`)),
    ),
  ).toBe(false);
  expect(
    mounts.findIndex(([, , target]) => target === readPath),
  ).toBeGreaterThan(mounts.findIndex(([, , target]) => target === ws));
  await runtime.cleanup(run);
});
it('transfers local commits through the runtime capability into only the ticket branch', async () => {
  const main = join(root, 'main');
  git(main, 'branch', 'sibling');
  const refs = git(main, 'show-ref');
  const runtime = make();
  const context = await runtime.prepareRun!(run);
  await runtime.wrap({
    command: 'true',
    env: {},
    workspacePath: ws,
    ticketBranch: 'run',
    run,
    harness: 'any',
    ...context,
  });
  const recordPath = join(root, 'cache/test-run.git.json');
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  const local = (...args: string[]) =>
    git(ws, `--git-dir=${record.path}`, ...args);
  writeFileSync(join(ws, 'local.txt'), 'local');
  local('add', 'local.txt');
  local(
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@test',
    'commit',
    '-qm',
    'private',
  );
  const commit = local('rev-parse', 'HEAD');
  local('update-ref', 'refs/heads/sibling', commit);
  expect(git(main, 'show-ref')).toBe(refs);
  await runtime.transferCommit!(run.uuid, commit);
  expect(git(main, 'rev-parse', 'run')).toBe(commit);
  expect(git(main, 'rev-parse', 'sibling')).toBe(record.expected);
  expect(git(main, 'rev-parse', 'HEAD')).toBe(record.expected);
  expect(JSON.parse(readFileSync(recordPath, 'utf8')).expected).toBe(commit);
  await runtime.cleanup(run);
});

it.runIf(canBwrap)(
  'pins ancestors of nested protected files against rename and replacement',
  async () => {
    mkdirSync(join(ws, '.bakers'));
    mkdirSync(join(ws, 'scripts'));
    writeFileSync(join(ws, 'scripts/host.sh'), 'trusted\n');
    const runtime = make();
    const context = await runtime.prepareRun!(run);
    try {
      const launch = await runtime.wrap({
        command:
          'if mv scripts moved 2>/dev/null; then exit 71; fi; if echo attack > scripts/host.sh 2>/dev/null; then exit 72; fi; test "$(cat scripts/host.sh)" = trusted',
        env: {},
        workspacePath: ws,
        run,
        harness: 'any',
        ...context,
        readPaths: protectedProjectPaths(ws, ['scripts/host.sh']),
      });
      const result = spawnSync('sh', ['-c', launch.command], {
        env: { ...process.env, ...launch.env },
        encoding: 'utf8',
        timeout: 30000,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(join(ws, 'scripts/host.sh'), 'utf8')).toBe(
        'trusted\n',
      );
    } finally {
      await runtime.cleanup(run);
    }
  },
);
