import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { changelogEntry } from '../../../scripts/changelog.mjs';

const repos: string[] = [];

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'changelog-'));
  repos.push(dir);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.email', 'test@example.test');
  git('config', 'user.name', 'test');
  git('config', 'commit.gpgsign', 'false');
  return dir;
}

function commit(dir: string, message: string, files: string[]): void {
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), `${message}\n`, { flag: 'a' });
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

type Mr = { iid: number; title: string; labels: string[] };

/** Stands in for GitLab: the squash commit's subject names its merge request. */
function mergeRequests(bySubject: Record<string, Mr>) {
  return async ({ subject }: { subject: string }) => bySubject[subject] ?? null;
}

describe('release changelog entry', () => {
  afterEach(() => {
    for (const dir of repos.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  it('lists labelled merge requests since the last version tag under CLI and Server', async () => {
    const dir = repo();
    commit(dir, 'Released before', ['bakers-cli/old.ts']);
    execFileSync('git', ['tag', 'v0.1.0'], { cwd: dir });
    commit(dir, 'Add oven pause', ['bakers-cli/conductor/src/pause.ts']);
    commit(dir, 'Keep ticket filters on reload', [
      'web/modules/custom/bb_core/x.php',
    ]);
    commit(dir, 'Version contract on both sides', [
      'bakers-cli/core/src/version.ts',
      'web/modules/custom/bb_core/version.php',
    ]);
    commit(dir, 'Bump tooling', ['composer.json']);
    commit(dir, 'Fix a typo in the docs', ['docs/index.md']);
    commit(dir, 'Pushed without a merge request', ['config/sync/x.yml']);

    const result = await changelogEntry({
      cwd: dir,
      version: '0.2.0',
      date: '2026-10-23',
      mergeRequestOf: mergeRequests({
        'Released before': {
          iid: 1,
          title: 'Released before',
          labels: ['feature'],
        },
        'Add oven pause': {
          iid: 2,
          title: 'Add oven pause',
          labels: ['feature'],
        },
        'Keep ticket filters on reload': {
          iid: 3,
          title: 'Keep ticket filters on reload',
          labels: ['bug'],
        },
        'Version contract on both sides': {
          iid: 4,
          title: 'Version contract on both sides',
          labels: ['breaking', 'feature'],
        },
        'Bump tooling': {
          iid: 5,
          title: 'Bump tooling',
          labels: ['maintenance'],
        },
        'Fix a typo in the docs': {
          iid: 6,
          title: 'Fix a typo in the docs',
          labels: [],
        },
      }),
    });

    expect(result.entry).toBe(
      [
        '## 0.2.0 — 2026-10-23',
        '',
        '### CLI',
        '',
        '#### Breaking changes',
        '',
        '- Version contract on both sides (!4)',
        '',
        '#### Features',
        '',
        '- Add oven pause (!2)',
        '',
        '### Server',
        '',
        '#### Breaking changes',
        '',
        '- Version contract on both sides (!4)',
        '',
        '#### Fixes',
        '',
        '- Keep ticket filters on reload (!3)',
        '',
        '#### Maintenance',
        '',
        '- Bump tooling (!5)',
        '',
      ].join('\n'),
    );
    expect(result.skipped).toEqual([
      'no merge request: Pushed without a merge request',
      'no release label: !6 Fix a typo in the docs',
    ]);
  });

  it('reads the whole history before the first release and names an empty side', async () => {
    const dir = repo();
    commit(dir, 'First server feature', ['config/sync/x.yml']);

    const result = await changelogEntry({
      cwd: dir,
      version: '0.1.0',
      date: '2026-10-23',
      mergeRequestOf: mergeRequests({
        'First server feature': {
          iid: 1,
          title: 'First server feature',
          labels: ['feature'],
        },
      }),
    });

    expect(result.entry).toBe(
      [
        '## 0.1.0 — 2026-10-23',
        '',
        '### CLI',
        '',
        'No changes.',
        '',
        '### Server',
        '',
        '#### Features',
        '',
        '- First server feature (!1)',
        '',
      ].join('\n'),
    );
    expect(result.skipped).toEqual([]);
  });
});
