import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setNoAutoSetupMerge } from '../../src/core/git-config.js';

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
