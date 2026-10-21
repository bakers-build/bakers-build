import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// BB-267 — the commit-message convention lives in three prose sources that must agree:
// WORKFLOW.md, @bakers-build/method-context and @bakers-build/merge-mr. The assertions are a file contract
// (tests/contract/commit-convention.sh, the BB-246 shape); that suite is run by
// nothing on its own, so this test runs it — which is what makes `pnpm run test`, hence CI,
// fail when the convention drifts out of any of the three.
const SCRIPT = fileURLToPath(
  new URL('../../../../tests/contract/commit-convention.sh', import.meta.url),
);

describe('BB-267 commit-message convention', () => {
  it('the file contract over WORKFLOW.md + method-context + merge-mr passes', () => {
    const out = execFileSync('bash', [SCRIPT], { encoding: 'utf8' });
    expect(out).toContain('all checks passed');
    expect(out).not.toContain('FAIL');
  });

  it('asserts something: the contract runs a non-trivial number of checks', () => {
    const out = execFileSync('bash', [SCRIPT], { encoding: 'utf8' });
    expect((out.match(/^PASS /gm) ?? []).length).toBeGreaterThan(15);
  });
});
