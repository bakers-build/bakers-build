import { arg, callRecovery, calls, check, commonChecks, payload, succeeded, tool, toolCalls, uncertain, uuid, validateTools, writes } from '../call-utils.mjs';
import { nonempty, requireValue } from '../validation.mjs';
export function validate(f) {
  validateTools(f, 'bb-workflow/references/ticket-writes.md');
  requireValue(uuid(f.input.ticket_uuid) && nonempty(f.input.comment_type) && nonempty(f.simulation.files?.[f.input.body_file]), 'Expected caller UUID, comment type and virtual Markdown file');
}
function analyze(f, context) {
  const trace = calls(context, f.simulation.files), allWrites = writes(trace);
  const publications = toolCalls(trace, 'bakers_comment_publish').filter(c => c.result?.exit_code !== 4);
  const write = publications[0];
  const body = f.simulation.files[f.input.body_file];
  const { recovered, diagnostics } = callRecovery(trace);
  const timedOut = f.simulation.uncertain_comment && uncertain(write);
  const repeated = publications.length > 1 || allWrites.some(c => c.result?.exit_code !== 4 && c !== write);
  if (timedOut) diagnostics.push({
    id: 'uncertain-write', category: 'uncertain-write', severity: repeated ? 'failure' : 'info',
    reason: repeated ? 'A second write followed the fixture-injected timeout' : 'Fixture-injected timeout reported as unresolved without a second publication',
    calls: [write.index],
  });
  const checks = [
    ...commonChecks(trace, c => timedOut && c === write, recovered),
    check('comment-write', publications.length === 1 && arg(write, 'body') === body && arg(write, 'type') === f.input.comment_type &&
      [f.input.ticket_uuid, f.simulation.ticket.identifier].includes(arg(write, 'ticket')),
      'Publish exactly one caller-authorized comment with the exact Markdown body, type and ticket'),
    check('comment-mutation-scope', allWrites.every(c => c.name === tool('bakers_comment_publish')),
      'Mutate no other entity: no ticket create, transition or measurement'),
    check('comment-input', trace.some(c => write && c.index < write.index && c.tool === 'read_file' && c.arguments.path === f.input.body_file && succeeded(c)),
      'Read the supplied body file before publishing'),
    check('comment-confirmed', f.simulation.uncertain_comment || (succeeded(write) && uuid(payload(write)?.id) && payload(write)?.type === f.input.comment_type),
      'The publication result returning the new UUID and stored type confirms the comment'),
    check('uncertain-write-not-repeated', !f.simulation.uncertain_comment || (timedOut && !repeated),
      'A timed-out publication stays unresolved; never send a second one'),
  ];
  return { checks, diagnostics };
}
export const checkOutput = (f, _output, context) => analyze(f, context).checks;
export const diagnose = (f, _output, context) => analyze(f, context).diagnostics;
