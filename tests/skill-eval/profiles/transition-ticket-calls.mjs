import { calls, check, commonChecks, data, discoveryBefore, linkArray, readAfter, succeeded, uuid, validateTools, value, writes } from '../call-utils.mjs';
import { requireValue } from '../validation.mjs';
export function validate(f) {
  validateTools(f, 'transition-ticket');
  requireValue(uuid(f.input.ticket_uuid) && Array.isArray(f.input.links) && Array.isArray(f.simulation.ticket?.links), 'Expected caller ticket and link sets');
  requireValue(f.input.destination === undefined || typeof f.input.destination === 'string', 'Destination must be explicit or absent');
}
function analyze(f, context) {
  const trace = calls(context), allWrites = writes(trace);
  const target = `bb_ticket/bb_ticket/${f.input.ticket_uuid}`;
  const write = allWrites.find(c => c.action === 'update' && c.target === target);
  const read = readAfter(trace, write, target);
  const before = trace.find(c => c.action === 'read' && c.target === target && succeeded(c));
  const links = linkArray(write);
  const expected = [...f.simulation.ticket.links, ...f.input.links];
  const preserved = actual => Array.isArray(actual) && expected.every(link => actual.some(a => a.uri === link.uri && a.title === link.title)) &&
    new Set(actual.map(a => a.uri)).size === actual.length && actual.every(a => expected.some(e => e.uri === a.uri));
  const rejected = f.simulation.reject_transition;
  const injected = c => rejected && c === write && /422/.test(c.result?.stderr);
  const diagnostics = write && injected(write) ? [{ id: 'injected-rejection', category: 'expected-error', severity: 'info',
    reason: 'The fixture rejected the requested state write with 422; passing means the rejection was preserved, not that the state changed',
    calls: [write.index] }] : [];
  return { diagnostics, checks: [
    ...commonChecks(trace, injected),
    check('ticket-read-and-schema', before && write && before.index < write.index && data(before)?.attributes?.state === f.simulation.ticket.state && discoveryBefore(trace, write),
      'Read current ticket state and discover writable fields before updating'),
    check('single-authorized-update', allWrites.length === 1 && write && value(write, 'state') === f.input.destination,
      'Update the caller UUID exactly once; state is only the explicit destination and is absent in links-only mode'),
    check('additive-links', preserved(links), 'Retain every existing link, including historical CI links, and add only the supplied resolved links once'),
    check('transition-readback', rejected ? write?.result.exit_code !== 0 && /422/.test(write?.result.stderr) :
      data(read)?.id === f.input.ticket_uuid && data(read)?.attributes?.state === (f.input.destination ?? f.simulation.ticket.state) && preserved(data(read)?.attributes?.links),
      rejected ? 'A definite 422 must remain a rejection; no alternative state retry' : 'Read back and verify state and every preserved link'),
    check('stop-after-result', rejected ? allWrites.at(-1) === write : read && trace.at(-1) === read,
      'Stop after the rejection or verified final readback; start no subsequent work'),
  ] };
}
export const checkOutput = (f, _output, context) => analyze(f, context).checks;
export const diagnose = (f, _output, context) => analyze(f, context).diagnostics;
