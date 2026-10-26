import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Repository-property contracts under tests/contract/ that no other job runs. Each script exits
// non-zero on a violation; running it here is what puts it in CI (the `conductor` job).
const contract = (name: string) =>
  fileURLToPath(new URL(`../../../../tests/contract/${name}`, import.meta.url));

const CONTRACTS: Array<[string, string]> = [
  ['bash', 'pathshim-resolution.sh'],
  ['bash', 'phpunit-shard.sh'],
  ['bash', 'test-project-branch.sh'],
  ['bash', 'test-project-guard.sh'],
  ['bash', 'test-users.sh'],
  ['python3', 'skill-comment-example.py'],
  ['python3', 'skill-references.py'],
  ['python3', 'skill-size.py'],
];

describe('repository contracts', () => {
  it.each(CONTRACTS)(
    '%s %s passes',
    (bin, name) => {
      let out: string;
      try {
        out = execFileSync(bin, [contract(name)], {
          encoding: 'utf8',
          stdio: 'pipe',
        });
      } catch (error) {
        // execFileSync keeps the script's own report on the error; surface it.
        const e = error as { stdout?: string; stderr?: string };
        throw new Error(`${name} failed:\n${e.stdout ?? ''}${e.stderr ?? ''}`);
      }
      expect(out).not.toMatch(/^FAIL/m);
      // The shell contracts spawn git, node and stub processes; under a parallel
      // vitest run they outlast the 5 s default.
    },
    60_000,
  );
});
