import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

import { loadProfile } from './fixtures.mjs';
import { requireValue, nonempty } from './validation.mjs';
export const sha256 = text => createHash('sha256').update(text).digest('hex');
export async function validateFixture(fixture) { await loadProfile(fixture); return fixture; }

export async function readAttempt(path) {
  const raw = await readFile(path, 'utf8');
  const attempt = JSON.parse(raw);
  const g = attempt.generation;
  requireValue(attempt.version === 1 && g?.status === 'generated', 'Expected a completed generation attempt, version 1');
  await validateFixture(g.fixture);
  requireValue(sha256(g.fixture_source) === g.fixture_sha256 &&
    JSON.stringify(JSON.parse(g.fixture_source)) === JSON.stringify(g.fixture), 'Recorded fixture hash/content mismatch');
  requireValue(nonempty(g.worker?.model) && g.worker.isolation_confirmed === true && /^[a-f0-9]{40}$/.test(g.revision),
    'Missing original generation model, isolation or commit');
  const expectedSources = [`${g.fixture.skill}/SKILL.md`, ...g.fixture.references];
  requireValue(Array.isArray(g.sources) && g.sources.length === expectedSources.length &&
    g.sources.every((s, index) => s.path === `.claude/skills/bakers-build/skills/${expectedSources[index]}` &&
      sha256(s.content) === s.sha256), 'Recorded skill snapshot path/hash mismatch');
  requireValue(sha256(g.prompt) === g.prompt_sha256, 'Recorded prompt hash mismatch');
  requireValue(nonempty(attempt.output) && sha256(attempt.output) === attempt.output_sha256 &&
    sha256(g.output) === g.output_sha256, 'Empty or corrupted saved output');
  if (g.fixture.execution === 'simulated-tools') {
    requireValue(Array.isArray(g.tool_trace) && sha256(g.tool_trace_source) === g.tool_trace_sha256 &&
      JSON.stringify(JSON.parse(g.tool_trace_source)) === JSON.stringify(g.tool_trace), 'Recorded tool trace hash/content mismatch');
    requireValue(Array.isArray(g.worker.tool_calls) && JSON.stringify(g.worker.tool_calls) ===
      JSON.stringify(g.tool_trace.map(row => ({ tool: row.tool, arguments: row.arguments }))), 'Model/simulator call trace mismatch');
    requireValue(Array.isArray(attempt.tool_trace) && sha256(JSON.stringify(attempt.tool_trace)) === attempt.tool_trace_sha256,
      'Missing or corrupted replay tool trace');
    if (JSON.stringify(attempt.tool_trace) !== JSON.stringify(g.tool_trace)) {
      requireValue(nonempty(attempt.negative_control?.reason) && attempt.negative_control.parent_tool_trace_sha256 === g.tool_trace_sha256,
        'Changed tool trace requires explicit negative_control provenance');
    }
  }
  if (attempt.output !== g.output) {
    requireValue(nonempty(attempt.negative_control?.reason) && attempt.negative_control.parent_output_sha256 === g.output_sha256,
      'Changed output requires explicit negative_control provenance');
  }
  return { attempt, raw, hash: sha256(raw) };
}

// Content hashes identify the current assertions even with uncommitted edits. No git/model
// subprocess is needed during replay; generation retains the immutable repository commit.
export async function assertionProvenance() {
  const files = ['package-lock.json', ...(await readdir(new URL('./', import.meta.url))).filter(p => p.endsWith('.mjs')).sort(),
    ...(await readdir(new URL('./profiles/', import.meta.url))).filter(p => p.endsWith('.mjs')).sort().map(p => `profiles/${p}`)];
  return Object.fromEntries(await Promise.all(files.map(async path =>
    [path, sha256(await readFile(new URL(path, import.meta.url)))])));
}
