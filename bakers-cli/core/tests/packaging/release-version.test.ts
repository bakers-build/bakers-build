import { execFileSync } from 'node:child_process';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// `release:version <ref> [--notes <file>|-]` in a throwaway repository: the next version and the
// release notes from the Conventional Commits between the last reachable v* tag and <ref>, or
// nothing when there is nothing to release. The `release` job and the plan's dry run share it.
const SCRIPT = fileURLToPath(
  new URL('../../../scripts/release-version.mjs', import.meta.url),
);
const PROJECT_URL = 'https://git.example.test/bakers/oven';

const dirs: string[] = [];

function repo(tag = 'v0.1.1'): string {
  const dir = mkdtempSync(join(tmpdir(), 'release-version-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'develop');
  git(dir, 'config', 'user.email', 'test@example.test');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  commit(dir, 'chore: seed');
  git(dir, 'tag', tag);
  return dir;
}

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function commit(dir: string, message: string): string {
  writeFileSync(join(dir, 'work.txt'), `${message}\n`, { flag: 'a' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

function version(dir: string, ref = 'HEAD'): string {
  return execFileSync('node', [SCRIPT, ref], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, CI_PROJECT_URL: PROJECT_URL },
  });
}

function notes(dir: string, ref = 'HEAD'): { out: string; notes: string } {
  const file = join(dir, '..', `${dir.split('/').pop()}-notes.md`);
  dirs.push(file);
  writeFileSync(file, '');
  const out = execFileSync('node', [SCRIPT, ref, '--notes', file], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, CI_PROJECT_URL: PROJECT_URL },
  });
  return { out, notes: readFileSync(file, 'utf8') };
}

describe('release version and notes from conventional commits', () => {
  it('links GitHub rehearsal notes to the GitHub commit', () => {
    const dir = repo();
    const sha = commit(dir, 'fix: support GitHub delivery');
    const output = execFileSync('node', [SCRIPT, 'HEAD', '--notes', '-'], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        CI_PROJECT_URL: '',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'bakers-build/bakers-build',
      },
    });
    expect(output).toContain(
      `https://github.com/bakers-build/bakers-build/commit/${sha}`,
    );
    expect(output).toContain(
      'https://github.com/bakers-build/bakers-build/compare/v0.1.1...v0.1.2',
    );
  });

  afterEach(() => {
    for (const path of dirs.splice(0))
      rmSync(path, { recursive: true, force: true });
  });

  it('a feature and a fix since v0.1.1 make 0.2.0 with both sections, and change nothing', () => {
    const dir = repo();
    const feat = commit(dir, 'feat(stats): new vs. done flow chart');
    const fix = commit(dir, 'fix(cli): read the release version');

    const result = notes(dir);

    expect(result.out).toBe('0.2.0\n');
    expect(result.notes).toContain(
      `[0.2.0](${PROJECT_URL}/compare/v0.1.1...v0.2.0)`,
    );
    expect(result.notes).toContain(
      `### Features\n\n* **stats:** new vs. done flow chart ([${feat.slice(0, 7)}](${PROJECT_URL}/commits/${feat}))`,
    );
    expect(result.notes).toContain(
      `### Bug Fixes\n\n* **cli:** read the release version ([${fix.slice(0, 7)}](${PROJECT_URL}/commits/${fix}))`,
    );
    expect(result.notes).not.toContain('Breaking');
    expect(git(dir, 'tag', '--list')).toBe('v0.1.1');
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(fix);
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  it('ranges from a tag on a commit merged into develop and skips merge subjects', () => {
    const dir = repo();
    commit(dir, 'feat(stats): new vs. done flow chart');
    git(dir, 'switch', '-q', '-c', 'release/x');
    commit(dir, 'chore(release): 0.2.0');
    git(dir, 'tag', 'v0.2.0');
    git(dir, 'switch', '-q', 'develop');
    git(
      dir,
      'merge',
      '-q',
      '--no-ff',
      '-m',
      "Merge branch 'release/x' into 'develop'",
      'release/x',
    );
    commit(dir, 'fix(cli): keep the oven running');

    const result = notes(dir);

    expect(result.out).toBe('0.2.1\n');
    expect(result.notes).toContain('keep the oven running');
    expect(result.notes).not.toContain('new vs. done flow chart');
    expect(result.notes).not.toContain('Merge branch');
  });

  it('releases nothing for an already tagged ref', () => {
    const dir = repo();
    commit(dir, 'feat(stats): new vs. done flow chart');
    git(dir, 'tag', 'v0.2.0');

    expect(version(dir)).toBe('');
    expect(version(dir, 'HEAD~1')).toBe('');
  });

  it('releases nothing for a ref below a newer tag', () => {
    const dir = repo();
    const old = commit(dir, 'fix(cli): keep the oven running');
    commit(dir, 'feat(stats): new vs. done flow chart');
    git(dir, 'tag', 'v0.2.0');

    expect(version(dir, old)).toBe('');
  });

  it('`--notes -` prints the version, then the notes, on stdout redirected to a file', () => {
    const dir = repo();
    commit(dir, 'feat(stats): new vs. done flow chart');
    const file = `${dir}-stdout.md`;
    dirs.push(file);
    const fd = openSync(file, 'w');
    execFileSync('node', [SCRIPT, 'HEAD', '--notes', '-'], {
      cwd: dir,
      stdio: ['ignore', fd, 'inherit'],
      env: { ...process.env, CI_PROJECT_URL: PROJECT_URL },
    });
    closeSync(fd);

    const [first, heading] = readFileSync(file, 'utf8').split('\n');
    expect(first).toBe('0.2.0');
    expect(heading).toMatch(
      new RegExp(
        `^## \\[0\\.2\\.0\\]\\(${PROJECT_URL}/compare/v0\\.1\\.1\\.\\.\\.v0\\.2\\.0\\)`,
      ),
    );
  });

  it('releases nothing when only chores and docs lie in the range', () => {
    const dir = repo();
    commit(dir, 'chore(ci): faster ovens');
    commit(dir, 'docs: explain the dough');

    expect(notes(dir)).toEqual({ out: '', notes: '' });
  });

  it('below 1.0 a breaking change bumps minor', () => {
    const dir = repo();
    commit(dir, 'feat(server)!: require client 0.2');

    const result = notes(dir);

    expect(result.out).toBe('0.2.0\n');
    expect(result.notes).toContain(
      '### ⚠ Breaking Changes\n\n* **server:** require client 0.2',
    );
  });

  it('from 1.0 a BREAKING CHANGE footer bumps major and a fix bumps patch', () => {
    const dir = repo('v1.4.2');
    commit(dir, 'fix: crisper crust');
    expect(version(dir)).toBe('1.4.3\n');

    commit(dir, 'feat(api): new ovens\n\nBREAKING CHANGE: old ovens are gone');
    expect(version(dir)).toBe('2.0.0\n');
  });

  it('starts from 0.0.0 without a tag', () => {
    const dir = repo();
    git(dir, 'tag', '-d', 'v0.1.1');
    commit(dir, 'feat: first loaf');

    expect(version(dir)).toBe('0.1.0\n');
  });
});
