// Adapt recorded multi-turn evidence to the existing immutable offline replay format.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sha256 } from './artifacts.mjs';

const directory = resolve(process.argv[2]);
const read = async name => JSON.parse(await readFile(resolve(directory, name), 'utf8'));
const result = await read('result.json');
const original = await read('fixture.json');
const expectations = JSON.parse(await readFile(new URL(`./fixtures/setup/${original.id}.json`, import.meta.url), 'utf8'));
const snapshots = await read('sources.json');
const skill = original.request.includes('bb-init-project') ? 'bb-init-project' : 'bb-init';
const fixture = { synthetic: true, id: original.id, skill, profile: 'setup', references: [],
  input: { expected_files: expectations.expected_files ?? {}, preserved_files: expectations.preserved_files ?? {},
    forbidden_fragments: expectations.forbidden_fragments ?? {},
    expected_config: expectations.expected_config ?? {},
    no_writes: expectations.no_writes ?? false, no_questions: expectations.no_questions ?? false },
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
