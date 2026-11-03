import { spawnSync } from 'node:child_process';
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
