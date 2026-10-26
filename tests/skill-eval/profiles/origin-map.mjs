import { calls, check, succeeded, uuid, validateTools, writes } from '../call-utils.mjs';
import { requireValue } from '../validation.mjs';

// Origin status reads only the WORKFLOW.md table: the label written, the labels removed, or no write.
export function validate(f) {
  validateTools(f, 'bb-workflow/references/origin-status.md');
  const e = f.expect;
  requireValue(uuid(f.input.ticket_uuid) && f.simulation.ticket?.id === f.input.ticket_uuid && typeof f.simulation.files?.['WORKFLOW.md'] === 'string',
    'Expected the simulated ticket and a WORKFLOW.md file');
  requireValue(e?.label === null || (typeof e?.label === 'string' && typeof e.remove === 'string'), 'Expected label and remove, or label null');
}

export function checkOutput(f, output, context) {
  const e = f.expect, trace = calls(context);
  const updates = trace.filter(c => c.tool === 'glab' && (c.arguments?.argv ?? []).slice(1, 3).join(' ') === 'issue update');
  const after = (argv, flag) => argv[argv.indexOf(flag) + 1];
  return [
    check('workflow-read', trace.some(c => c.tool === 'read_file' && c.arguments?.path === 'WORKFLOW.md' && succeeded(c)), 'Read the table from WORKFLOW.md'),
    check('no-tracker-writes', writes(trace).length === 0, 'Origin status writes no ticket or comment'),
    e.label === null
      ? check('no-write', updates.length === 0, 'No table: no origin label is written or removed')
      : check('label-write', updates.length === 1 && succeeded(updates[0]) && after(updates[0].arguments.argv, '--label') === e.label &&
        after(updates[0].arguments.argv, '--unlabel') === e.remove, `Write ${e.label} and remove ${e.remove} in one call`),
  ];
}
