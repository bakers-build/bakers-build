"""Saved configuration, rather than a success claim, decides setup checks."""
from pathlib import Path
import subprocess
import unittest


class SetupReplayTest(unittest.TestCase):
    def test_missing_wrong_and_preserved_configuration(self):
        script = '''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const untouched = {input:{expected_files:{},preserved_files:{a:'first',b:'second'},no_writes:true}};
const noWrites = files => checkOutput(untouched, JSON.stringify({...saved,files})).find(row=>row.id==='no-writes').met;
assert.equal(noWrites({b:'second',a:'first'}),true);
for (const files of [{a:'first'}, {a:'changed',b:'second'}, {a:'first',b:'second',c:'new'}]) assert.equal(noWrites(files),false);
const ask = text => ({role:'assistant',content:{type:'question',text}});
const blocks = {input:{expected_files:{},preserved_files:{},max_questions:2,derived_sources:['git remote get-url origin','gh auth status']}};
const asked = turns => checkOutput(blocks, JSON.stringify({...saved,turns}));
const row = (turns, id) => asked(turns).find(r=>r.id===id).met;
const preview = ask('forge: github — source: git remote get-url origin\\nauth: gh — source: gh auth status');
assert.equal(row([preview, ask('Grants?')], 'max-questions'), true);
assert.equal(row([preview, ask('Grants?'), ask('Hook after_create?')], 'max-questions'), false);
assert.equal(row([preview], 'derived-source-git remote get-url origin'), true);
assert.equal(row([ask('forge: github\\nauth: gh — source: gh auth status')], 'derived-source-git remote get-url origin'), false);
const open = {input:{expected_files:{},preserved_files:{},asked_values:['repository']}};
const openRow = text => checkOutput(open, JSON.stringify({...saved,turns:[ask(text)]})).find(r=>r.id==='asked-repository').met;
assert.equal(openRow('repository: ? — asked'), true);
assert.equal(openRow('repository: acme/shop — source: git remote get-url origin'), false);
// A source counts only on its value's preview line, never anywhere in the question.
assert.equal(row([ask('Run git remote get-url origin first?\\nforge: github — recommended')], 'derived-source-git remote get-url origin'), false);
const hooks = {input:{expected_files:{},preserved_files:{},previewed_keys:['after_create','on_resume']}};
const hookRow = (text, key) => checkOutput(hooks, JSON.stringify({...saved,turns:[ask(text)]})).find(r=>r.id===`previewed-${key}`).met;
assert.equal(hookRow('after_create: .bakers/scripts/prepare.sh — recommended\\non_resume: none — recommended', 'on_resume'), true);
// A preview that omits a hook leaves it unresolved, even when the prose mentions it.
assert.equal(hookRow('after_create: .bakers/scripts/prepare.sh — recommended\\nThe on_resume hook stays unset.', 'on_resume'), false);
// Each read or fetch of a documentation page counts toward the budget; skill and config reads do not.
// defaults.json is the budget's one source; every setup case inherits it.
const { max_doc_loads: limit } = JSON.parse(readFileSync('tests/skill-eval/fixtures/setup/defaults.json', 'utf8'));
assert.equal(limit, 8);
const budget = {input:{expected_files:{},preserved_files:{},max_doc_loads:limit}};
const loads = tools => checkOutput(budget, JSON.stringify({...saved,tools})).find(r=>r.id==='max-doc-loads').met;
const page = n => n % 2 ? {action:{type:'read',path:`docs/page-${n}.md`}} : {action:{type:'command',argv:['curl','-fsSL',`https://bakers.build/page-${n}.md`]}};
const others = [{action:{type:'read',path:'.claude/skills/bakers-build/skills/bb-init/SKILL.md'}}, {action:{type:'read',path:'project/WORKFLOW.md'}}];
assert.equal(loads([...others, ...Array.from({length:limit}, (_, n) => page(n))]), true);
assert.equal(loads([...others, ...Array.from({length:limit + 1}, (_, n) => page(n))]), false);
// Quick start: no sudo or sandbox tools, a complete final overview, ticket calls in order, a repeated question.
const run = argv => ({action:{type:'command',argv}});
const quick = {input:{expected_files:{},preserved_files:{},forbidden_commands:['sudo','bwrap','git init'],
  final_fragments:['✔','https://bakers.build/get-started/#advanced-setup'], min_questions:2,
  tool_sequence:[{tool:'bakers_ticket_create',fragments:[]},{tool:'bakers_ticket_update',fragments:['human-review']},{tool:'bakers_ticket_update',fragments:['conductor']}]}};
const final = text => ({role:'assistant',content:{type:'final',text}});
const quickRow = (value, id) => checkOutput(quick, JSON.stringify({...saved,...value})).find(r=>r.id===id).met;
assert.equal(quickRow({tools:[run(['git','-C','project','status'])]}, 'forbidden-git init'), true);
assert.equal(quickRow({tools:[run(['git','init','-q'])]}, 'forbidden-git init'), false);
assert.equal(quickRow({tools:[run(['sudo','apt','install','socat'])]}, 'forbidden-sudo'), false);
assert.equal(quickRow({tools:[run(['echo','pseudo'])]}, 'forbidden-sudo'), true);
assert.equal(quickRow({turns:[final('✔ CLI — 0.14.0\\nNext: https://bakers.build/get-started/#advanced-setup')]}, 'final-https://bakers.build/get-started/#advanced-setup'), true);
assert.equal(quickRow({turns:[final('✔ CLI — 0.14.0')]}, 'final-https://bakers.build/get-started/#advanced-setup'), false);
assert.equal(quickRow({turns:[ask('Path or demo?'), ask('Not a Git repository. Path or demo?')]}, 'min-questions'), true);
assert.equal(quickRow({turns:[ask('Path or demo?')]}, 'min-questions'), false);
const tool = (name, data) => run(['bakers','tools',name,'--data',JSON.stringify(data)]);
const ordered = [tool('bakers_ticket_create',{title:'t'}), tool('bakers_ticket_update',{labels_add:['human-review']}), tool('bakers_ticket_update',{conductor:'c'})];
assert.equal(quickRow({tools:ordered}, 'tool-sequence'), true);
assert.equal(quickRow({tools:[ordered[0], ordered[2], ordered[1]]}, 'tool-sequence'), false);
assert.equal(quickRow({tools:[ordered[0], tool('bakers_ticket_update',{labels_add:['human-review'],conductor:'c'})]}, 'tool-sequence'), false);
// Signed out: the sign-in command runs as given, and its URL and code are shown before the person answers.
const signedOut = {input:{...quick.input, required_commands:['bakers init --yes --base-url https://app.bakers.build --client-id bakers-cli'],
  shown_before_answer:['https://app.bakers.build/device','WXYZ-1234']}};
const outRow = (value, id) => checkOutput(signedOut, JSON.stringify({...saved,...value})).find(r=>r.id===id).met;
const say = text => ({role:'assistant',content:{type:'message',text}});
const answer = {role:'user',content:'demo'};
assert.equal(outRow({tools:[run(['bakers','init','--yes','--base-url','https://app.bakers.build','--client-id','bakers-cli'])]}, 'required-bakers init --yes --base-url https://app.bakers.build --client-id bakers-cli'), true);
assert.equal(outRow({tools:[run(['bakers','init','--yes'])]}, 'required-bakers init --yes --base-url https://app.bakers.build --client-id bakers-cli'), false);
assert.equal(outRow({turns:[say('Open https://app.bakers.build/device, code WXYZ-1234'), ask('Path or demo?'), answer]}, 'shown-WXYZ-1234'), true);
assert.equal(outRow({turns:[ask('Code WXYZ-1234. Path or demo?'), answer]}, 'shown-WXYZ-1234'), true);
assert.equal(outRow({turns:[ask('Path or demo?'), answer, say('Code WXYZ-1234')]}, 'shown-WXYZ-1234'), false);
assert.equal(outRow({turns:[final('Code WXYZ-1234')]}, 'shown-WXYZ-1234'), false);
'''
        result = subprocess.run(['node', '--input-type=module', '-e', script],
                                cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
