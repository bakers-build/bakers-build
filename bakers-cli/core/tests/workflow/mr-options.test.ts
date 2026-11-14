import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// BB-274 — how a merge request is opened and merged (target, squash commits, delete source
// branch) is prose in three sources that must agree: docs/bakers/git-and-delivery.md, which WORKFLOW.md names as the source
// of the convention, plus the bb-workflow delivery and merge references, which own it operationally.
// The deletion additionally carries a safety condition.
// The assertions are a file contract (tests/contract/merge-request-options.sh, the
// BB-246 shape); no CI job runs this script directly, so without this runner it would be a
// gate in name only. CI runs `pnpm run test` in `bakers-cli`,
// which is why putting the contract behind vitest is what makes the pipeline fail on drift.
const SCRIPT = fileURLToPath(
  new URL(
    '../../../../tests/contract/merge-request-options.sh',
    import.meta.url,
  ),
);

// `execFileSync` throws on a non-zero exit with only the command in its
// `.message`, discarding the script's own stdout — where every `PASS`/`FAIL`
// line lives. Without capturing `.stdout` off the thrown error, a CI failure
// here names nothing about which check failed, only that the process exited
// non-zero (BB-451 review: this hid the CI-only failure this ticket
// investigated).
function runContract(root?: string): string {
  try {
    return execFileSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, ...(root ? { CONTRACT_ROOT: root } : {}) },
    });
  } catch (error) {
    const stdout =
      typeof (error as { stdout?: unknown }).stdout === 'string'
        ? (error as { stdout: string }).stdout
        : '(no stdout captured)';
    throw new Error(
      `${(error as Error).message}\n--- script stdout ---\n${stdout}`,
    );
  }
}

describe('BB-274 merge-request options', () => {
  it('accepts valid gate text longer than a pipe buffer without hiding missing gates', () => {
    const root = mkdtempSync(join(tmpdir(), 'bakers-mr-contract-'));
    const source = resolve(dirname(SCRIPT), '../..');
    const mergePath =
      '.claude/skills/bakers-build/skills/bb-workflow/references/merge.md';
    try {
      for (const path of [
        'docs/bakers/git-and-delivery.md',
        '.claude/skills/bakers-build/skills/bb-workflow/references/working.md',
        '.claude/skills/bakers-build/skills/bb-workflow/references/delivery.md',
        mergePath,
        '.claude/skills/bakers-build/skills/bb-workflow/references/forge.md',
        '.claude/skills/bakers-build/skills/bb-workflow/references/forge-fallback.md',
        '.claude/skills/bakers-build/skills/bb-workflow/references/merge-fallback.md',
      ]) {
        const dest = join(root, path);
        mkdirSync(dirname(dest), { recursive: true });
        let text = readFileSync(join(source, path), 'utf8');
        if (path === mergePath) {
          const end = text.indexOf('\n## ', text.indexOf('## Gates') + 1);
          text = `${text.slice(0, end)}\n${'Additional context. '.repeat(10000)}\n${text.slice(end)}`;
        }
        writeFileSync(dest, text);
      }
      expect(runContract(root)).toContain('all checks passed');
      const merge = join(root, mergePath);
      writeFileSync(
        merge,
        readFileSync(merge, 'utf8').replace(
          'No merge conflict; MR mergeable against its target.',
          'Missing gate.',
        ),
      );
      expect(() => runContract(root)).toThrow(
        'FAIL AC-3 unchanged: gate 3 No merge conflict',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('the file contract over the convention doc + delivery + merge passes', () => {
    const out = runContract();
    expect(out).toContain('all checks passed');
    expect(out).not.toContain('FAIL');
  });

  it('asserts something: the contract runs a non-trivial number of checks', () => {
    const out = runContract();
    expect((out.match(/^PASS /gm) ?? []).length).toBeGreaterThan(40);
  });
});
