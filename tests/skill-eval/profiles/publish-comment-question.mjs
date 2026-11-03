import { arg, callRecovery, calls, check, commonChecks, payload, succeeded, tool, toolCalls, uuid, validateTools, writes } from '../call-utils.mjs';
import { nonempty, requireValue } from '../validation.mjs';
export function validate(f) {
  validateTools(f, 'bb-workflow/references/publish-comment.md');
  requireValue(uuid(f.input.ticket_uuid) && nonempty(f.input.question) && Array.isArray(f.input.choices) && f.input.choices.length > 1,
    'Expected caller UUID, a question and at least two choices');
}
function analyze(f, context, output) {
  const trace = calls(context, f.simulation.files), allWrites = writes(trace);
  const { recovered, diagnostics } = callRecovery(trace);
  const sent = c => c.result?.exit_code !== 4;
  const publications = toolCalls(trace, 'bakers_comment_publish').filter(sent);
  const updates = toolCalls(trace, 'bakers_ticket_update').filter(sent);
  const [comment] = publications, [update] = updates;
  const body = String(arg(comment, 'body') ?? '');
  const ticketOk = c => [f.input.ticket_uuid, f.simulation.ticket.identifier].includes(arg(c, 'ticket'));
  const labels = arg(update, 'labels_add');
  const id = payload(comment)?.id;
  const checks = [
    ...commonChecks(trace, () => false, recovered),
    check('question-comment', publications.length === 1 && ticketOk(comment) && arg(comment, 'type') === 'comment' && /^# Question\s*\n/.test(body),
      'Publish exactly one comment of type comment whose body starts with # Question'),
    check('question-choices', /^\s*1\.\s+\S/m.test(body) && /^\s*2\.\s+\S/m.test(body) && /recommend/i.test(body),
      'List the choices as a numbered list with the recommended one marked'),
    check('question-answer-line', /answer in a comment/i.test(body) && /remove the label \*?Question\*?/i.test(body) && /unfreeze/i.test(body),
      'Tell the human to answer in a comment, remove the label Question and unfreeze'),
    check('question-label-freeze', updates.length === 1 && ticketOk(update) && Array.isArray(labels) && labels.includes('Question') &&
      arg(update, 'frozen') === true && comment && update.index > comment.index && succeeded(update),
      'After the comment, one bakers_ticket_update adds the label Question and freezes the ticket'),
    check('question-run-ends', allWrites.every(c => !sent(c) || c === comment || c === update),
      'End the run: no summary, transition or other write'),
    check('question-id-printed', uuid(id) && output.includes(id), 'Print the question comment id'),
  ];
  return { checks, diagnostics };
}
export const checkOutput = (f, output, context) => analyze(f, context, output).checks;
export const diagnose = (f, output, context) => analyze(f, context, output).diagnostics;
