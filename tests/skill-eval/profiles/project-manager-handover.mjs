import { arg, callRecovery, calls, check, commonChecks, names, tool, uuid, validateTools, WRITES } from '../call-utils.mjs';
import { nonempty, requireValue } from '../validation.mjs';
const EIGHT = ['bakers_user_read', 'bakers_ticket_create', 'bakers_ticket_read', 'bakers_ticket_search', 'bakers_comment_publish',
  'bakers_ticket_transition', 'bakers_ticket_update', 'bakers_ticket_classify'].map(tool);
export function validate(f) {
  validateTools(f, 'bb-project-manager');
  const e = f.expect;
  requireValue(nonempty(f.simulation.ticket?.identifier) && Array.isArray(f.input.conversation), 'Expected a simulated ticket and a conversation');
  requireValue(typeof e?.hand_over === 'boolean', 'Expected expect.hand_over');
  requireValue(!e.hand_over || (nonempty(e.requester) && uuid(e.conductor) && nonempty(e.recipe)),
    'A hand-over names the requester, the conductor and the picked recipe');
}
function analyze(f, context) {
  const trace = calls(context, f.simulation.files), ticket = f.simulation.ticket, e = f.expect;
  const { recovered, diagnostics } = callRecovery(trace);
  // ticket_update is a write here; the shared WRITES list predates the hand-over.
  const sent = trace.filter(c => c.mode === 'call' && c.result?.exit_code !== 4 &&
    (WRITES.includes(c.name) || c.name === tool('bakers_ticket_update')));
  const [qualification, spec, plan, test, classify, transition, update] = sent;
  const is = (c, id) => c?.name === tool(id) && names(c, ticket);
  const published = (c, type) => is(c, 'bakers_comment_publish') && arg(c, 'type') === type;
  const body = c => String(arg(c, 'body') ?? '');
  const labels = arg(update, 'labels_add');
  return { diagnostics, checks: [
    // Without the requester's approval no call is needed at all.
    ...commonChecks(trace, () => false, recovered).filter(c => e.hand_over || c.id !== 'actual-tool-calls'),
    check('eight-tools', trace.filter(c => c.mode === 'call').every(c => EIGHT.includes(c.name)), 'Call only the eight bakers tools the skill\'s operations map to'),
    ...(e.hand_over ? [
      check('handover-order', sent.length === 7 && published(qualification, 'qualification') && published(spec, 'spec') &&
        published(plan, 'plan') && published(test, 'test') && is(classify, 'bakers_ticket_classify') &&
        is(transition, 'bakers_ticket_transition') && is(update, 'bakers_ticket_update'),
      'Publish qualification, spec, plan and test, then classify, transition and update, nothing else'),
      check('handover-arguments', arg(classify, 'recipe') === e.recipe && ['feature', 'bug', 'chore'].includes(arg(classify, 'type')) &&
        arg(transition, 'state') === 'working' && Array.isArray(labels) && labels.includes('pingpong') &&
        arg(update, 'conductor') === e.conductor,
      'The picked recipe and a type, state working, then pingpong with the host conductor'),
      check('handoff-fields', /\bAC1\b/.test(body(qualification)) && /out of scope/i.test(body(qualification)) &&
        /handoff_version/.test(body(qualification)) && !/\b[a-f0-9]{64}\b/.test(body(qualification)),
      'The qualification carries AC IDs, out of scope and handoff_version, without a hash'),
      check('spec-content', /\bAC1\b/.test(body(spec)) && body(spec).includes(`Approved by ${e.requester}`),
        'The spec carries the AC IDs and closes with the requester\'s approval'),
      check('plan-content', body(plan).trim() !== '' && /\bAC1\b/.test(body(test)),
        'The plan is written and the test plan names the AC IDs'),
    ] : [
      check('nothing-handed-over', sent.length === 0, 'Another person\'s approval changes nothing on the ticket'),
    ]),
  ] };
}
export const checkOutput = (f, _output, context) => analyze(f, context).checks;
export const diagnose = (f, _output, context) => analyze(f, context).diagnostics;
