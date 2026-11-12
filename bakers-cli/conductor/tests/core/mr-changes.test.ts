import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  measureMrChanges,
  mrChangesRows,
  parseNumstat,
} from '../../src/core/mr-changes.js';

describe('parseNumstat', () => {
  it('sums added and deleted lines over every changed file', () => {
    expect(parseNumstat('10\t2\ta.ts\n3\t0\tdocs/b.md\n')).toEqual({
      score: 15,
      files_changed: 2,
      additions: 13,
      deletions: 2,
    });
  });

  it('counts a binary file as one file with zero lines', () => {
    expect(parseNumstat('-\t-\tlogo.png\n4\t1\ta.ts\n')).toEqual({
      score: 5,
      files_changed: 2,
      additions: 4,
      deletions: 1,
    });
  });

  it('reports zero for an empty diff', () => {
    expect(parseNumstat('')).toEqual({
      score: 0,
      files_changed: 0,
      additions: 0,
      deletions: 0,
    });
  });
});

describe('mrChangesRows', () => {
  it('writes the four values in definition order with four decimals and one timestamp', () => {
    expect(
      mrChangesRows(
        { score: 71, files_changed: 4, additions: 69, deletions: 2 },
        1700000000,
      ),
    ).toEqual([
      {
        name: 'mr_changes.score',
        value: '71.0000',
        unit: 'lines',
        recorded: 1700000000,
      },
      {
        name: 'mr_changes.files_changed',
        value: '4.0000',
        unit: 'count',
        recorded: 1700000000,
      },
      {
        name: 'mr_changes.additions',
        value: '69.0000',
        unit: 'lines',
        recorded: 1700000000,
      },
      {
        name: 'mr_changes.deletions',
        value: '2.0000',
        unit: 'lines',
        recorded: 1700000000,
      },
    ]);
  });
});

describe('measureMrChanges', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' });

  it('measures the branch against the merge base with its base on origin, renames as renames', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mr-changes-'));
    dirs.push(root);
    const origin = join(root, 'origin.git');
    const work = join(root, 'work');
    git(root, 'init', '--bare', '-b', 'develop', origin);
    git(root, 'clone', origin, work);
    git(work, 'config', 'user.email', 't@example.com');
    git(work, 'config', 'user.name', 't');
    git(work, 'config', 'diff.renames', 'false');
    writeFileSync(join(work, 'old.txt'), 'a\nb\nc\nd\ne\n');
    git(work, 'add', '.');
    git(work, 'commit', '-m', 'base');
    git(work, 'push', 'origin', 'develop');
    git(work, 'checkout', '-b', 'feature');
    git(work, 'mv', 'old.txt', 'new.txt');
    writeFileSync(join(work, 'added.txt'), 'x\ny\n');
    git(work, 'add', '.');
    git(work, 'commit', '-m', 'feature');
    // The base moves on after the fork; that change is not the branch's.
    git(work, 'checkout', 'develop');
    writeFileSync(join(work, 'later.txt'), '1\n2\n3\n');
    git(work, 'add', '.');
    git(work, 'commit', '-m', 'later');
    git(work, 'push', 'origin', 'develop');
    git(work, 'checkout', 'feature');
    git(work, 'reset', '--hard', 'HEAD');

    expect(await measureMrChanges(work, 'develop')).toEqual({
      score: 2,
      files_changed: 2,
      additions: 2,
      deletions: 0,
    });
  });

  it('never lets git read the base branch as an option', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mr-changes-'));
    dirs.push(root);
    const origin = join(root, 'origin.git');
    const work = join(root, 'work');
    git(root, 'init', '--bare', '-b', 'develop', origin);
    git(root, 'clone', '-q', origin, work);
    const pwned = join(work, 'PWNED');

    await expect(
      measureMrChanges(work, `--upload-pack=touch ${pwned}; git-upload-pack`),
    ).rejects.toThrow();
    expect(existsSync(pwned)).toBe(false);
  });
});
