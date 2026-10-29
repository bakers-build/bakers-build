import { arg, calls, check, commonChecks, names, payload, readAfter, refused, succeeded, tool, uuid, validateTools, writes } from '../call-utils.mjs';
import { requireValue } from '../validation.mjs';
export function validate(f) {
  validateTools(f, 'bb-workflow/references/transition-ticket.md');
  requireValue(uuid(f.input.ticket_uuid) && Array.isArray(f.input.links) && Array.isArray(f.simulation.ticket?.links), 'Expected caller ticket and link sets');
  requireValue(f.input.destination === undefined || typeof f.input.destination === 'string', 'Destination must be explicit or absent');
}
function analyze(f, context) {
  const trace = calls(context, f.simulation.files), allWrites = writes(trace);
  const ticket = f.simulation.ticket;
  const write = allWrites.find(c => c.name === tool('bakers_ticket_transition') && names(c, ticket));
  const read = readAfter(trace, write, ticket);
  const before = trace.find(c => c.name === tool('bakers_ticket_read') && names(c, ticket) && succeeded(c));
  const expected = [...ticket.links, ...f.input.links];
  // The tool keeps existing links; the call adds the supplied ones, and readback shows every link once.
  const preserved = actual => Array.isArray(actual) && expected.every(link => actual.some(a => a.uri === link.uri && a.title === link.title)) &&
    new Set(actual.map(a => a.uri)).size === actual.length && actual.every(a => expected.some(e => e.uri === a.uri));
  const added = arg(write, 'links');
  const rejected = f.simulation.reject_transition;
  const injected = c => rejected && c === write && refused(c);
  const diagnostics = write && injected(write) ? [{ id: 'injected-rejection', category: 'expected-error', severity: 'info',
    reason: 'The fixture refused the requested transition; passing means the refusal was preserved, not that the state changed',
    calls: [write.index] }] : [];
  return { diagnostics, checks: [
    ...commonChecks(trace, injected),
    check('ticket-read', before && write && before.index < write.index && payload(before)?.state === ticket.state,
      'Read the current ticket state before writing'),
    check('single-authorized-update', allWrites.length === 1 && write && (arg(write, 'state') ?? undefined) === f.input.destination,
      'Transition the caller ticket exactly once; state is only the explicit destination and is absent in links-only mode'),
    check('additive-links', Array.isArray(added) && f.input.links.every(link => added.some(a => a.uri === link.uri && a.title === link.title)) &&
      added.every(a => expected.some(e => e.uri === a.uri)),
    'Add only the supplied resolved links; the tool keeps every existing link'),
    check('transition-readback', rejected ? refused(write) :
      payload(read)?.id === f.input.ticket_uuid && payload(read)?.state === (f.input.destination ?? ticket.state) && preserved(payload(read)?.links),
      rejected ? 'A refused transition must remain a refusal; no alternative state retry' : 'Read back and verify state and every preserved link'),
    check('stop-after-result', rejected ? allWrites.at(-1) === write : read && trace.at(-1) === read,
      'Stop after the refusal or verified final readback; start no subsequent work'),
  ] };
}
export const checkOutput = (f, _output, context) => analyze(f, context).checks;
export const diagnose = (f, _output, context) => analyze(f, context).diagnostics;
