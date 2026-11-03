import { callRecovery, calls, check, commonChecks, toolCalls, uuid, validateTools, writes } from '../call-utils.mjs';
import { requireValue } from '../validation.mjs';
export function validate(f) {
  validateTools(f, 'bb-workflow/references/read-ticket.md');
  requireValue(uuid(f.input.ticket_uuid) && uuid(f.input.question_comment) &&
    f.simulation.comments?.some(c => c.id === f.input.question_comment), 'Expected the ticket and its seeded question comment');
}
function analyze(f, context, output) {
  const trace = calls(context, f.simulation.files);
  const { recovered, diagnostics } = callRecovery(trace);
  const checks = [
    ...commonChecks(trace, () => false, recovered),
    check('question-read', toolCalls(trace, 'bakers_ticket_read').some(c => c.result?.exit_code === 0), 'Read the ticket with its comments'),
    check('question-no-write', writes(trace).every(c => c.result?.exit_code === 4), 'An open question allows no write'),
    check('question-waits', output.includes(`waiting for an answer to ${f.input.question_comment}`),
      'Print waiting for an answer to <question comment id>'),
  ];
  return { checks, diagnostics };
}
export const checkOutput = (f, output, context) => analyze(f, context, output).checks;
export const diagnose = (f, output, context) => analyze(f, context, output).diagnostics;
