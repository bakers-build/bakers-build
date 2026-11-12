import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { quarantinePlanted, realExec } from '../src/backend.js';

let root: string;
let ws: string;
let marker: string;
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString();

function repo(path: string) {
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q');
  git(path, 'commit', '-q', '--allow-empty', '-m', 'base');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bb-quarantine-'));
  ws = join(root, 'tree');
  marker = join(root, 'ran');
  repo(ws);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function plant(name = 'sub') {
  const sub = join(ws, name);
  repo(sub);
  const hook = join(root, 'fsmonitor');
  writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, {
    mode: 0o755,
  });
  git(sub, 'config', 'core.fsmonitor', hook);
  git(
    ws,
    'update-index',
    '--add',
    '--cacheinfo',
    '160000',
    git(sub, 'rev-parse', 'HEAD').trim(),
    name,
  );
  return sub;
}

it.each([
  'occupied quarantine',
  'unreadable directory',
  'symlink loop',
  'newline path',
])('protects host Git despite %s', async (obstacle) => {
  const sub = plant(obstacle === 'newline path' ? 'sub\nrepo' : 'sub');
  const blocked = join(ws, 'a');
  if (obstacle === 'occupied quarantine') {
    mkdirSync(join(sub, '.git.bakers-quarantine'));
    writeFileSync(join(sub, '.git.bakers-quarantine/keep'), 'x');
  }
  if (obstacle === 'unreadable directory') {
    mkdirSync(blocked);
    chmodSync(blocked, 0o111);
  }
  if (obstacle === 'symlink loop') symlinkSync('.', join(ws, 'loop'));
  git(ws, 'status');
  expect(existsSync(marker)).toBe(true);
  rmSync(marker);
  try {
    await quarantinePlanted(ws, join(ws, '.git'));
    git(ws, 'status');
    expect(existsSync(marker)).toBe(false);
  } finally {
    if (obstacle === 'unreadable directory') chmodSync(blocked, 0o755);
  }
});

it('leaves an outside repository behind a symlink untouched', async () => {
  const outside = join(root, 'outside/repo');
  repo(outside);
  symlinkSync(join(root, 'outside'), join(ws, 'link'));
  await quarantinePlanted(ws, join(ws, '.git'));
  expect(existsSync(join(outside, '.git'))).toBe(true);
});

it('removes an indexed path through a symlink without touching its target', async () => {
  const sub = plant();
  const sha = git(sub, 'rev-parse', 'HEAD').trim();
  git(ws, 'update-index', '--add', '--cacheinfo', '160000', sha, 'link/sub');
  symlinkSync(ws, join(ws, 'link'));
  await quarantinePlanted(ws, join(ws, '.git'));
  expect(git(ws, 'ls-files', '--stage')).not.toContain('link/sub');
  expect(existsSync(join(ws, '.git'))).toBe(true);
});

it('keeps ignored nested clones and their Git metadata', async () => {
  writeFileSync(join(ws, '.gitignore'), 'vendor/\n');
  repo(join(ws, 'vendor/clone'));
  await quarantinePlanted(ws, join(ws, '.git'));
  expect(readdirSync(join(ws, 'vendor/clone'))).toContain('.git');
});

it('removes a gitlink when rename fails and still handles later entries', async () => {
  const blocked = plant('a');
  const later = plant('z');
  chmodSync(blocked, 0o555);
  try {
    await quarantinePlanted(ws, join(ws, '.git'));
    expect(existsSync(join(blocked, '.git'))).toBe(true);
    expect(git(ws, 'ls-files', '--stage')).not.toContain('\ta\n');
    expect(existsSync(join(later, '.git'))).toBe(false);
    git(ws, 'status');
    expect(existsSync(marker)).toBe(false);
  } finally {
    chmodSync(blocked, 0o755);
  }
});

it('keeps host-initialised submodules whose Git directory is protected', async () => {
  const sub = plant();
  const module = join(ws, '.git/modules/sub');
  mkdirSync(join(ws, '.git/modules'));
  git(sub, 'init', '-q', '--separate-git-dir', module);
  await quarantinePlanted(ws, join(ws, '.git'));
  expect(existsSync(join(sub, '.git'))).toBe(true);
  expect(git(ws, 'ls-files', '--stage')).toContain('\tsub\n');
});

it('keeps an uninitialised submodule in the index', async () => {
  git(
    ws,
    'update-index',
    '--add',
    '--cacheinfo',
    '160000',
    git(ws, 'rev-parse', 'HEAD').trim(),
    'missing',
  );
  await quarantinePlanted(ws, join(ws, '.git'));
  expect(git(ws, 'ls-files', '--stage')).toContain('\tmissing\n');
});

it('quarantines the index when a lock prevents removing an unsafe entry', async () => {
  const blocked = plant('a');
  const later = plant('z');
  chmodSync(blocked, 0o555);
  writeFileSync(join(ws, '.git/index.lock'), 'locked');
  try {
    await quarantinePlanted(ws, join(ws, '.git'));
    expect(existsSync(join(later, '.git'))).toBe(false);
    expect(existsSync(join(ws, '.git/index'))).toBe(false);
    expect(
      readdirSync(join(ws, '.git')).some((name) =>
        name.startsWith('index.bakers-quarantine-'),
      ),
    ).toBe(true);
    rmSync(join(ws, '.git/index.lock'));
    git(ws, 'status');
    expect(existsSync(marker)).toBe(false);
  } finally {
    chmodSync(blocked, 0o755);
  }
});

it('quarantines the index when listing it fails', async () => {
  plant();
  await quarantinePlanted(ws, join(ws, '.git'), async (file, args) => {
    if (args.includes('ls-files')) throw new Error('stdout maxBuffer exceeded');
    return realExec(file, args);
  });
  git(ws, 'status');
  expect(existsSync(marker)).toBe(false);
  expect(existsSync(join(ws, '.git/index'))).toBe(false);
});
