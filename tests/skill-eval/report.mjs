#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);

const short = value => (value ? String(value).slice(0, 12) : '');
const fingerprint = sources => sources && createHash('sha256').update(JSON.stringify(sources)).digest('hex');
const measured = m => m?.value === null || m?.value === undefined ? `unavailable: ${m?.unavailable ?? 'not reported'}`
  : `${typeof m.value === 'object' ? JSON.stringify(m.value) : m.value} ${m.unit}`;

// Every result for one saved attempt side by side: an earlier verdict is never replaced.
function verdicts(records) {
  const rows = records.filter(({ data }) => data.attempt_sha256 && data.checks);
  if (!rows.length) return '';
  return `<h2>Verdicts by attempt</h2><table><thead><tr><th>Attempt</th><th>Result file</th><th>Verdict</th><th>Call quality</th><th>Assertion fingerprint</th></tr></thead><tbody>
    ${rows.map(({ name, data }) => `<tr><td>${escape(short(data.attempt_sha256))}</td><td>${escape(name)}</td><td>${escape(data.status)}${data.judge ? ' (semantic judge)' : ''}</td><td>${escape(data.call_quality?.status ?? 'not assessed')}</td><td>${escape(short(fingerprint(data.assertion_sources)))}</td></tr>`).join('')}
    </tbody></table>`;
}

function quality(data) {
  const q = data.call_quality;
  if (!q) return '';
  return `<h3>Call quality: ${escape(q.status)}</h3>${q.diagnostics.length ? `<table><thead><tr><th>Category</th><th>Severity</th><th>Calls</th><th>Reason</th></tr></thead><tbody>
    ${q.diagnostics.map(d => `<tr><td>${escape(d.category)}</td><td>${escape(d.severity.toUpperCase())}</td><td>${escape(d.calls.map(i => i + 1).join(', '))}</td><td>${escape(d.reason)}</td></tr>`).join('')}
    </tbody></table>` : '<p>No call-quality observations.</p>'}`;
}

function effort(data) {
  const e = data.effort;
  if (!e) return '';
  const t = e.tool_calls, g = e.generation;
  return `<h3>Observed effort</h3><table><tbody>
    <tr><th>Tool calls</th><td>${t ? escape(`${t.total} total · ${t.bakers} bakers · ${t.read_file} read_file · ${t.failed} failed`) : 'no tool trace'}</td></tr>
    <tr><th>Recovery episodes</th><td>${escape(`${e.recovery.attempted} attempted · ${e.recovery.verified} verified`)}</td></tr>
    <tr><th>Generation model turns</th><td>${escape(measured(g.model_turns))}</td></tr>
    <tr><th>Generation elapsed</th><td>${escape(measured(g.elapsed_ms))}</td></tr>
    <tr><th>Generation cost</th><td>${escape(measured(g.cost_usd))}</td></tr>
    <tr><th>Generation usage</th><td>${escape(measured(g.usage))}</td></tr>
    <tr><th>This evaluation</th><td>${escape(`${e.evaluation.model_calls} model calls · ${e.evaluation.elapsed_ms} ms`)}</td></tr>
    </tbody></table><p>One attempt is an observation, not a benchmark; compare only runs with the same fixture, skill and simulator fingerprints.</p>`;
}

export function renderReport(records) {
  const body = records.map(({ name, data }) => {
    if (data.version === 1 && data.generation && typeof data.output === 'string') {
      const trace = data.tool_trace;
      const tools = trace ? `<h3>Observed tool calls (${trace.length})</h3><p>Local simulation: literal arguments and recorded results; no live tracker or shell.</p>${trace.map((row, index) => `<details><summary>${index + 1}. ${escape(row.tool)} ${escape(row.arguments?.argv?.slice(2, 4).join(' ') ?? row.arguments?.path)}</summary><h4>Arguments</h4><pre>${escape(JSON.stringify(row.arguments, null, 2))}</pre><h4>Result</h4><pre>${escape(JSON.stringify(row.result, null, 2))}</pre></details>`).join('')}` : '';
      return `<section><h2>${escape(name)}</h2><p>Saved output · ${escape(data.generation.fixture.id)}</p>${tools}<h3>Final response</h3><pre>${escape(data.output)}</pre></section>`;
    }
    if (!['passed', 'failed', 'error', 'prepared'].includes(data.status)) throw new Error(`Not an evaluation result: ${name}`);
    return `<section><h2>${escape(name)} — ${escape(data.status)}</h2>
      <p>${escape(data.scope)} ${escape(data.fixture)}</p>
      <p>Model calls: ${escape(data.model_calls)} · Generation: ${escape(data.generation_revision ?? data.revision)}</p>
      <p>Attempt SHA-256: ${escape(data.attempt_sha256)}</p>
      ${data.error ? `<p>${escape(data.error)}</p>` : ''}
      <h3>Correctness: ${escape(data.status)}</h3>
      <table><thead><tr><th>Check</th><th>Result</th><th>Evidence</th></tr></thead><tbody>
      ${(data.checks ?? []).map(c => `<tr><td>${escape(c.id)}</td><td>${c.met ? 'PASS' : 'FAIL'}</td><td>${escape(c.reason)}${c.quote ? `<blockquote>${escape(c.quote)}</blockquote>` : ''}</td></tr>`).join('')}
      </tbody></table>${quality(data)}${effort(data)}</section>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Skill evaluation results</title><style>
    body{font:16px/1.5 system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#17212b;background:#f7f9fb}
    section{background:white;border:1px solid #d8dfe6;padding:1rem;margin:1.5rem 0;border-radius:8px}
    h2{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #d8dfe6;padding:.6rem;vertical-align:top}
    pre{white-space:pre-wrap;overflow-wrap:anywhere}p{overflow-wrap:anywhere}blockquote{margin:.5rem 0;padding-left:1rem;border-left:3px solid #aab8c5}
    </style><h1>Skill evaluation results</h1><p>Deterministic checks and semantic judgments are separate. Correctness decides the result; call-quality warnings record recovered mistakes beside it. Judge quotes require inspection. Saved outputs are displayed verbatim. Tool cases use a local simulator: no installed bakers.build parser, shell or live tracker.</p>${verdicts(records)}${body}</html>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { input: { type: 'string', multiple: true }, output: { type: 'string' } } });
    if (!values.input?.length || !values.output) throw new Error('Usage: node tests/skill-eval/report.mjs --input <result-or-attempt.json> [--input ...] --output <new-report.html>');
    const records = await Promise.all(values.input.map(async name => ({ name, data: JSON.parse(await readFile(name, 'utf8')) })));
    const html = renderReport(records);
    await mkdir(dirname(resolve(values.output)), { recursive: true });
    await writeFile(values.output, html, { flag: 'wx' });
    console.log(resolve(values.output));
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
