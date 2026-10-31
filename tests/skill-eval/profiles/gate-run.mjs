import { arg, calls, check, names, readAfter, succeeded, tool, toolCalls, writes } from '../call-utils.mjs';
import { requireValue } from '../validation.mjs';

// One gate of a state through bb-workflow, after its handoff is already published: does it
// route, and does it stop where a human must answer.
export function validate(f) {
  requireValue(f.skill === 'bb-workflow' && f.execution === 'simulated-tools' && f.simulation?.ticket, 'Expected a simulated bb-workflow fixture');
  const e = f.expect;
  requireValue(e && (e.transition === null || typeof e.transition === 'string') && Array.isArray(e.comments),
    'Expected the published comment types and a transition or null');
  requireValue(e.asks === undefined || (Array.isArray(e.asks) && e.asks.every(a => typeof a === 'string' && a)),
    'Expected asks as output fragments');
}

export function checkOutput(f, output, context) {
  const e = f.expect, trace = calls(context, f.simulation.files), all = writes(trace), ticket = f.simulation.ticket;
  const comments = all.filter(c => c.name === tool('bakers_comment_publish') && names(c, ticket) && succeeded(c));
  const states = all.filter(c => c.name === tool('bakers_ticket_transition') && names(c, ticket) && arg(c, 'state'));
  const checks = [
    check('ticket-read', toolCalls(trace, 'bakers_ticket_read').some(c => names(c, ticket) && succeeded(c)), 'Read the ticket first'),
    check('comment-sequence', JSON.stringify(comments.map(c => arg(c, 'type'))) === JSON.stringify(e.comments),
      `Publish exactly ${e.comments.join(', ') || 'nothing'}, in that order`),
    e.transition
      ? check('transition', states.length === 1 && arg(states[0], 'state') === e.transition && comments.every(c => c.index < states[0].index) &&
        Boolean(readAfter(trace, states[0], ticket)), `Transition once to ${e.transition} and read it back`)
      : check('no-transition', states.length === 0, 'Stop at the gate: no state write'),
  ];
  if (e.asks) {
    const text = String(output).toLowerCase();
    checks.push(check('asks', e.asks.every(a => text.includes(a.toLowerCase())), `The output asks about ${e.asks.join(', ')}`));
  }
  if (e.automatic) {
    checks.push(check('approval-recorded', comments.some(c => String(arg(c, 'body') ?? '').includes('Approval: automatic')),
      'A published comment records `Approval: automatic`'));
  }
  return checks;
}
