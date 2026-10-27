import { calls, check, commentMatches, commonChecks, data, discoveryBefore, firstEvidence, payload, readAfter, readRecovery, succeeded, uuid, validateTools, value, writes } from '../call-utils.mjs';
import { nonempty, requireValue } from '../validation.mjs';
export function validate(f) {
  validateTools(f, 'bb-create-ticket');
  requireValue(uuid(f.input.project_uuid) && nonempty(f.input.title) && nonempty(f.simulation.files?.[f.input.description_file]), 'Expected title, project and virtual Markdown description');
}
// qualify-ticket fields appear as `out_of_scope: …` or as an "Out of scope" section.
const recorded = (body, field) => body.includes(field) ||
  new RegExp(`^#+ *${field.replaceAll('_', ' ')} *$`, 'im').test(body);
// The name a read resolved for a single-valued term relationship, from its included terms.
const termName = (read, relationship) => {
  const id = data(read)?.relationships?.[relationship]?.data?.id;
  return payload(read)?.included?.find(t => t.id === id)?.attributes?.name;
};
// The same from a Markdown read: `recipe: [bb_term--recipe/<id>]`, then `id: <id>\nname: <name>` under Included.
const markdownTerm = (read, relationship) => {
  const md = read.result.stdout, id = md.match(new RegExp(`^${relationship}: \\[bb_term--[a-z_]+/([^\\]]+)\\]`, 'm'))?.[1];
  return id && md.match(new RegExp(`^id: ${id}\\nname: (.+)$`, 'm'))?.[1];
};
const retiredLabel =c => /(^|,)\s*(work|method):/.test(value(c, 'label_names') ?? '');
function analyze(f, context) {
  const trace = calls(context), allWrites = writes(trace);
  const searches = trace.filter(c => c.action === 'search' && c.target === 'bb_ticket' && succeeded(c));
  const queries = searches.flatMap(c => c.flags.filter ?? []);
  const terms = new Set(queries.filter(q => /^(title|description\.value):CONTAINS:/.test(q)).map(q => q.split(':').slice(2).join(':')).filter(q => q !== 'ticket'));
  const coverage = [...terms].filter(term => queries.includes(`title:CONTAINS:${term}`) && queries.includes(`description.value:CONTAINS:${term}`)).length >= 2;
  // Searches use the Markdown renderer the references prescribe; JSON results parse as data.
  const markdown = c => typeof c.result?.stdout === 'string' ? c.result.stdout : '';
  const probe = searches.some(c => (c.flags.filter ?? []).includes('title:CONTAINS:ticket') && (data(c)?.length > 0 || markdown(c).includes('type: bb_ticket--bb_ticket')));
  const prior = f.simulation.prior_art;
  const searchCheck = check('prior-art-search', coverage && (prior || probe), 'Search two domain spellings in both title and description.value; validate empty queries with a known-positive probe');
  if (prior) return { diagnostics: [], checks: [...commonChecks(trace), searchCheck,
    check('prior-art-read', trace.some(c => c.action === 'read' && c.target === `bb_ticket/bb_ticket/${prior.id}` && succeeded(c)) ||
      searches.some(c => data(c)?.some(row => row.id === prior.id && row.attributes?.description?.value === prior.description.value && row.attributes?.state === prior.state) ||
        // The renderer indents a multi-line description, so it compares line by line.
        [`id: ${prior.id}`, `state: ${prior.state}`, ...prior.description.value.split('\n').filter(Boolean)].every(s => markdown(c).includes(s))),
      'Inspect a complete returned candidate, either in search results or through a separate read'),
    check('prior-art-stop', allWrites.length === 0, 'A relevant unresolved prior-art hit permits no create, comment or transition'),
  ] };
  const creates = allWrites.filter(c => c.action === 'create' && c.target === 'bb_ticket');
  const create = creates[0], identifier = data(create)?.id;
  const target = `bb_ticket/bb_ticket/${identifier}`;
  // The first read after the create verifies it, as JSON or Markdown; the format is always bb_rich, fixed by the create.
  const initial = trace.find(c => create && c.index > create.index && c.action === 'read' && c.target === target && succeeded(c));
  const comments = allWrites.filter(c => c.action === 'create' && c.target === 'bb_comment');
  const qualification = comments.find(c => value(c, 'bb_comment_type') === 'qualification');
  const summary = comments.find(c => value(c, 'bb_comment_type') === 'summary');
  const transitions = allWrites.filter(c => c.action === 'update' && value(c, 'state'));
  const transition = transitions[0], final = readAfter(trace, transition, target);
  const description = f.simulation.files[f.input.description_file];
  // Both publications are confirmed by their create responses before the first state write;
  // an optional readback can still earn a recovered-read warning.
  const barrier = transition?.index ?? Infinity;
  const obligations = comments.map(c => {
    const id = data(c)?.id;
    const first = firstEvidence(trace, id, c.index);
    const exact = commentMatches(first?.record, { id, ticket: identifier, type: value(c, 'bb_comment_type'), body: value(c, 'body.value') }) &&
      value(c, 'ticket_id') === identifier && value(c, 'body.format') === 'bb_rich';
    return { id, after: c.index, before: barrier, verified: exact ? first.index : undefined };
  });
  const { recovered, diagnostics } = readRecovery(trace, obligations);
  return { diagnostics, checks: [...commonChecks(trace, () => false, recovered), searchCheck,
    check('create-after-search', create && searches.filter(c => c.index < create.index).length >= 5 && discoveryBefore(trace, create), 'Complete prior-art search and schema discovery before creating'),
    check('ticket-create', creates.length === 1 && value(create, 'bundle') === 'bb_ticket' && value(create, 'title') === f.input.title &&
      value(create, 'workflow') === 'bb_work' && value(create, 'project_id') === f.input.project_uuid && value(create, 'description.value') === description &&
      value(create, 'description.format') === 'bb_rich' && value(create, 'recipe_names') === f.input.recipe && value(create, 'type_names') === f.input.ticket_type &&
      !value(create, 'base_branch') && !value(create, 'parent_id') && !value(create, 'conductor_id'),
      'Create one ticket with the verbatim title, exact Markdown, project, recipe and type by name; infer no parent, conductor or base_branch'),
    check('no-work-or-method-labels', !allWrites.some(retiredLabel),
      'Record the method as the recipe field, never as work:* or method:* labels'),
    check('ticket-readback', uuid(identifier) && initial && (data(initial)
      ? data(initial).attributes?.title === f.input.title && data(initial).attributes?.description?.value === description &&
        (data(initial).relationships?.project_id?.data?.id ?? data(initial).attributes?.project_id) === f.input.project_uuid &&
        data(initial).attributes?.state === 'qualification' &&
        termName(initial, 'recipe') === f.input.recipe && termName(initial, 'ticket_type') === f.input.ticket_type
      : [`title: ${f.input.title}`, 'state: qualification', `project_id: [bb_project--bb_project/${f.input.project_uuid}]`,
        ...description.split('\n').filter(Boolean)].every(s => markdown(initial).includes(s)) &&
        markdownTerm(initial, 'recipe') === f.input.recipe && markdownTerm(initial, 'ticket_type') === f.input.ticket_type),
      'Read the created UUID and verify identity, description, project, resolved recipe and type, and initial state'),
    check('qualification-and-summary', comments.length === 2 && qualification && summary && qualification.index < summary.index &&
      ['test_as', 'out_of_scope', 'handoff_version', 'provenance', 'reproduction', 'scenario_required'].every(field => recorded(value(qualification, 'body.value') ?? '', field)) &&
      value(qualification, 'body.value')?.includes(f.input.acceptance_criterion) && comments.every(c => succeeded(c) && uuid(data(c)?.id) && c.index < barrier),
      'Publish one complete qualification and one summary, both confirmed, before routing'),
    check('single-initial-route', allWrites.length === 4 && transitions.length === 1 && transition.target === target && value(transition, 'state') === 'plan' &&
      discoveryBefore(trace, transition) && data(final)?.attributes?.state === 'plan' && trace.at(-1) === final,
      'Route the ticket once to plan, verify readback and stop without starting plan work'),
  ] };
}
export const checkOutput = (f, _output, context) => analyze(f, context).checks;
export const diagnose = (f, _output, context) => analyze(f, context).diagnostics;
