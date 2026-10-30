import { calls, check, names, succeeded, toolCalls, uuid, validateTools, writes } from '../call-utils.mjs';
import { requireValue } from '../validation.mjs';

const INTAKE = 'bb-workflow/references/intake.md';

// Routing through bb-workflow: which recipe file is read, which slots are named, where it stops.
export function validate(f) {
  validateTools(f, 'bb-workflow');
  const e = f.expect;
  requireValue(uuid(f.input.ticket_uuid) && f.simulation.ticket?.id === f.input.ticket_uuid, 'Expected the simulated ticket');
  requireValue(typeof e?.recipe?.path === 'string' && typeof e.recipe.read === 'boolean' && Array.isArray(e.markers) &&
    Array.isArray(e.absent), 'Expected expect.recipe {path, read}, markers and absent');
  requireValue(Boolean(e.stop) !== Boolean(e.intake), 'Expect either a stop identifier or an intake gate');
  requireValue(f.virtual_references?.includes(INTAKE), 'Serve the intake as a virtual file so its reads are counted');
}

export function checkOutput(f, output, context) {
  const e = f.expect, trace = calls(context);
  const skillReads = trace.filter(c => c.tool === 'read_file' && succeeded(c) && String(c.arguments?.path).startsWith('skills/'));
  return [
    check('ticket-read', toolCalls(trace, 'bakers_ticket_read').some(c => names(c, f.simulation.ticket) && succeeded(c)), 'Read the ticket before routing'),
    check('no-mutation', writes(trace).length === 0, 'Routing writes nothing: no tracker write tool'),
    check('recipe-read', skillReads.some(c => c.arguments.path === e.recipe.path) === e.recipe.read,
      e.recipe.read ? 'Read the resolved recipe as a file' : 'Read no content for this recipe: it is missing, or routing stopped first'),
    check('slot-markers', e.markers.every(m => output.includes(m)) && e.absent.every(m => !output.includes(m)),
      'Name the slot markers of the chosen sections, and none of the sections that do not apply'),
    check('intake-read', skillReads.filter(c => c.arguments.path === `skills/${INTAKE}`).length === (e.stop ? 0 : 1),
      e.stop ? 'Stop before the intake: no intake read' : 'Read the intake exactly once'),
    e.stop
      ? check('stop-named', output.includes(e.stop), 'Stop and name the exact identifier that failed')
      : check('intake-rendered', output.includes(e.intake), 'Render the intake with its target gate; no write starts the state'),
  ];
}
