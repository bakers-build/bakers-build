import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const SCRIPT = fileURLToPath(
  new URL('../../../../tests/contract/old-name-gate.sh', import.meta.url),
);

it('the repository carries the old product name only in its exclusion list', () => {
  const out = execFileSync('bash', [SCRIPT], { encoding: 'utf8' });
  expect(out).toContain('PASS');
});
