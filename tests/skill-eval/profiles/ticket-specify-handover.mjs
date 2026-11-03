import { arg, callRecovery, calls, check, commonChecks, names, tool, uuid, validateTools, WRITES } from '../call-utils.mjs';
import { nonempty, requireValue } from '../validation.mjs';
const SEVEN = ['bakers_ticket_create', 'bakers_ticket_read', 'bakers_ticket_search', 'bakers_comment_publish',
  'bakers_ticket_transition', 'bakers_ticket_update', 'bakers_ticket_classify'].map(tool);
export function validate(f) {
  validateTools(f, 'bb-ticket-specify');
  const e = f.expect;
  requireValue(nonempty(f.simulation.ticket?.identifier) && Array.isArray(f.input.conversation), 'Expected a simulated ticket and a conversation');
  requireValue(typeof e?.hand_over === 'boolean', 'Expected expect.hand_over');
  requireValue(!e.hand_over || (nonempty(e.requester) && uuid(e.conductor)), 'A hand-over names the requester and the conductor');
}
function analyze(f, context) {
  const trace = calls(context, f.simulation.files), ticket = f.simulation.ticket, e = f.expect;
  const { recovered, diagnostics } = callRecovery(trace);
  // ticket_update is a write here; the shared WRITES list predates the hand-over.
  const sent = trace.filter(c => c.mode === 'call' && c.result?.exit_code !== 4 &&
    (WRITES.includes(c.name) || c.name === tool('bakers_ticket_update')));
  const [qualification, spec, classify, transition, update] = sent;
  const is = (c, id) => c?.name === tool(id) && names(c, ticket);
  const handoff = String(arg(qualification, 'body') ?? '');
  const labels = arg(update, 'labels_add');
  return { diagnostics, checks: [
    // Without the requester's approval no call is needed at all.
    ...commonChecks(trace, () => false, recovered).filter(c => e.hand_over || c.id !== 'actual-tool-calls'),
    check('seven-tools', trace.filter(c => c.mode === 'call').every(c => SEVEN.includes(c.name)), 'Call only the seven bakers tools the skill names'),
    ...(e.hand_over ? [
      check('handover-order', sent.length === 5 && is(qualification, 'bakers_comment_publish') && arg(qualification, 'type') === 'qualification' &&
        is(spec, 'bakers_comment_publish') && arg(spec, 'type') === 'spec' && is(classify, 'bakers_ticket_classify') &&
        is(transition, 'bakers_ticket_transition') && is(update, 'bakers_ticket_update'),
      'Publish qualification, then spec, then classify, transition and update, nothing else'),
      check('handover-arguments', arg(classify, 'recipe') === 'superpowers' && ['feature', 'bug', 'chore'].includes(arg(classify, 'type')) &&
        arg(transition, 'state') === 'working' && Array.isArray(labels) && labels.includes('ticket:pingpong') &&
        arg(update, 'conductor') === e.conductor,
      'Recipe superpowers and a type, state working, then ticket:pingpong with the host conductor'),
      check('handoff-fields', /\bAC1\b/.test(handoff) && /out of scope/i.test(handoff) && /handoff_version/.test(handoff) &&
        /provenance/.test(handoff) && !/\b[a-f0-9]{64}\b/.test(handoff),
      'The qualification carries AC IDs, out of scope, handoff_version and provenance, without a hash'),
      check('spec-content', /\bAC1\b/.test(String(arg(spec, 'body') ?? '')) && String(arg(spec, 'body') ?? '').includes(`Approved by ${e.requester}`),
        'The spec carries the AC IDs and closes with the requester\'s approval'),
    ] : [
      check('nothing-handed-over', sent.length === 0, 'Another person\'s approval changes nothing on the ticket'),
    ]),
  ] };
}
export const checkOutput = (f, _output, context) => analyze(f, context).checks;
export const diagnose = (f, _output, context) => analyze(f, context).diagnostics;
