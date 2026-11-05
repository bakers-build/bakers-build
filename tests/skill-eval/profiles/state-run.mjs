import { arg, calls, check, names, readAfter, succeeded, tool, toolCalls, uuid, validateTools, writes } from '../call-utils.mjs';
import { requireValue } from '../validation.mjs';
import { classified } from './classify.mjs';

// A whole state through bb-workflow: which comments are published in which order, and where it routes.
export function validate(f) {
  validateTools(f, 'bb-workflow');
  const e = f.expect;
  requireValue(uuid(f.input.ticket_uuid) && f.simulation.ticket?.id === f.input.ticket_uuid, 'Expected the simulated ticket');
  requireValue(Array.isArray(e?.comments) && e.comments.at(-1) === 'summary' && (e.transition === null || typeof e.transition === 'string'),
    'Expected the comment sequence ending in summary, and a transition or null');
  requireValue(e.reads === undefined || (Array.isArray(e.reads) && e.reads.every(r => typeof r === 'string')), 'Expected expect.reads as skill paths');
}

export function checkOutput(f, output, context) {
  const e = f.expect, trace = calls(context, f.simulation.files), all = writes(trace), ticket = f.simulation.ticket;
  const comments = all.filter(c => c.name === tool('bakers_comment_publish') && names(c, ticket) && succeeded(c));
  const states = all.filter(c => c.name === tool('bakers_ticket_transition') && names(c, ticket) && arg(c, 'state'));
  const summary = comments.find(c => arg(c, 'type') === 'summary');
  const checks = [
    check('ticket-read', toolCalls(trace, 'bakers_ticket_read').some(c => names(c, ticket) && succeeded(c)), 'Read the ticket first'),
    check('tool-calls-only', !trace.some(c => c.mode === 'jsonapi'), 'Call bakers tools; no JSON:API command'),
    check('comment-sequence', JSON.stringify(comments.map(c => arg(c, 'type'))) === JSON.stringify(e.comments),
      `Publish exactly ${e.comments.join(', ')}, in that order`),
    e.transition
      ? check('transition', states.length === 1 && arg(states[0], 'state') === e.transition && comments.every(c => c.index < states[0].index) &&
        Boolean(readAfter(trace, states[0], ticket)), `After the comments, transition once to ${e.transition} and read it back`)
      : check('no-transition', states.length === 0, 'Stop at the approval: no state write'),
  ];
  if (e.reads) {
    checks.push(check('reads', e.reads.every(p => trace.some(c => c.tool === 'read_file' && succeeded(c) && c.arguments?.path === p)),
      `Read ${e.reads.join(', ')}`));
  }
  if (e.classify) {
    const classification = classified(trace, ticket);
    checks.push(check('classified', classification && comments.every(c => c.index > classification.index),
      'Classify recipe and type once, read them back, then publish the handoff'));
  }
  if (e.markers) {
    checks.push(check('summary-markers', summary && e.markers.every(m => arg(summary, 'body')?.includes(m)),
      'The summary carries the recipe slot lines'));
  }
  if (e.answers) {
    const spec = comments.find(c => arg(c, 'type') === 'spec');
    checks.push(check('answers-used', spec && e.answers.every(a => arg(spec, 'body')?.includes(a)),
      'The spec is written from the answers to the slot\'s questions'));
  }
  return checks;
}
