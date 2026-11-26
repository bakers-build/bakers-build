// Adapt recorded multi-turn evidence to the existing immutable offline replay format.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sha256 } from './artifacts.mjs';

const directory = resolve(process.argv[2]);
const read = async name => JSON.parse(await readFile(resolve(directory, name), 'utf8'));
const result = await read('result.json');
const original = await read('fixture.json');
const expectation = async name => JSON.parse(await readFile(new URL(`./fixtures/setup/${name}.json`, import.meta.url), 'utf8'));
const expectations = { ...await expectation('defaults'), ...await expectation(original.id) };
const snapshots = await read('sources.json');
const skill = ['bb-get-started', 'bb-init-project'].find(name => original.request.includes(name)) ?? 'bb-init';
const fixture = { synthetic: true, id: original.id, skill, profile: 'setup', references: [],
  input: { expected_files: expectations.expected_files ?? {}, preserved_files: expectations.preserved_files ?? {},
    forbidden_fragments: expectations.forbidden_fragments ?? {},
    expected_config: expectations.expected_config ?? {},
    no_writes: expectations.no_writes ?? false, no_questions: expectations.no_questions ?? false,
    max_questions: expectations.max_questions, derived_sources: expectations.derived_sources ?? [],
    previewed_keys: expectations.previewed_keys ?? [],
    asked_values: expectations.asked_values ?? [], max_doc_loads: expectations.max_doc_loads,
    forbidden_commands: expectations.forbidden_commands, final_fragments: expectations.final_fragments,
    min_questions: expectations.min_questions, tool_sequence: expectations.tool_sequence,
    required_commands: expectations.required_commands, shown_before_answer: expectations.shown_before_answer },
  rubric: expectations.rubric ?? [{ id: 'conversation-quality', criterion: 'Separately inspect question order, provenance, recommendations and honest readiness against saved source snapshots.' }] };
const metadata = result.turns.find(turn => turn.role === 'assistant' && turn.metadata)?.metadata;
if (!metadata?.isolation_confirmed) throw new Error('No verified model generation in this attempt');
const output = JSON.stringify(result);
const prompt = await readFile(resolve(directory, 'target-0/prompt.txt'), 'utf8');
const path = `.claude/skills/bakers-build/skills/${skill}/SKILL.md`;
const fixtureSource = JSON.stringify(fixture);
const generation = { status: 'generated', fixture, fixture_source: fixtureSource, fixture_sha256: sha256(fixtureSource),
  revision: result.revision, dirty: result.dirty, worker: { model: metadata.model, cli_version: metadata.cli_version,
    isolation_confirmed: result.turns.filter(t => t.metadata).every(t => t.metadata.isolation_confirmed),
    transport: 'Multi-turn setup conversation through isolated worker calls; raw per-role streams retained' },
  sources: [{ path, content: snapshots[path], sha256: sha256(snapshots[path]) }],
  prompt, prompt_sha256: sha256(prompt), output, output_sha256: sha256(output) };
await writeFile(resolve(directory, 'attempt.json'), JSON.stringify({ version: 1, generation, output, output_sha256: sha256(output) }, null, 2) + '\n', { flag: 'wx' });
