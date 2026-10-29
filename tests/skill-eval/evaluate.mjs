import { readFile } from 'node:fs/promises';
import { loadProfile } from './fixtures.mjs';
import { assertionProvenance, readAttempt } from './artifacts.mjs';

export async function loadEvaluator() {
  Object.assign(process.env, {
    PROMPTFOO_DISABLE_TELEMETRY: '1', PROMPTFOO_DISABLE_UPDATE: '1',
    PROMPTFOO_DISABLE_SHARING: '1', PROMPTFOO_DISABLE_REMOTE_GENERATION: '1',
    PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION: '1',
  });
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 22)) throw new Error('Use Node >=22.22.0 for Promptfoo');
  const { evaluate } = await import('promptfoo');
  const pkg = JSON.parse(await readFile(new URL('node_modules/promptfoo/package.json', import.meta.url), 'utf8'));
  // 0.121.20 sends an opt-out event even with telemetry disabled. Suppress that
  // one event on its shared instance; fail closed if a dependency update changes it.
  const telemetry = process[Symbol.for('promptfoo.telemetry.instance')];
  if (pkg.version !== '0.121.20' || typeof telemetry?.telemetryDisabledRecorded !== 'boolean') {
    throw new Error('Unsupported Promptfoo telemetry adapter; verify offline behavior before updating');
  }
  telemetry.telemetryDisabledRecorded = true;
  return { evaluate, version: pkg.version };
}

const CATEGORIES = ['call-recovery', 'uncertain-write', 'expected-error'];
const RECOVERIES = ['call-recovery'];

// Optional profile diagnostics describe call quality beside the authoritative named checks.
function diagnosticsOf(profile, fixture, output, context) {
  const diagnostics = profile.diagnose ? profile.diagnose(fixture, output, context) : [];
  const length = context.tool_trace?.length ?? 0;
  if (!Array.isArray(diagnostics) || new Set(diagnostics.map(d => d?.id)).size !== diagnostics.length ||
      diagnostics.some(d => typeof d.id !== 'string' || !d.id.trim() || !CATEGORIES.includes(d.category) ||
        !['warning', 'info', 'failure'].includes(d.severity) || typeof d.reason !== 'string' || !d.reason.trim() ||
        !Array.isArray(d.calls) || !d.calls.length || d.calls.some(i => !Number.isInteger(i) || i < 0 || i >= length))) {
    throw new Error('Profile diagnostics must be unique, categorized, with severity, reason and original call indices');
  }
  return diagnostics;
}

// Provider-reported zero is an observation; an absent value is unavailable, never zero.
const metric = (value, unit) => value === undefined || value === null
  ? { value: null, unit, unavailable: 'Not recorded by this attempt' }
  : { value, unit, source: 'original generation worker' };

function effort(attempt, diagnostics, elapsed) {
  const trace = attempt.tool_trace;
  const worker = attempt.generation.worker;
  const recoveries = diagnostics.filter(d => RECOVERIES.includes(d.category));
  return {
    tool_calls: trace ? {
      total: trace.length, bakers: trace.filter(r => r.tool === 'bakers').length,
      read_file: trace.filter(r => r.tool === 'read_file').length,
      failed: trace.filter(r => r.result?.exit_code !== 0).length,
    } : null,
    recovery: { attempted: recoveries.length, verified: recoveries.filter(d => d.severity !== 'failure').length },
    generation: {
      model_turns: metric(worker.model_turns, 'turns'), elapsed_ms: metric(worker.elapsed_ms, 'ms'),
      cost_usd: metric(worker.cost_usd, 'USD'), usage: metric(worker.usage, 'provider tokens'),
    },
    evaluation: { model_calls: 0, elapsed_ms: elapsed },
  };
}

export async function replay(input) {
  const started = performance.now();
  const saved = await readAttempt(input);
  const { evaluate, version } = await loadEvaluator();
  const fixture = saved.attempt.generation.fixture;
  const profile = await loadProfile(fixture);
  const { checkOutput } = profile;
  const context = { tool_trace: saved.attempt.tool_trace };
  const initial = checkOutput(fixture, saved.attempt.output, context);
  if (!Array.isArray(initial) || !initial.length || new Set(initial.map(c => c.id)).size !== initial.length ||
      initial.some(c => typeof c.id !== 'string' || !c.id.trim() || typeof c.met !== 'boolean' || typeof c.reason !== 'string')) {
    throw new Error('Profile must return nonempty, unique named boolean assertions with reasons');
  }
  const diagnostics = diagnosticsOf(profile, fixture, saved.attempt.output, context);
  const names = initial.map(c => c.id);
  const evaluation = await evaluate({
    description: `${fixture.skill}: ${fixture.id}`,
    prompts: ['Saved skill output'],
    providers: [async () => ({ output: saved.attempt.output, cached: true })],
    tests: [{ assert: names.map(id => ({
      type: 'javascript', metric: id,
      value: output => {
        const c = checkOutput(fixture, output, context).find(check => check.id === id);
        return { pass: c.met, score: Number(c.met), reason: c.reason };
      },
    })) }],
    writeLatestResults: false, sharing: false,
  }, { cache: false, maxConcurrency: 1, showProgressBar: false });
  const summary = await evaluation.toEvaluateSummary();
  const grades = summary.results?.[0]?.gradingResult?.componentResults;
  if (summary.results?.length !== 1 || summary.stats?.errors || grades?.length !== names.length ||
      grades.some((g, index) => g.assertion?.metric !== names[index] || typeof g.pass !== 'boolean')) {
    throw new Error('Promptfoo did not execute every named assertion exactly once');
  }
  const checks = grades.map(g => ({ id: g.assertion.metric, met: g.pass, reason: g.reason }));
  const passed = checks.every(c => c.met);
  if (passed && diagnostics.some(d => d.severity === 'failure')) {
    throw new Error('A failed recovery diagnostic requires a failing named check');
  }
  const severities = new Set(diagnostics.map(d => d.severity));
  return {
    status: passed ? 'passed' : 'failed',
    scope: 'deterministic assertions only; semantic inspection remains separate',
    fixture: fixture.id, skill: fixture.skill,
    attempt_sha256: saved.hash, generation_revision: saved.attempt.generation.revision,
    assertion_sources: await assertionProvenance(),
    node_version: process.version, promptfoo_version: version,
    model_calls: 0, checks,
    call_quality: { status: severities.has('failure') ? 'failed' : severities.has('warning') ? 'warning' : 'clean', diagnostics },
    effort: effort(saved.attempt, diagnostics, Math.round(performance.now() - started)),
    promptfoo: summary,
  };
}
