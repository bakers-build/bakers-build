import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const script = new URL(
  '../../../../scripts/ci/github-branch-policy.sh',
  import.meta.url,
).pathname;
function check(head: string, repository: string) {
  return spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_BASE_REF: 'main',
      GITHUB_HEAD_REF: head,
      GITHUB_REPOSITORY: 'bakers-build/bakers-build',
      HEAD_REPOSITORY: repository,
    },
  });
}
it('only promotes the same repository next branch into stable main', () => {
  expect(check('next', 'bakers-build/bakers-build').status).toBe(0);
  expect(check('feature', 'bakers-build/bakers-build').status).not.toBe(0);
  expect(check('next', 'fork/bakers-build').status).not.toBe(0);
});

it('stable push requires a next merge with exactly the candidate tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'branch-policy-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.test',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.test',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF_NAME: 'main',
  };
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trim();
  const run = () =>
    spawnSync('bash', [script], { cwd: dir, env, encoding: 'utf8' });
  try {
    git('init', '-q', '-b', 'main');
    git('commit', '--allow-empty', '-qm', 'initial');
    expect(run().status).not.toBe(0);
    git('checkout', '-qb', 'next');
    writeFileSync(join(dir, 'candidate'), 'tested');
    git('add', '.');
    git('commit', '-qm', 'candidate');
    git('update-ref', 'refs/remotes/origin/next', 'HEAD');
    git('checkout', '-q', 'main');
    git('merge', '--no-ff', '-qm', 'promote', 'next');
    expect(run().status).toBe(0);
    writeFileSync(join(dir, 'candidate'), 'untested merge edit');
    git('add', '.');
    git('commit', '--amend', '--no-edit', '-q');
    expect(run().status).not.toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
