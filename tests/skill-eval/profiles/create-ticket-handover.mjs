import { arg, callRecovery, calls, check, commonChecks, names, payload, succeeded, tool, toolCalls, uuid, validateTools, writes } from '../call-utils.mjs';
import { nonempty, requireValue } from '../validation.mjs';
import { priorArtSearched } from './create-ticket-calls.mjs';
const NINE = ['bakers_user_read', 'bakers_ticket_create', 'bakers_ticket_read', 'bakers_ticket_search', 'bakers_comment_publish',
  'bakers_ticket_transition', 'bakers_ticket_update', 'bakers_ticket_classify', 'bakers_conductor_list'].map(tool);
const STEP = /^(comment:[a-z_]+|transition:[a-z_]+|update:conductor|classify)$/;
export function validate(f) {
  validateTools(f, 'bb-create-ticket');
  const e = f.expect;
  requireValue(Array.isArray(f.input.conversation) && (e?.start === true || nonempty(f.simulation.ticket?.identifier)),
    'Expected a conversation and, after its start, a simulated ticket');
  requireValue(e?.start === true || (Array.isArray(e?.writes) && e.writes.every(w => STEP.test(w))), 'Expected expect.start or expect.writes steps');
  requireValue(!e.writes?.includes('update:conductor') || (uuid(e.conductor) && e.conductor === f.input.host?.conductor),
    'Setting a conductor expects the host conductor');
  requireValue(!e.writes?.includes('comment:spec') || nonempty(e.requester), 'A spec names the requester who approved it');
}
// A write as its step: the comment type, the target state, a conductor, or classify.
function step(c) {
  if (c.name === tool('bakers_comment_publish')) return `comment:${arg(c, 'type')}`;
  if (c.name === tool('bakers_ticket_transition')) return arg(c, 'state') ? `transition:${arg(c, 'state')}` : 'link';
  if (c.name === tool('bakers_ticket_update')) return arg(c, 'conductor') ? 'update:conductor' : 'update';
  return c.name === tool('bakers_ticket_classify') ? 'classify' : c.name;
}
function analyze(f, context) {
  const trace = calls(context, f.simulation.files), e = f.expect;
  const { recovered, diagnostics } = callRecovery(trace);
  const sent = writes(trace).filter(c => c.result?.exit_code !== 4);
  const created = payload(toolCalls(trace, 'bakers_ticket_create')[0]);
  const ticket = f.simulation.ticket ?? { id: created?.id, identifier: created?.identifier };
  const body = type => String(arg(sent.find(c => step(c) === `comment:${type}`), 'body') ?? '');
  const common = [
    // Without the requester's approval no call is needed at all.
    ...commonChecks(trace, () => false, recovered).filter(c => e.start || e.writes.length || c.id !== 'actual-tool-calls'),
    check('nine-tools', trace.filter(c => c.mode === 'call').every(c => NINE.includes(c.name)), 'Call only the nine bakers tools the skill\'s operations map to'),
    check('no-pingpong', !sent.some(c => [arg(c, 'labels_add')].flat().includes('pingpong')), 'The host adds pingpong, never the skill'),
  ];
  if (e.start) {
    const searches = toolCalls(trace, 'bakers_ticket_search'), creates = toolCalls(trace, 'bakers_ticket_create');
    return { diagnostics, checks: [...common,
      check('user-first', toolCalls(trace, 'bakers_user_read').some(c => succeeded(c) && c.index < (sent[0]?.index ?? Infinity)),
        'Read your user before any write'),
      check('prior-art-search', priorArtSearched(searches) && creates[0] && searches.some(c => c.index < creates[0].index),
        'Search at least two spellings, proving an empty search with the probe, before creating'),
      check('start-create', creates.length === 1 && arg(creates[0], 'project') === f.input.host.project &&
        arg(creates[0], 'workflow') === f.input.host.workflow && sent.some(c => step(c) === 'link' && names(c, ticket) &&
          (arg(c, 'links') ?? []).some(l => l?.uri === f.input.host.conversation_link)),
      'Create one ticket in the host\'s project and workflow and add the conversation link'),
      check('nothing-routed', !sent.some(c => step(c).startsWith('transition:') || step(c).startsWith('update')),
        'Before the requester\'s approval, no state change and no conductor'),
    ] };
  }
  const update = sent.find(c => step(c) === 'update:conductor');
  return { diagnostics, checks: [...common,
    check('writes', sent.every(c => names(c, ticket)) && sent.map(step).join() === e.writes.join(),
      `Write exactly, in order: ${e.writes.join(', ') || 'nothing'}`),
    ...(update ? [check('conductor', arg(update, 'conductor') === e.conductor, 'Set the host\'s conductor')] : []),
    ...(e.writes.includes('comment:spec') ? [
      check('spec-content', /\bAC1\b/.test(body('spec')) && body('spec').includes(`Approved by ${e.requester}`),
        'The spec carries the AC IDs and closes with the requester\'s approval'),
      check('plan-content', body('plan').trim() !== '' && /\bAC1\b/.test(body('test')), 'The plan is written and the test plan names the AC IDs'),
    ] : []),
    ...(e.asks_conductor ? [check('conductor-asked', toolCalls(trace, 'bakers_conductor_list').some(succeeded),
      'Without a host conductor, read the project\'s conductors to ask for one')] : []),
  ] };
}
export const checkOutput = (f, _output, context) => analyze(f, context).checks;
export const diagnose = (f, _output, context) => analyze(f, context).diagnostics;
