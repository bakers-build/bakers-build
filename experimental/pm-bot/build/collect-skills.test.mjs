// The build-time closure of the bakers.build bundle skills the PM bot ships (collect-skills.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collectSkills } from './collect-skills.mjs';

// A bundle tree under a temp dir: { 'skills/a/SKILL.md': '…' } → <dir>/bundle/skills/a/SKILL.md.
// The output mirrors the bundle's skills/ directory, plus .claude-plugin/plugin.json.
function bundle(files) {
  const dir = mkdtempSync(join(tmpdir(), 'collect-skills-'));
  const root = join(dir, 'bundle');
  const all = { '.claude-plugin/plugin.json': '{"version":"1.2.3"}', ...files };
  for (const [path, body] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return { root, out: join(dir, 'out') };
}

test('copies the named skills and their transitive link closure', () => {
  const { root, out } = bundle({
    'skills/a/SKILL.md': 'See [x](../shared/x.md#h).',
    'skills/shared/x.md': 'Then [y](y.md).',
    'skills/shared/y.md': 'End.',
    'skills/shared/unlinked.md': 'Not reached.',
    'skills/b/SKILL.md': 'Not named.',
  });
  const { files } = collectSkills({ root, skills: ['a'], out });
  assert.deepEqual([...files].sort(), [
    '.claude-plugin/plugin.json',
    'a/SKILL.md',
    'shared/x.md',
    'shared/y.md',
  ]);
  assert.ok(existsSync(join(out, 'shared/y.md')));
  assert.ok(!existsSync(join(out, 'b/SKILL.md')));
});

test('refuses a link that leaves the bundle', () => {
  const { root, out } = bundle({ 'skills/a/SKILL.md': '[o](../../outside.md)' });
  assert.throws(() => collectSkills({ root, skills: ['a'], out }), /^Error: link leaves the bundle/);
});

test('refuses a link to another skill', () => {
  const { root, out } = bundle({ 'skills/a/SKILL.md': '[b](../b/SKILL.md)', 'skills/b/SKILL.md': 'B.' });
  assert.throws(() => collectSkills({ root, skills: ['a'], out }), /^Error: link reaches another skill/);
});

test('refuses a broken link', () => {
  const { root, out } = bundle({ 'skills/a/SKILL.md': '[m](missing.md)' });
  assert.throws(() => collectSkills({ root, skills: ['a'], out }), /^Error: broken link/);
});

test('refuses a link to a directory', () => {
  const { root, out } = bundle({ 'skills/a/SKILL.md': '[d](../shared/)', 'skills/shared/x.md': 'X.' });
  assert.throws(() => collectSkills({ root, skills: ['a'], out }), /^Error: broken link/);
});

test('ignores web links', () => {
  const { root, out } = bundle({ 'skills/a/SKILL.md': '[w](https://example.com/x.md) [m](mailto:a@b.c)' });
  const { files } = collectSkills({ root, skills: ['a'], out });
  assert.deepEqual([...files].sort(), ['.claude-plugin/plugin.json', 'a/SKILL.md']);
});
