import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pushCurrentEnv, setNoAutoSetupMerge } from '../src/git-config.js';
import { GitWorkspace } from '../src/index.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

describe('setNoAutoSetupMerge', () => {
  let dir: string;
  let main: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bb-git-config-'));
    const origin = join(dir, 'origin.git');
    main = join(dir, 'main');
    execFileSync('git', ['init', '-q', '--bare', origin]);
    execFileSync('git', ['init', '-q', main]);
    git(
      main,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-qm',
      'initial',
    );
    git(main, 'remote', 'add', 'origin', origin);
    git(main, 'push', '-q', 'origin', 'HEAD:refs/heads/next');
    git(main, 'fetch', '-q', 'origin');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('sets branch.autoSetupMerge to false once, and leaves it when already false', async () => {
    await expect(setNoAutoSetupMerge(main)).resolves.toBe('set');
    expect(git(main, 'config', '--get', 'branch.autoSetupMerge')).toBe('false');
    const config = join(main, '.git', 'config');
    const before = statSync(config).mtimeMs;
    await expect(setNoAutoSetupMerge(main)).resolves.toBe('unchanged');
    expect(statSync(config).mtimeMs).toBe(before);
  });

  it('lets worktree add succeed while a sandbox holds an empty config.lock', async () => {
    await setNoAutoSetupMerge(main);
    const lock = join(main, '.git', 'config.lock');
    writeFileSync(lock, '', { mode: 0o444 });
    const config = git(main, 'config', '--list', '--local');
    git(main, 'worktree', 'add', '-qb', 'run', join(dir, 'run'), 'origin/next');
    // The run branch tracks nothing; its first `push -u` sets the upstream.
    expect(git(main, 'config', '--list', '--local')).toBe(config);
    expect(() =>
      git(join(dir, 'run'), 'rev-parse', '--abbrev-ref', '@{u}'),
    ).toThrow();
  });

  it('throws when the config cannot be written', async () => {
    writeFileSync(join(main, '.git', 'config.lock'), '', { mode: 0o444 });
    await expect(setNoAutoSetupMerge(main)).rejects.toThrow(/config/);
  });
});

describe('pushCurrentEnv', () => {
  it('sets push.default=current at index 0', () => {
    expect(pushCurrentEnv({})).toEqual({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'push.default',
      GIT_CONFIG_VALUE_0: 'current',
    });
  });

  it('appends after an inherited GIT_CONFIG_COUNT', () => {
    expect(
      pushCurrentEnv({
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'safe.directory',
        GIT_CONFIG_VALUE_0: '/repo',
      }),
    ).toEqual({
      GIT_CONFIG_COUNT: '2',
      // Copied, so a run env without the conductor's own entries stays valid.
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '/repo',
      GIT_CONFIG_KEY_1: 'push.default',
      GIT_CONFIG_VALUE_1: 'current',
    });
  });
});

describe('GitWorkspace run branches', () => {
  let dir: string;
  let main: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bb-git-ws-'));
    const origin = join(dir, 'origin.git');
    main = join(dir, 'main');
    execFileSync('git', ['init', '-q', '--bare', origin]);
    execFileSync('git', ['init', '-q', main]);
    git(
      main,
      '-c',
      'user.name=T',
      '-c',
      'user.email=t@example.invalid',
      'commit',
      '--allow-empty',
      '-qm',
      'initial',
    );
    git(main, 'remote', 'add', 'origin', origin);
    git(main, 'push', '-q', 'origin', 'HEAD:refs/heads/next');
    git(main, 'fetch', '-q', 'origin');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('turns off branch.autoSetupMerge before creating a worktree', async () => {
    await new GitWorkspace({ root: main }).ensure('BB-1', 'one');
    expect(git(main, 'config', '--get', 'branch.autoSetupMerge')).toBe('false');
  });

  it('leaves Git alone with autoSetupMerge: true', async () => {
    const ws = await new GitWorkspace({
      root: main,
      autoSetupMerge: true,
    }).ensure('BB-1', 'one');
    expect(() =>
      git(main, 'config', '--get', 'branch.autoSetupMerge'),
    ).toThrow();
    expect(ws.env).toBeUndefined();
  });

  it('lets a plain git push create the same-name remote branch while the shared config.lock is held', async () => {
    const ws = await new GitWorkspace({ root: main }).ensure('BB-1', 'one');
    const branch = git(ws.path, 'symbolic-ref', '--short', 'HEAD');
    // An old run branch that tracks the base must still push to its own name.
    git(main, 'branch', '--set-upstream-to=origin/next', branch);
    const config = join(main, '.git', 'config');
    const before = readFileSync(config);
    writeFileSync(join(main, '.git', 'config.lock'), '', { mode: 0o444 });

    execFileSync('git', ['-C', ws.path, 'push', '-q'], {
      env: { ...process.env, ...ws.env },
    });

    expect(git(join(dir, 'origin.git'), 'branch', '--list', branch)).toBe(
      branch,
    );
    expect(readFileSync(config).equals(before)).toBe(true);
  });
});
