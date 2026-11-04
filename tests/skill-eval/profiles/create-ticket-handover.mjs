import { arg, callRecovery, calls, check, commonChecks, names, payload, succeeded, tool, toolCalls, uuid, validateTools, writes } from '../call-utils.mjs';
import { nonempty, requireValue } from '../validation.mjs';
import { priorArtSearched } from './create-ticket-calls.mjs';
const EIGHT = ['bakers_user_read', 'bakers_ticket_create', 'bakers_ticket_read', 'bakers_ticket_search', 'bakers_comment_publish',
  'bakers_ticket_transition', 'bakers_ticket_update', 'bakers_ticket_classify'].map(tool);
export function validate(f) {
  validateTools(f, 'bb-create-ticket');
  const e = f.expect;
  requireValue(Array.isArray(f.input.conversation) && (e?.start === true || nonempty(f.simulation.ticket?.identifier)),
    'Expected a conversation and, after its start, a simulated ticket');
  requireValue(e?.start === true || e?.bug === true || typeof e?.hand_over === 'boolean', 'Expected expect.start, expect.bug or expect.hand_over');
  requireValue(!e.hand_over || (nonempty(e.requester) && nonempty(e.recipe) && e.conductor === f.input.host?.conductor &&
    (e.conductor === undefined || uuid(e.conductor))), 'A hand-over names the requester, the picked recipe and the host conductor, if any');
  requireValue(!e.bug || nonempty(e.recipe), 'A bug names the picked recipe');
}
function analyze(f, context) {
  const trace = calls(context, f.simulation.files), e = f.expect;
  const { recovered, diagnostics } = callRecovery(trace);
  const sent = writes(trace).filter(c => c.result?.exit_code !== 4);
  const created = payload(toolCalls(trace, 'bakers_ticket_create')[0]);
  const ticket = f.simulation.ticket ?? { id: created?.id, identifier: created?.identifier };
  const is = (c, id) => c?.name === tool(id) && names(c, ticket);
  const published = (c, type) => is(c, 'bakers_comment_publish') && arg(c, 'type') === type;
  const body = c => String(arg(c, 'body') ?? '');
  const acts = e.start || e.bug || e.hand_over;
  const common = [
    // Without the requester's approval no call is needed at all.
    ...commonChecks(trace, () => false, recovered).filter(c => acts || c.id !== 'actual-tool-calls'),
    check('eight-tools', trace.filter(c => c.mode === 'call').every(c => EIGHT.includes(c.name)), 'Call only the eight bakers tools the skill\'s operations map to'),
  ];
  if (e.start) {
    const searches = toolCalls(trace, 'bakers_ticket_search'), creates = toolCalls(trace, 'bakers_ticket_create');
    const linked = c => is(c, 'bakers_ticket_transition') && !arg(c, 'state') &&
      (arg(c, 'links') ?? []).some(l => l?.uri === f.input.host.conversation_link);
    return { diagnostics, checks: [...common,
      check('user-first', toolCalls(trace, 'bakers_user_read').some(c => succeeded(c) && c.index < (sent[0]?.index ?? Infinity)),
        'Read your user before any write'),
      check('prior-art-search', priorArtSearched(searches) && searches.every(c => c.index < (creates[0]?.index ?? -1)),
        'Search at least two spellings, proving an empty search with the probe, before creating'),
      check('start-create', creates.length === 1 && arg(creates[0], 'project') === f.input.host.project &&
        arg(creates[0], 'workflow') === f.input.host.workflow && sent.some(linked),
      'Create one ticket in the host\'s project and workflow and add the conversation link'),
      check('nothing-yet', sent.every(c => c === creates[0] || linked(c) || is(c, 'bakers_ticket_classify')),
        'Before the requester\'s approval, no comment, state, label or conductor'),
    ] };
  }
  if (e.bug) {
    const comments = sent.filter(c => is(c, 'bakers_comment_publish'));
    const classify = sent.find(c => is(c, 'bakers_ticket_classify')), last = sent.at(-1);
    return { diagnostics, checks: [...common,
      check('bug-order', sent.length === 4 && comments.map(c => arg(c, 'type')).join() === 'qualification,summary' &&
        sent[0] === comments[0] && classify && is(last, 'bakers_ticket_transition') && arg(last, 'state') === 'plan',
      'Publish qualification and summary, set type and recipe, then move to plan; nothing else, so no pingpong'),
      check('bug-arguments', arg(classify, 'type') === 'bug' && arg(classify, 'recipe') === e.recipe && /reproduction/i.test(body(comments[0])),
        'Type bug with the picked recipe, and the reproduction in the qualification'),
    ] };
  }
  const [qualification, spec, plan, test, summary, classify, transition, update] = sent;
  const labels = arg(update, 'labels_add');
  return { diagnostics, checks: [...common, ...(e.hand_over ? [
    check('handover-order', sent.length === 8 && published(qualification, 'qualification') && published(spec, 'spec') &&
      published(plan, 'plan') && published(test, 'test') && published(summary, 'summary') && is(classify, 'bakers_ticket_classify') &&
      is(transition, 'bakers_ticket_transition') && is(update, 'bakers_ticket_update'),
    'Publish qualification, spec, plan, test and summary, then classify, transition and update, nothing else'),
    check('handover-arguments', arg(classify, 'recipe') === e.recipe && ['feature', 'chore'].includes(arg(classify, 'type')) &&
      arg(transition, 'state') === 'working' && Array.isArray(labels) && labels.includes('pingpong') &&
      arg(update, 'conductor') === e.conductor,
    'The picked recipe and feature or chore, state working, then pingpong with the host conductor, if any'),
    check('handoff-fields', /\bAC1\b/.test(body(qualification)) && /out of scope/i.test(body(qualification)) &&
      /handoff_version/.test(body(qualification)) && !/\b[a-f0-9]{64}\b/.test(body(qualification)),
    'The qualification carries AC IDs, out of scope and handoff_version, without a hash'),
    check('spec-content', /\bAC1\b/.test(body(spec)) && body(spec).includes(`Approved by ${e.requester}`),
      'The spec carries the AC IDs and closes with the requester\'s approval'),
    check('plan-content', body(plan).trim() !== '' && /\bAC1\b/.test(body(test)),
      'The plan is written and the test plan names the AC IDs'),
  ] : [
    check('nothing-handed-over', sent.length === 0, 'Another person\'s approval changes nothing on the ticket'),
  ])] };
}
export const checkOutput = (f, _output, context) => analyze(f, context).checks;
export const diagnose = (f, _output, context) => analyze(f, context).diagnostics;
