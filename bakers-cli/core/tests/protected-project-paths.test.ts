import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { protectedProjectPaths } from '../src/core/protected-project-paths.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bb-protected-paths-'));
  roots.push(root);
  mkdirSync(join(root, '.bakers'));
  mkdirSync(join(root, '.ddev'));
  writeFileSync(join(root, 'host.sh'), 'true');
  return root;
}
it('always protects .bakers and resolves existing files and directories without duplicates', () => {
  const root = fixture();
  expect(protectedProjectPaths(root, [])).toEqual([join(root, '.bakers')]);
  expect(
    protectedProjectPaths(root, ['.ddev', 'host.sh', '.bakers', '.ddev']),
  ).toEqual([
    join(root, '.bakers'),
    join(root, '.ddev'),
    join(root, 'host.sh'),
  ]);
});
it('fails when the built-in .bakers directory is missing', () => {
  const root = fixture();
  rmSync(join(root, '.bakers'), { recursive: true });
  expect(() => protectedProjectPaths(root, [])).toThrow();
});
it.each([
  'missing',
  '../outside',
  '/etc',
  'a/../../outside',
  'bad\0path',
])('fails closed for %s', (path) => {
  expect(() => protectedProjectPaths(fixture(), [path])).toThrow();
});
it('rejects escaping symlinks and redirects within the worktree, including ancestor symlinks', () => {
  const root = fixture();
  symlinkSync(tmpdir(), join(root, 'escape'));
  symlinkSync('.ddev', join(root, 'redirect'));
  writeFileSync(join(root, '.ddev/host.sh'), 'true');
  for (const path of ['escape', 'redirect', 'redirect/host.sh'])
    expect(() => protectedProjectPaths(root, [path])).toThrow(
      /escapes or redirects/,
    );
});
it('rejects a redirected built-in .bakers directory', () => {
  const root = fixture();
  rmSync(join(root, '.bakers'), { recursive: true });
  symlinkSync('.ddev', join(root, '.bakers'));
  expect(() => protectedProjectPaths(root, [])).toThrow(/escapes or redirects/);
});
