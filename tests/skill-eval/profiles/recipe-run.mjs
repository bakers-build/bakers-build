import { arg, calls, check, names, readAfter, succeeded, tool, toolCalls, uuid, validateTools, writes } from '../call-utils.mjs';
import { priorArtSearched } from './create-ticket-calls.mjs';
import { requireValue } from '../validation.mjs';

// A state of a deployment or verification ticket through bb-workflow and its recipe: the comments on
// this ticket, the merges in their order, what must never run, and where the state stops.
const ADMIN = /\buid[ :=]*1\b|user\/reset\/1\//i;

export function validate(f) {
  validateTools(f, 'bb-workflow');
  const e = f.expect;
  requireValue(uuid(f.input.ticket_uuid) && f.simulation.ticket?.id === f.input.ticket_uuid, 'Expected the simulated ticket');
  requireValue(Array.isArray(e?.comments) && e.comments.at(-1) === 'summary' && (e.transition === null || typeof e.transition === 'string'),
    'Expected required comments ending in summary, and a transition or null');
  requireValue(!e.merges || (Array.isArray(e.merges) && e.merges.every(m => Array.isArray(m) && m[0] === 'glab' &&
    f.simulation.commands?.glab?.some(r => JSON.stringify(r.argv) === JSON.stringify(m)))), 'Expected merges among the declared glab commands');
  requireValue(!e.missing_persona || typeof e.missing_persona === 'string', 'Expected the missing persona name');
  requireValue(!e.includes || Object.values(e.includes).every(v => Array.isArray(v) && v.length), 'Expected includes as type → strings');
}

export function checkOutput(f, output, context) {
  const e = f.expect, trace = calls(context, f.simulation.files), all = writes(trace), ticket = f.simulation.ticket;
  const own = all.filter(c => c.name === tool('bakers_comment_publish') && succeeded(c) && names(c, ticket));
  const types = own.map(c => arg(c, 'type'));
  const states = all.filter(c => c.name === tool('bakers_ticket_transition') && names(c, ticket) && arg(c, 'state'));
  const external = trace.filter(c => ['git', 'glab'].includes(c.tool));
  const argv = c => (c.arguments?.argv ?? []).join(' ');
  const merges = external.filter(c => c.tool === 'glab' && /^glab (mr merge|api .*merge_requests\/\d+\/merge)\b/.test(argv(c)));
  let at = -1;
  const checks = [
    check('ticket-read', toolCalls(trace, 'bakers_ticket_read').some(c => names(c, ticket) && succeeded(c)), 'Read the ticket first'),
    check('tool-calls-only', !trace.some(c => c.mode === 'jsonapi'), 'Call bakers tools; no JSON:API command'),
    check('comment-sequence', e.comments.every(t => (at = types.indexOf(t, at + 1)) >= 0) && types.at(-1) === 'summary',
      `Publish ${e.comments.join(', ')} on this ticket in that order, the summary last`),
    e.transition
      ? check('transition', states.length === 1 && arg(states[0], 'state') === e.transition && Boolean(readAfter(trace, states[0], ticket)),
        `Transition once to ${e.transition} and read it back`)
      : check('no-transition', states.length === 0, 'Stop without a state write'),
  ];
  for (const [type, needles] of Object.entries(e.includes ?? {})) {
    const bodies = own.filter(c => arg(c, 'type') === type).map(c => arg(c, 'body') ?? '').join('\n');
    checks.push(check(`${type}-content`, needles.every(n => bodies.includes(n)), `The ${type} comment names ${needles.join(', ')}`));
  }
  if (e.merges) {
    checks.push(check('merges', JSON.stringify(merges.map(c => c.arguments.argv)) === JSON.stringify(e.merges) && merges.every(succeeded),
      e.merges.length ? 'Merge by merge commit, in exactly this order' : 'Merge nothing'));
  }
  if (e.no_branch) {
    checks.push(check('no-branch', !external.some(c => /\b(push|checkout|switch|branch|mr create)\b/.test(argv(c))),
      'Cut, push or open nothing before the approval'));
  }
  if (e.no_merge_reference) {
    checks.push(check('frame-merge-unused', !trace.some(c => c.tool === 'read_file' && String(c.arguments?.path).endsWith('references/merge.md')) &&
      !merges.some(c => /--squash|squash=true/.test(argv(c))), 'The recipe merges itself; the frame\'s squash merge never runs'));
  }
  if (e.results !== undefined) {
    const results = own.filter(c => arg(c, 'type') === 'result');
    checks.push(check('per-ticket-results', results.length === e.results.length &&
      e.results.every(id => results.some(c => arg(c, 'body')?.includes(id))), `One result comment per tested ticket: ${e.results.join(', ')}`));
  }
  if (e.bugs !== undefined) {
    const creates = all.filter(c => c.name === tool('bakers_ticket_create') && succeeded(c));
    const searched = c => priorArtSearched(toolCalls(trace, 'bakers_ticket_search').filter(s => s.index < c.index));
    checks.push(check('regressions', creates.length === e.bugs && creates.every(c => arg(c, 'type') === 'bug' && searched(c)),
      `Create ${e.bugs} bug ticket(s), each after a prior-art search`));
  }
  if (e.missing_persona) {
    const texts = [output, ...all.map(c => arg(c, 'body') ?? '')];
    const reported = texts.join('\n').split('\n').some(l => l.includes(e.missing_persona) && /missing|blocked|not run/i.test(l));
    checks.push(check('missing-persona', reported && !texts.some(t => ADMIN.test(t)),
      `Report ${e.missing_persona} as missing; no administrator login replaces it`));
  }
  return checks;
}
