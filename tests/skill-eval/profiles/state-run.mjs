import { calls, check, readAfter, succeeded, uuid, validateTools, value, writes } from '../call-utils.mjs';
import { requireValue } from '../validation.mjs';

// A whole state through bb-workflow: which comments are published in which order, and where it routes.
export function validate(f) {
  validateTools(f, 'bb-workflow');
  const e = f.expect;
  requireValue(uuid(f.input.ticket_uuid) && f.simulation.ticket?.id === f.input.ticket_uuid, 'Expected the simulated ticket');
  requireValue(Array.isArray(e?.comments) && e.comments.at(-1) === 'summary' && (e.transition === null || typeof e.transition === 'string'),
    'Expected the comment sequence ending in summary, and a transition or null');
}

export function checkOutput(f, output, context) {
  const e = f.expect, trace = calls(context), all = writes(trace);
  const target = `bb_ticket/bb_ticket/${f.input.ticket_uuid}`;
  const comments = all.filter(c => c.action === 'create' && c.target === 'bb_comment' && succeeded(c));
  const states = all.filter(c => c.action === 'update' && c.target === target && value(c, 'state'));
  const summary = comments.find(c => value(c, 'bb_comment_type') === 'summary');
  const checks = [
    check('ticket-read', trace.some(c => c.action === 'read' && c.target === target && succeeded(c)), 'Read the ticket first'),
    check('validated', !trace.some(c => 'no-validate' in c.flags), 'Never bypass validation'),
    check('comment-sequence', JSON.stringify(comments.map(c => value(c, 'bb_comment_type'))) === JSON.stringify(e.comments),
      `Publish exactly ${e.comments.join(', ')}, in that order`),
    e.transition
      ? check('transition', states.length === 1 && value(states[0], 'state') === e.transition && comments.every(c => c.index < states[0].index) &&
        Boolean(readAfter(trace, states[0], target)), `After the comments, transition once to ${e.transition} and read it back`)
      : check('no-transition', states.length === 0, 'Stop at the approval: no state write'),
  ];
  if (e.classify) {
    const update = all.find(c => c.action === 'update' && c.target === target && value(c, 'recipe_names'));
    checks.push(check('classified', update && value(update, 'type_names') && comments.every(c => c.index > update.index),
      'Write recipe and type before publishing the handoff'));
  }
  if (e.markers) {
    checks.push(check('summary-markers', summary && e.markers.every(m => value(summary, 'body.value')?.includes(m)),
      'The summary carries the recipe slot lines'));
  }
  if (e.answers) {
    const spec = comments.find(c => value(c, 'bb_comment_type') === 'spec');
    checks.push(check('answers-used', spec && e.answers.every(a => value(spec, 'body.value')?.includes(a)),
      'The spec is written from the answers to the slot\'s questions'));
  }
  return checks;
}
