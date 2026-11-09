import { describe, expect, it } from 'vitest';
import { normalizeRepoUrl } from '../../src/index.js';

// The same measured pairs as the mirrors in `ui/tests/route.test.ts`.
describe('normalizeRepoUrl', () => {
  const CANONICAL = 'host/bakers-build/bakers-build';

  it.each([
    ['git@host:bakers-build/bakers-build.git', CANONICAL],
    ['ssh://git@host/bakers-build/bakers-build.git', CANONICAL],
    ['ssh://git@host:2222/bakers-build/bakers-build.git', CANONICAL],
    ['https://host/bakers-build/bakers-build.git', CANONICAL],
    ['https://user@host/bakers-build/bakers-build', CANONICAL],
    ['https://host/bakers-build/bakers-build/', CANONICAL],
    ['HTTPS://Host/bakers-build/bakers-build.GIT', CANONICAL],
    ['git@host:/bakers-build/bakers-build.git', CANONICAL],
  ])('normalises %s to %s', (raw, expected) => {
    expect(normalizeRepoUrl(raw)).toBe(expected);
  });

  it('does not collapse two different repos on the same host', () => {
    expect(normalizeRepoUrl('git@host:bakers-build/bakers-build.git')).not.toBe(
      normalizeRepoUrl('git@host:keytec/shop.git'),
    );
  });

  it.each([
    [''],
    ['   '],
    ['nonsense'],
    ['/repos/bakers'],
    ['https://host'],
    ['git@host:'],
    [undefined],
  ])('yields undefined for %j', (raw) => {
    expect(normalizeRepoUrl(raw)).toBeUndefined();
  });
});
