import { arg, callRecovery, calls, check, commonChecks, payload, readAfter, succeeded, tool, toolCalls, uuid, validateTools, writes } from '../call-utils.mjs';
import { nonempty, requireValue } from '../validation.mjs';
export function validate(f) {
  validateTools(f, 'bb-create-ticket');
  requireValue(uuid(f.input.project_uuid) && nonempty(f.input.title) && nonempty(f.simulation.files?.[f.input.description_file]), 'Expected title, project and virtual Markdown description');
}
// qualify-ticket fields appear as `out_of_scope: …` or as an "Out of scope" section.
const recorded = (body, field) => body.includes(field) ||
  new RegExp(`^#+ *${field.replaceAll('_', ' ')} *$`, 'im').test(body);
const PROBE = 'ticket';
/** Prior art: two spellings searched, and an empty search proven by the `ticket` probe returning a row. */
export function priorArtSearched(searches) {
  const ok = searches.filter(succeeded);
  const spellings = new Set(ok.map(c => arg(c, 'query')).filter(q => q && q !== PROBE));
  const empty = ok.some(c => arg(c, 'query') !== PROBE && !payload(c)?.tickets?.length);
  const probe = ok.some(c => arg(c, 'query') === PROBE && payload(c)?.tickets?.length > 0);
  return spellings.size >= 2 && (!empty || probe);
}
function analyze(f, context) {
  const trace = calls(context, f.simulation.files), allWrites = writes(trace);
  const searches = toolCalls(trace, 'bakers_ticket_search');
  const searchCheck = check('prior-art-search', priorArtSearched(searches),
    'Search at least two domain spellings; prove an empty search with the known-positive `ticket` probe');
  const prior = f.simulation.prior_art;
  const { recovered, diagnostics } = callRecovery(trace);
  if (prior) return { diagnostics, checks: [...commonChecks(trace, () => false, recovered), searchCheck,
    check('prior-art-read', toolCalls(trace, 'bakers_ticket_read').some(c => succeeded(c) && payload(c)?.id === prior.id &&
      payload(c)?.description === prior.description && payload(c)?.state === prior.state),
    'Read the returned candidate in full before judging it'),
    check('prior-art-stop', allWrites.length === 0, 'A relevant unresolved prior-art hit permits no create, comment or transition'),
  ] };
  const creates = toolCalls(trace, 'bakers_ticket_create').filter(c => c.result?.exit_code !== 4);
  const create = creates[0], created = payload(create);
  const ticket = { id: created?.id, identifier: created?.identifier };
  const initial = readAfter(trace, create, ticket);
  const comments = allWrites.filter(c => c.name === tool('bakers_comment_publish') && c.result?.exit_code !== 4);
  const qualification = comments.find(c => arg(c, 'type') === 'qualification');
  const summary = comments.find(c => arg(c, 'type') === 'summary');
  const transitions = allWrites.filter(c => c.name === tool('bakers_ticket_transition') && arg(c, 'state'));
  const transition = transitions[0], final = readAfter(trace, transition, ticket);
  const description = f.simulation.files[f.input.description_file];
  const barrier = transition?.index ?? Infinity;
  const own = c => [ticket.id, ticket.identifier].includes(arg(c, 'ticket'));
  return { diagnostics, checks: [...commonChecks(trace, () => false, recovered), searchCheck,
    check('create-after-search', create && searches.some(c => c.index < create.index) && searches.filter(c => c.index < create.index).length === searches.length,
      'Complete the prior-art search before creating'),
    check('ticket-create', creates.length === 1 && arg(create, 'title') === f.input.title && arg(create, 'workflow') === 'bb_work' &&
      arg(create, 'project') === f.input.project_uuid && arg(create, 'description') === description &&
      arg(create, 'recipe') === f.input.recipe && arg(create, 'type') === f.input.ticket_type && !arg(create, 'parent'),
    'Create one ticket with the verbatim title, exact Markdown, project, recipe and type by name; infer no parent'),
    check('ticket-readback', uuid(created?.id) && initial && payload(initial).title === f.input.title && payload(initial).description === description &&
      payload(initial).state === 'qualification' && payload(initial).recipe === f.input.recipe && payload(initial).type === f.input.ticket_type,
    'Read the created ticket and verify title, description, recipe, type and initial state'),
    check('qualification-and-summary', comments.length === 2 && qualification && summary && qualification.index < summary.index &&
      ['test_as', 'out_of_scope', 'handoff_version', 'reproduction', 'scenario_required'].every(field => recorded(arg(qualification, 'body') ?? '', field)) &&
      arg(qualification, 'body')?.includes(f.input.acceptance_criterion) &&
      comments.every(c => own(c) && succeeded(c) && uuid(payload(c)?.id) && c.index < barrier),
    'Publish one complete qualification and one summary, both confirmed by their results, before routing'),
    check('single-initial-route', allWrites.length === 4 && transitions.length === 1 && own(transition) && arg(transition, 'state') === 'plan' &&
      payload(final)?.state === 'plan' && trace.at(-1) === final,
    'Route the ticket once to plan, verify readback and stop without starting plan work'),
  ] };
}
export const checkOutput = (f, _output, context) => analyze(f, context).checks;
export const diagnose = (f, _output, context) => analyze(f, context).diagnostics;
