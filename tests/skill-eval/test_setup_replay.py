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
  preserved_files: { 'machine/default.js': 'original-uuid' }, no_questions: true,
  forbidden_fragments: { 'project/.bakers/project.config.js': ['@bakers-build/addon-claude', '@bakers-build/addon-essentials'] } } };
const saved = { status: 'completed', turns: [{role:'assistant',content:{type:'final',text:'Success'}}], tools: [],
  files: { 'machine/custom.js': "label: 'chosen'", 'machine/default.js': 'original-uuid' } };
const check = value => checkOutput(fixture, JSON.stringify(value));
assert.ok(check(saved).every(row => row.met));
for (const misplaced of ['@bakers-build/addon-claude', '@bakers-build/addon-essentials']) {
  const changed = structuredClone(saved);
  changed.files['project/.bakers/project.config.js'] = `export default { addons: ['${misplaced}'] };`;
  assert.equal(check(changed).find(row => row.id === 'scope-project/.bakers/project.config.js')?.met, false);
}
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
const typed = {input:{expected_files:{},preserved_files:{},expected_config:{'machine/machine.config.js':{'tunnel':true,'permissions.mode':'sandbox'}}}};
const typedResult = value => checkOutput(typed, JSON.stringify({...saved,files:{'machine/machine.config.js':`export default ${JSON.stringify(value)};`}}));
assert.ok(typedResult({tunnel:true,permissions:{mode:'sandbox'}}).every(row=>row.met));
assert.equal(typedResult({tunnel:false,permissions:{mode:'sandbox'},note:'tunnel true'}).find(row=>row.id==='config-machine/machine.config.js:tunnel')?.met,false);
assert.equal(typedResult({tunnel:'true',permissions:{mode:'sandbox'}}).find(row=>row.id==='config-machine/machine.config.js:tunnel')?.met,false);
'''
        result = subprocess.run(['node', '--input-type=module', '-e', script],
                                cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
