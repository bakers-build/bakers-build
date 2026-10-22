import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
        files: ['dist/src', 'missing/*.json'],
        exports: { '.': './dist/src/index.js' },
      })}\n`,
    );

    expect(() => stagePackage({ dir }, '0.16.3')).toThrow(
      /@bakers-build\/test-empty-glob[\s\S]*missing\/\*\.json/,
    );
  });
});
