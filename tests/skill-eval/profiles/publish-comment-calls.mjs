import { calls, check, commentMatches, commonChecks, data, discoveryBefore, firstEvidence, readRecovery, succeeded, uncertain, uuid, validateTools, value, writes } from '../call-utils.mjs';
import { nonempty, requireValue } from '../validation.mjs';
export function validate(f) {
  validateTools(f, 'bb-workflow/references/publish-comment.md');
  requireValue(uuid(f.input.ticket_uuid) && nonempty(f.input.comment_type) && nonempty(f.simulation.files?.[f.input.body_file]), 'Expected caller UUID, comment type and virtual Markdown file');
}
function analyze(f, context) {
  const trace = calls(context), allWrites = writes(trace);
  const creates = allWrites.filter(c => c.action === 'create');
  const write = allWrites.find(c => c.action === 'create' && c.target === 'bb_comment');
  const body = f.simulation.files[f.input.body_file];
  const identifier = data(write)?.id;
  const confirmed = succeeded(write) && uuid(identifier);
  // Optional readbacks remain allowed; a recovered read is a call-quality warning.
  const first = confirmed ? firstEvidence(trace, identifier, write.index) : undefined;
  const exact = commentMatches(first?.record, { id: identifier, ticket: f.input.ticket_uuid, type: f.input.comment_type, body });
  const barrier = allWrites.find(c => c.index > write?.index)?.index ?? Infinity;
  const { recovered, diagnostics } = readRecovery(trace, confirmed ? [{ id: identifier, after: write.index, before: barrier, verified: exact ? first.index : undefined }] : []);
  const timedOut = f.simulation.uncertain_comment && uncertain(write);
  const repeated = creates.length > 1 || allWrites.length > 1;
  if (timedOut) diagnostics.push({
    id: 'uncertain-write', category: 'uncertain-write', severity: repeated ? 'failure' : 'info',
    reason: repeated ? 'A second write followed the fixture-injected timeout' : 'Fixture-injected timeout reported as unresolved without a second create',
    calls: [write.index],
  });
  const checks = [
    ...commonChecks(trace, c => timedOut && c === write, recovered),
    check('comment-write', creates.length === 1 && write && value(write, 'bundle') === 'bb_comment' &&
      value(write, 'body.value') === body && value(write, 'body.format') === 'bb_rich' &&
      value(write, 'bb_comment_type') === f.input.comment_type && value(write, 'ticket_id') === f.input.ticket_uuid,
      'Create exactly one caller-authorized comment with exact Markdown, type, format and ticket UUID'),
    check('comment-mutation-scope', allWrites.every(c => c === write || (c.action === 'update' && c.target === `bb_comment/bb_comment/${identifier}`)),
      'Any correction stays on the one caller-authorized comment; no other entity mutation'),
    check('comment-input-and-schema', trace.some(c => write && c.index < write.index && c.tool === 'read_file' && c.arguments.path === f.input.body_file && succeeded(c)) && discoveryBefore(trace, write),
      'Read the supplied body file and discover unknown writable fields before creation'),
    check('comment-confirmed', f.simulation.uncertain_comment || confirmed,
      'A successful create response returning the new UUID confirms the comment'),
    check('uncertain-write-not-repeated', !f.simulation.uncertain_comment || (timedOut && !repeated),
      'A timed-out create stays unresolved; never send a second create'),
  ];
  return { checks, diagnostics };
}
export const checkOutput = (f, _output, context) => analyze(f, context).checks;
export const diagnose = (f, _output, context) => analyze(f, context).diagnostics;
