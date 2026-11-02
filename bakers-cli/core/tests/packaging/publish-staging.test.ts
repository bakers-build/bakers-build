import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { stagePackage } from '../../../scripts/prepare-publish.mjs';

const CLI_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const MEASURE_FILES = [
  'agent-proxy.mjs',
  'claude-measure.mjs',
  'keytec-coding.json',
  'keytec-ops.json',
  'keytec-plan.json',
  'keytec-review.json',
];

describe('publish staging copies files entries', () => {
  const fixtures: string[] = [];
  afterEach(() => {
    for (const dir of fixtures.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stages addon-claude measure wrapper, proxy and keytec profiles', () => {
    stagePackage({ dir: 'addons/claude' }, '0.16.3');
    const measure = join(CLI_ROOT, 'addons/claude/publish/measure');
    expect(readdirSync(measure).sort()).toEqual(MEASURE_FILES);
  });

  it('throws when a files glob matches nothing in the staged directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'empty-glob-'));
    fixtures.push(dir);
    mkdirSync(join(dir, 'dist/src'), { recursive: true });
    writeFileSync(join(dir, 'dist/src/index.js'), 'export {}\n');
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify({
        name: '@bakers-build/test-empty-glob',
        description: 'fixture',
        type: 'module',
        license: 'MIT',
        files: ['dist/src', 'missing/*.json'],
        exports: { '.': './dist/src/index.js' },
      })}\n`,
    );

    expect(() => stagePackage({ dir }, '0.16.3')).toThrow(
      /@bakers-build\/test-empty-glob[\s\S]*missing\/\*\.json/,
    );
  });
});

describe('publish staging keeps each package license', () => {
  const fixtures: string[] = [];
  afterEach(() => {
    for (const dir of fixtures.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function fixture(manifest: Record<string, unknown>, files = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'license-'));
    fixtures.push(dir);
    mkdirSync(join(dir, 'dist/src'), { recursive: true });
    writeFileSync(join(dir, 'dist/src/index.js'), 'export {}\n');
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(dir, name), text as string);
    }
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify({
        name: '@bakers-build/test-license',
        description: 'fixture',
        type: 'module',
        files: ['dist/src'],
        exports: { '.': './dist/src/index.js' },
        ...manifest,
      })}\n`,
    );
    return dir;
  }

  it('keeps a non-MIT declaration and the package own license text', () => {
    const isc = 'ISC License\n\nCopyright (c) 2026 Someone Else\n';
    const dir = fixture({ license: 'ISC' }, { LICENSE: isc });

    stagePackage({ dir }, '1.0.0');

    const staged = join(dir, 'publish');
    expect(
      JSON.parse(readFileSync(join(staged, 'package.json'), 'utf8')).license,
    ).toBe('ISC');
    expect(readFileSync(join(staged, 'LICENSE'), 'utf8')).toBe(isc);
  });

  it.each([
    ['UNLICENSED', { license: 'UNLICENSED' }],
    ['missing', {}],
  ])('refuses to stage a public package whose license is %s', (_, manifest) => {
    const dir = fixture(manifest);

    expect(() => stagePackage({ dir }, '1.0.0')).toThrow(
      /@bakers-build\/test-license[\s\S]*license/,
    );
  });

  it('ships the package NOTICE unchanged', () => {
    const notice = 'Contains Unicode data.\n\nUNICODE LICENSE V3\n';
    const dir = fixture({ license: 'MIT' }, { NOTICE: notice });

    stagePackage({ dir }, '1.0.0');

    expect(readFileSync(join(dir, 'publish/NOTICE'), 'utf8')).toBe(notice);
    // npm pack only ships NOTICE when `files` lists it.
    expect(
      JSON.parse(readFileSync(join(dir, 'publish/package.json'), 'utf8')).files,
    ).toContain('NOTICE');
  });

  it('refuses a non-MIT declaration without its own license text', () => {
    const dir = fixture({ license: 'Apache-2.0' });

    expect(() => stagePackage({ dir }, '1.0.0')).toThrow(/Apache-2\.0/);
  });
});
