import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

const script = new URL('../../../scripts/next-version.mjs', import.meta.url)
  .pathname;
function next(base: string, versions: unknown) {
  return spawnSync('node', [script, base], {
    input: JSON.stringify(versions),
    encoding: 'utf8',
  });
}
it('allocates above every published package, including a partial prior publish', () => {
  expect(
    next('0.6.0', ['0.5.0', '0.6.0-next.41', '0.6.0-next.43']).stdout,
  ).toBe('0.6.0-next.44\n');
  expect(next('0.6.0', []).stdout).toBe('0.6.0-next.1\n');
});
it('rejects a backwards or already stable release base and invalid snapshots', () => {
  for (const versions of [['0.6.0'], ['0.7.0-next.2'], ['invalid'], {}])
    expect(next('0.6.0', versions).status).not.toBe(0);
  expect(next('0.6.0;echo unsafe', []).status).not.toBe(0);
});
