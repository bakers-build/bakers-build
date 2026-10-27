import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// The release tool as the repository configures it (root `.versionrc.cjs`), run in a throwaway
// repository: version from conventional commits, VERSION bumped, chore(release) commit, no tag,
// and the next run ranges from the tag on that commit.
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TOOL = join(ROOT, 'bakers-cli/node_modules/.bin/commit-and-tag-version');

const repos: string[] = [];

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'release-version-'));
  repos.push(dir);
  git(dir, 'init', '-q', '-b', 'develop');
  git(dir, 'config', 'user.email', 'test@example.test');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(
    join(dir, '.versionrc.cjs'),
    `module.exports = require(${JSON.stringify(join(ROOT, '.versionrc.cjs'))});\n`,
  );
  writeFileSync(join(dir, 'VERSION'), '0.1.1');
  writeFileSync(
    join(dir, 'CHANGELOG.md'),
    '# Changelog\n\nOne version covers the CLI (`@bakers-build/bakers`) and the server.\n\n## 0.1.1 — 2026-10-23\n\nHand-written history.\n',
  );
  commit(dir, 'chore: seed the version');
  git(dir, 'tag', 'v0.1.1');
  return dir;
}

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function commit(dir: string, message: string): void {
  writeFileSync(join(dir, 'work.txt'), `${message}\n`, { flag: 'a' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
}

function release(dir: string, ...args: string[]): string {
  return execFileSync(TOOL, args, { cwd: dir, encoding: 'utf8' });
}

describe('release version and changelog from conventional commits', () => {
  afterEach(() => {
    for (const dir of repos.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  it('a dry run reports the minor bump and both sections, and writes nothing', () => {
    const dir = repo();
    commit(dir, 'feat(stats): new vs. done flow chart');
    commit(dir, 'fix(cli): read the release version');
    const head = git(dir, 'rev-parse', 'HEAD');

    const out = release(dir, '--dry-run');

    expect(out).toContain('to 0.2.0');
    expect(out).toMatch(/## \[0\.2\.0\]/);
    expect(out).toMatch(
      /### Features\n\n\* \*\*stats:\*\* new vs\. done flow chart/,
    );
    expect(out).toMatch(
      /### Bug Fixes\n\n\* \*\*cli:\*\* read the release version/,
    );
    expect(readFileSync(join(dir, 'VERSION'), 'utf8')).toBe('0.1.1');
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('the real run bumps VERSION, commits chore(release) and creates no tag', () => {
    const dir = repo();
    commit(dir, 'feat(stats): new vs. done flow chart');
    commit(dir, 'fix(cli): read the release version');

    release(dir);

    expect(readFileSync(join(dir, 'VERSION'), 'utf8')).toBe('0.2.0');
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('chore(release): 0.2.0');
    expect(git(dir, 'tag', '--list')).toBe('v0.1.1');
    const changelog = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    expect(changelog).toMatch(
      /^# Changelog\n\nOne version covers the CLI \(`@bakers-build\/bakers`\) and the server\.\n\n## \[0\.2\.0\]/,
    );
    expect(changelog).toContain(
      '## 0.1.1 — 2026-10-23\n\nHand-written history.',
    );
  });

  it('the next run ranges from the tag on the back-merged release commit only', () => {
    const dir = repo();
    commit(dir, 'feat(stats): new vs. done flow chart');
    git(dir, 'switch', '-q', '-c', 'release/2026-10-26-x');
    release(dir);
    git(dir, 'switch', '-q', 'develop');
    git(
      dir,
      'merge',
      '-q',
      '--no-ff',
      '-m',
      'Merge release',
      'release/2026-10-26-x',
    );
    // The release job tags the merge's second parent, the chore(release) commit.
    git(dir, 'tag', 'v0.2.0', 'HEAD^2');
    commit(dir, 'fix(cli): keep the oven running');

    const out = release(dir, '--dry-run');

    expect(out).toContain('from 0.2.0 to 0.2.1');
    expect(out).toContain('keep the oven running');
    expect(out).not.toContain('new vs. done flow chart');
  });

  it('below 1.0 a breaking change bumps minor', () => {
    const dir = repo();
    commit(dir, 'feat(server)!: require client 0.2');

    expect(release(dir, '--dry-run')).toContain('to 0.2.0');
  });
});
