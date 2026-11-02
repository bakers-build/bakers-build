import { execFile, execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const scripts = [
  'scripts/setup-worktree.mjs',
  'tests/fixtures/bakers-playground/scripts/setup-worktree.mjs',
];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bakers-env-'));
  roots.push(root);
  execFileSync('git', ['init', '-q', root]);
  mkdirSync(join(root, '.ddev'));
  writeFileSync(join(root, '.ddev/config.yaml'), 'name: bakers\n');
  return root;
}
function run(root: string, script: string) {
  return spawnSync(process.execPath, [resolve('..', script)], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DDEV_WORKTREE_NAME: 'forged',
      PLAYWRIGHT_BASE_URL: 'https://forged.test',
      SYNTHETIC_SECRET: 'never-export-this',
    },
  });
}
describe.each(scripts)('%s', (script) => {
  it('keeps the primary identity and emits only the two public values, repeatably', () => {
    const root = fixture();
    const first = run(root, script);
    expect(first.status, first.stderr).toBe(0);
    expect(readFileSync(join(root, '.env.ddev'), 'utf8')).toBe(
      'DDEV_WORKTREE_NAME=bakers\nPLAYWRIGHT_BASE_URL=https://bakers.ddev.site\n',
    );
    expect(run(root, script).status).toBe(0);
    expect(readFileSync(join(root, '.ddev/config.worktree.yaml'), 'utf8')).toBe(
      'name: bakers\n',
    );
  });
  it('preserves local identity and unrelated bytes, removes duplicates, and repairs an interrupted env write', () => {
    const root = fixture();
    const unrelated = `LOCAL="spaces ' equals= dollars=$HOME $(touch SHOULD_NOT_EXIST)\nDDEV_WORKTREE_NAME=inside-quoted-value"\n`;
    writeFileSync(
      join(root, '.ddev/config.worktree.yaml'),
      'name: kept-name\nadditional_hostnames: [keep-me]\n',
    );
    writeFileSync(
      join(root, '.env.ddev'),
      `${unrelated}DDEV_WORKTREE_NAME=kept-name\nDDEV_WORKTREE_NAME=kept-name\nPLAYWRIGHT_BASE_URL=https://stale.example\n`,
      { mode: 0o600 },
    );
    expect(run(root, script).status).toBe(0);
    expect(readFileSync(join(root, '.env.ddev'), 'utf8')).toBe(
      `${unrelated}DDEV_WORKTREE_NAME=kept-name\nPLAYWRIGHT_BASE_URL=https://kept-name.ddev.site\n`,
    );
    expect(
      readFileSync(join(root, '.ddev/config.worktree.yaml'), 'utf8'),
    ).toContain('additional_hostnames: [keep-me]');
    expect(statSync(join(root, '.env.ddev')).mode & 0o777).toBe(0o600);
    expect(existsSync(join(root, 'SHOULD_NOT_EXIST'))).toBe(false);
    rmSync(join(root, '.env.ddev'));
    expect(run(root, script).status).toBe(0);
    expect(readFileSync(join(root, '.env.ddev'), 'utf8')).toContain(
      'DDEV_WORKTREE_NAME=kept-name',
    );
  });
  it('refuses conflicting or malformed identity before changing either file', () => {
    for (const value of [
      'other-name',
      '$(touch SHOULD_NOT_EXIST)',
      'bad name',
    ]) {
      const root = fixture();
      const overlay = 'name: kept-name\n';
      const env = `DDEV_WORKTREE_NAME=${value}\n`;
      writeFileSync(join(root, '.ddev/config.worktree.yaml'), overlay);
      writeFileSync(join(root, '.env.ddev'), env);
      expect(run(root, script).status).not.toBe(0);
      expect(readFileSync(join(root, '.env.ddev'), 'utf8')).toBe(env);
      expect(
        readFileSync(join(root, '.ddev/config.worktree.yaml'), 'utf8'),
      ).toBe(overlay);
    }
  });
  it.each([
    '.env.ddev',
    '.ddev/config.worktree.yaml',
  ])('refuses symlink output escapes at %s', (output) => {
    const root = fixture();
    const outside = fixture();
    writeFileSync(join(outside, 'private'), 'untouched');
    symlinkSync(join(outside, 'private'), join(root, output));
    expect(run(root, script).status).not.toBe(0);
    expect(readFileSync(join(outside, 'private'), 'utf8')).toBe('untouched');
  });
  it('isolates two linked worktrees with the same branch and literal special characters in their paths', () => {
    const root = fixture();
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
    git(
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '--allow-empty',
      '-qm',
      'root',
    );
    const names: string[] = [];
    for (const path of ["one space $() '", 'two space =']) {
      const wt = join(root, path);
      git('worktree', 'add', '--detach', wt);
      mkdirSync(join(wt, '.ddev'));
      writeFileSync(join(wt, '.ddev/config.yaml'), 'name: bakers\n');
      expect(run(wt, script).status).toBe(0);
      names.push(readFileSync(join(wt, '.ddev/config.worktree.yaml'), 'utf8'));
      expect(names.at(-1)).toMatch(/^name: [a-z][a-z0-9-]{0,51}\n$/);
    }
    expect(names[0]).not.toBe(names[1]);
  });

  it('converges for concurrent setup calls without losing local settings', async () => {
    const root = fixture();
    writeFileSync(join(root, '.env.ddev'), 'LOCAL=keep\n');
    await Promise.all(
      Array.from({ length: 8 }, () =>
        promisify(execFile)(process.execPath, [resolve('..', script)], {
          cwd: root,
        }),
      ),
    );
    expect(readFileSync(join(root, '.env.ddev'), 'utf8')).toBe(
      'LOCAL=keep\nDDEV_WORKTREE_NAME=bakers\nPLAYWRIGHT_BASE_URL=https://bakers.ddev.site\n',
    );
  });
  it('rejects ambiguous unterminated multiline settings before writes', () => {
    const root = fixture();
    const env = 'LOCAL="unterminated\nDDEV_WORKTREE_NAME=hidden-in-value\n';
    writeFileSync(join(root, '.env.ddev'), env);
    expect(run(root, script).status).not.toBe(0);
    expect(readFileSync(join(root, '.env.ddev'), 'utf8')).toBe(env);
  });
  it('recovers a lock left by a dead process when concurrent retries arrive', async () => {
    const root = fixture();
    mkdirSync(join(root, '.ddev/.setup-worktree.lock'));
    writeFileSync(join(root, '.ddev/.setup-worktree.lock/2147483647-dead'), '');
    await Promise.all(
      Array.from({ length: 4 }, () =>
        promisify(execFile)(process.execPath, [resolve('..', script)], {
          cwd: root,
        }),
      ),
    );
    expect(readFileSync(join(root, '.env.ddev'), 'utf8')).toContain(
      'DDEV_WORKTREE_NAME=bakers',
    );
  }, 10000);
  it('refuses unsupported name syntax rather than silently adding another identity', () => {
    const root = fixture();
    const overlay = '"name": existing-name\n';
    writeFileSync(join(root, '.ddev/config.worktree.yaml'), overlay);
    expect(run(root, script).status).not.toBe(0);
    expect(readFileSync(join(root, '.ddev/config.worktree.yaml'), 'utf8')).toBe(
      overlay,
    );
  });
});
