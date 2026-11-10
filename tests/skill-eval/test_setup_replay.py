"""Saved configuration, rather than a success claim, decides setup checks."""
from pathlib import Path
import subprocess
import unittest


class SetupReplayTest(unittest.TestCase):
    def test_missing_wrong_and_preserved_configuration(self):
        script = '''
import assert from 'node:assert/strict';
import { checkOutput } from './tests/skill-eval/profiles/setup.mjs';
const fixture = { input: { expected_files: { 'machine/custom.js': ["label: 'chosen'"] },
  preserved_files: { 'machine/default.js': 'original-uuid' }, no_questions: true } };
const saved = { status: 'completed', turns: [{role:'assistant',content:{type:'final',text:'Success'}}], tools: [],
  files: { 'machine/custom.js': "label: 'chosen'", 'machine/default.js': 'original-uuid' } };
const check = value => checkOutput(fixture, JSON.stringify(value));
assert.ok(check(saved).every(row => row.met));
for (const replacement of [undefined, "label: 'wrong'"]) {
  const changed = structuredClone(saved);
  changed.files['machine/custom.js'] = replacement;
  assert.equal(check(changed).find(row => row.id === 'file-1').met, false);
}
const changed = structuredClone(saved);
changed.files['machine/default.js'] = 'regenerated-uuid';
assert.equal(check(changed).find(row => row.id === 'preserved-2').met, false);
assert.throws(() => checkOutput(fixture, '{}'), /Malformed/);
assert.throws(() => checkOutput(fixture, 'not json'));
'''
        result = subprocess.run(['node', '--input-type=module', '-e', script],
                                cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
