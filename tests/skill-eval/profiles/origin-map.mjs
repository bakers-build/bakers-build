import { calls, check, succeeded, uuid, validateTools, writes } from '../call-utils.mjs';
import { requireValue } from '../validation.mjs';

const isRead = argv => argv?.[0] === 'glab' && argv[1] === 'api';
// The fixture's label listing is the project's label set; a fixture without one has no table to match.
const labelSet = f => {
  const read = f.simulation.commands?.glab?.find(c => isRead(c.argv));
  return read && JSON.parse(read.result.stdout).map(l => l.name);
};

// Origin status reads the WORKFLOW.md table, matches it to the project's labels and writes only existing names.
export function validate(f) {
  validateTools(f, 'bb-workflow/references/origin-status.md');
  const e = f.expect;
  requireValue(uuid(f.input.ticket_uuid) && f.simulation.ticket?.id === f.input.ticket_uuid && typeof f.simulation.files?.['WORKFLOW.md'] === 'string',
    'Expected the simulated ticket and a WORKFLOW.md file');
  requireValue((e?.label === null || typeof e?.label === 'string') && (e.remove === undefined || typeof e.remove === 'string'),
    'Expected label (string or null) and an optional remove');
  requireValue(e.warn === undefined || (Array.isArray(e.warn) && e.warn.every(w => typeof w === 'string')), 'Expected warn as a list of label names');
  requireValue((e.label === null && e.remove === undefined) || Array.isArray(labelSet(f)), 'Expected a glab api label listing for a fixture that writes');
}

export function checkOutput(f, output, context) {
  const e = f.expect, trace = calls(context), existing = labelSet(f);
  const updates = trace.filter(c => c.tool === 'glab' && (c.arguments?.argv ?? []).slice(1, 3).join(' ') === 'issue update');
  const read = trace.find(c => c.tool === 'glab' && isRead(c.arguments?.argv) && succeeded(c));
  const after = (argv, flag) => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null;
  const written = updates.flatMap(u => ['--label', '--unlabel'].flatMap(flag => after(u.arguments.argv, flag)?.split(',') ?? []));
  const checks = [
    check('workflow-read', trace.some(c => c.tool === 'read_file' && c.arguments?.path === 'WORKFLOW.md' && succeeded(c)), 'Read the table from WORKFLOW.md'),
    check('no-tracker-writes', writes(trace).length === 0, 'Origin status writes no ticket or comment'),
    e.label === null && e.remove === undefined
      ? check('no-write', updates.length === 0, 'No table: no origin label is written or removed')
      : check('label-write', updates.length === 1 && succeeded(updates[0]) && after(updates[0].arguments.argv, '--label') === e.label &&
        after(updates[0].arguments.argv, '--unlabel') === e.remove, `Write ${e.label ?? 'no label'} and remove ${e.remove} in one call`),
  ];
  if (existing) {
    checks.push(
      check('label-read', updates.every(u => read && read.index < u.index), 'Read the project and group labels before any write'),
      check('existing-labels-only', written.every(name => existing.includes(name)), 'Write and remove only labels the project already has; never create one'),
    );
  }
  if (e.warn) checks.push(check('missing-label-warning', /warn/i.test(output) && e.warn.every(name => output.includes(name)),
    `Warn naming each missing label: ${e.warn.join(', ')}`));
  return checks;
}
