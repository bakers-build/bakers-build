#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readAttempt, sha256 } from './artifacts.mjs';
import { loadEvaluator, replay } from './evaluate.mjs';
import { fixtureIds, loadFixture } from './fixtures.mjs';

const command = process.argv;
const encode = value => `${JSON.stringify(value, null, 2)}\n`;
const readJSON = async path => JSON.parse(await readFile(path, 'utf8'));
const warnings = result => result.call_quality?.diagnostics.filter(d => d.severity === 'warning').length;
const summary = result => `${result.status}: ${result.checks.length} deterministic assertions${warnings(result) ? `, ${warnings(result)} call-quality warning${warnings(result) > 1 ? 's' : ''}` : ''}`;
const save = (path, value) => writeFile(path, encode({ command, ...value }), { flag: 'wx' });
const help = `Usage (repository root, Node >=22.22.0):
  node tests/skill-eval/run.mjs generate --fixture <id-or-path> --output <new-directory> [--model sonnet] [--timeout 180]
  node tests/skill-eval/run.mjs replay --input <attempt.json> --output <new-result.json>
  node tests/skill-eval/run.mjs judge --input <attempt.json> --output <new-directory> [--model sonnet] [--timeout 180]
list prints available fixture IDs; prepare snapshots inputs without model calls.
generate calls one isolated Claude worker, then runs offline Promptfoo assertions.
replay runs only deterministic assertions. judge explicitly calls a separate semantic model.
Exit 0: selected checks passed; 1: assertion/rubric failure; 2: execution/input error.
Outputs must be unused paths. Keep attempts under assets-ai/<ticket>/promptfoo/.`;

async function bridge(operation, input, output, model, timeout) {
  // Importing replay never loads the generation process boundary.
  const { spawnSync } = await import('node:child_process');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('BB_')));
  const result = spawnSync('python3', ['-B', fileURLToPath(new URL('skill-worker.py', import.meta.url)),
    operation, '--input', input, '--output', output, '--model', model, '--timeout', String(timeout)],
  { encoding: 'utf8', env, timeout: (timeout + 30) * 1000, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  const record = await readJSON(resolve(output, operation !== 'judge' ? 'generation.json' : 'semantic.json'));
  if (result.status !== 0 && record.status !== 'failed') throw new Error(record.error ?? result.stderr ?? 'Worker failed');
  return record;
}

let resultPath;
try {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    fixture: { type: 'string' }, input: { type: 'string' }, output: { type: 'string' },
    model: { type: 'string' }, timeout: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log(help);
  } else {
    const operation = positionals[0];
    if (operation === 'list' && positionals.length === 1 && !Object.keys(values).length) {
      console.log((await fixtureIds()).join('\n'));
      process.exit(0);
    }
    if (positionals.length !== 1 || !['generate', 'prepare', 'replay', 'judge'].includes(operation) || !values.output) throw new Error(help);
    const output = resolve(values.output);
    const timeout = Number(values.timeout ?? 180);
    if (!Number.isInteger(timeout) || timeout < 1) throw new Error('timeout must be a positive integer');
    if (operation === 'replay') {
      if (!values.input || values.fixture || values.model || values.timeout) throw new Error('replay needs only --input and --output');
      if (resolve(values.input) === output) throw new Error('Replay cannot overwrite its input');
      await mkdir(dirname(output), { recursive: true });
      resultPath = output;
      const result = await replay(resolve(values.input));
      await save(resultPath, result);
      console.log(`${summary(result)}; ${resultPath}`);
      process.exitCode = result.status === 'passed' ? 0 : 1;
    } else {
      if (operation !== 'judge' ? (!values.fixture || values.input) : (!values.input || values.fixture)) throw new Error(help);
      const fixture = operation !== 'judge' ? await loadFixture(values.fixture) : undefined;
      if (!fixture) await readAttempt(values.input);
      await mkdir(dirname(output), { recursive: true });
      await mkdir(output); // Refuse reused attempts before any paid call.
      resultPath = resolve(output, 'result.json');
      if (operation === 'generate') await loadEvaluator();
      const input = fixture ? resolve(output, 'fixture.json') : resolve(values.input);
      if (fixture) await writeFile(input, encode(fixture), { flag: 'wx' });
      const record = await bridge(operation, input, output, values.model ?? 'sonnet', timeout);
      if (operation === 'prepare') {
        await save(resultPath, { status: 'prepared', model_calls: 0, fixture: fixture.id });
        console.log(`prepared: ${output}`);
      } else if (operation === 'generate') {
        const path = resolve(output, 'attempt.json');
        await save(path, { version: 1, generation: record, output: record.output, output_sha256: sha256(record.output),
          ...(record.tool_trace ? { tool_trace: record.tool_trace, tool_trace_sha256: sha256(JSON.stringify(record.tool_trace)) } : {}) });
        const result = { ...await replay(path), model_calls: record.worker.model_turns, worker_invocations: 1, assertion_model_calls: 0 };
        await save(resultPath, result);
        console.log(`${summary(result)}; ${path}`);
        process.exitCode = result.status === 'passed' ? 0 : 1;
      } else {
        await save(resultPath, { ...record, model_calls: record.judge.model_turns, worker_invocations: 1, scope: 'semantic judge; inspect quotes against the artifact' });
        console.log(`${record.status}: semantic judge; ${resultPath}`);
        process.exitCode = record.status === 'passed' ? 0 : 1;
      }
    }
  }
} catch (error) {
  const record = { status: 'error', error: error.message };
  if (resultPath) {
    try { await save(resultPath, record); }
    catch (writeError) { console.error(`Cannot save error record: ${writeError.message}`); }
  }
  console.error(`Execution error: ${error.message}`);
  process.exitCode = 2;
}
