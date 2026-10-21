import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveModuleEslintStyle } from '../../src/cli/resolve-module.js';

// A base is a directory whose node_modules should be searched. createRequire
// treats a file path as a module living in that dir; give it a fake resolver
// anchor file so `node_modules/<pkg>` beside it resolves.
function makeFakePackage(root: string, name: string): string {
  const dir = join(root, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, main: 'index.js' }),
  );
  writeFileSync(join(dir, 'index.js'), 'export default 1;\n');
  return dir;
}

describe('resolveModuleEslintStyle', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bakers-resolve-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('resolves a real installed module from the core install base', () => {
    const resolved = resolveModuleEslintStyle('commander', [import.meta.url]);
    expect(resolved).toBeTypeOf('string');
    expect(resolved).toMatch(/commander/);
  });

  it('returns undefined when no base resolves the specifier', () => {
    expect(
      resolveModuleEslintStyle('@bakers-build/does-not-exist', [import.meta.url]),
    ).toBeUndefined();
  });

  it('honours base order — the first base that resolves wins', () => {
    const a = join(tmp, 'a');
    const b = join(tmp, 'b');
    makeFakePackage(a, 'fake-pkg');
    makeFakePackage(b, 'fake-pkg');
    const anchorA = pathToFileURL(join(a, 'index.js')).href;
    const anchorB = pathToFileURL(join(b, 'index.js')).href;
    const resolved = resolveModuleEslintStyle('fake-pkg', [anchorA, anchorB]);
    expect(resolved).toMatch(new RegExp(`${a}.*fake-pkg`));
  });

  it('falls through to a later base when an earlier one cannot resolve', () => {
    const a = join(tmp, 'empty');
    const b = join(tmp, 'has');
    mkdirSync(a, { recursive: true });
    makeFakePackage(b, 'only-in-b');
    const resolved = resolveModuleEslintStyle('only-in-b', [
      pathToFileURL(join(a, 'x.js')).href,
      pathToFileURL(join(b, 'index.js')).href,
    ]);
    expect(resolved).toMatch(/only-in-b/);
  });
});
