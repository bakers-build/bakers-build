import { arg, callRecovery, calls, check, commonChecks, names, succeeded, tool, validateTools, WRITES } from '../call-utils.mjs';
import { nonempty, requireValue } from '../validation.mjs';
const SEVEN = ['bakers_ticket_create', 'bakers_ticket_read', 'bakers_ticket_search', 'bakers_comment_publish',
  'bakers_ticket_transition', 'bakers_ticket_update', 'bakers_ticket_classify'].map(tool);
export function validate(f) {
  validateTools(f, 'bb-ticket-answer');
  const e = f.expect;
  requireValue(nonempty(f.simulation.ticket?.identifier) && Array.isArray(f.input.conversation) && f.input.conversation.length > 0,
    'Expected a simulated ticket and a conversation');
  requireValue(typeof e?.pass_on === 'boolean', 'Expected expect.pass_on');
  requireValue(!e.pass_on || (nonempty(e.answerer) && nonempty(e.answer_phrase)), 'A passed-on answer names its answerer and a phrase of it');
}
function analyze(f, output, context) {
  const trace = calls(context, f.simulation.files), ticket = f.simulation.ticket, e = f.expect;
  const { recovered, diagnostics } = callRecovery(trace);
  // ticket_update is a write here; the shared WRITES list predates labels_remove.
  const sent = trace.filter(c => c.mode === 'call' && c.result?.exit_code !== 4 &&
    (WRITES.includes(c.name) || c.name === tool('bakers_ticket_update')));
  const read = trace.find(c => c.name === tool('bakers_ticket_read') && names(c, ticket) && succeeded(c));
  const [comment, update] = sent;
  const body = String(arg(comment, 'body') ?? '');
  const passedOn = sent.length === 2 && comment.name === tool('bakers_comment_publish') && names(comment, ticket) &&
    arg(comment, 'type') === 'comment' && body.trimStart().startsWith(`Answered by ${e.answerer}`) &&
    body.toLowerCase().includes(e.answer_phrase.toLowerCase()) &&
    update.name === tool('bakers_ticket_update') && names(update, ticket) &&
    Object.keys(update.args).sort().join() === 'frozen,labels_remove,ticket' &&
    JSON.stringify(arg(update, 'labels_remove')) === '["Question"]' && arg(update, 'frozen') === false;
  return { diagnostics, checks: [
    ...commonChecks(trace, () => false, recovered),
    check('seven-tools', trace.filter(c => c.mode === 'call').every(c => SEVEN.includes(c.name)), 'Call only the seven bakers tools the skill names'),
    check('read-first', read && sent.every(c => c.index > read.index), 'Read the ticket before passing anything on'),
    e.pass_on
      ? check('answer-passed-on', passedOn,
        'One comment naming the answerer with the answer, then one update with exactly labels_remove ["Question"] and frozen false')
      : check('nothing-passed-on', sent.length === 0, 'A settled question, a technical problem or a merge outside next changes nothing'),
    ...(e.reply_names ? [check('reply-names', output.toLowerCase().includes(e.reply_names.toLowerCase()), `The reply names ${e.reply_names}`)] : []),
  ] };
}
export const checkOutput = (f, output, context) => analyze(f, output, context).checks;
export const diagnose = (f, output, context) => analyze(f, output, context).diagnostics;
