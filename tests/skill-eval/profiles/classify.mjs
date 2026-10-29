import { arg, calls, check, names, payload, readAfter, succeeded, tool, toolCalls, uuid, validateTools, writes } from '../call-utils.mjs';
import { requireValue } from '../validation.mjs';

// Classification: one bakers_ticket_classify call naming recipe and type, verified by readback — or a question and no write.
export function validate(f) {
  validateTools(f, 'bb-workflow/references/classify.md');
  const e = f.expect;
  requireValue(uuid(f.input.ticket_uuid) && f.simulation.ticket?.state === 'qualification', 'Expected a ticket in qualification');
  requireValue(e?.write === true ? typeof e.recipe === 'string' && Array.isArray(e.types) && e.types.length > 0
    : e?.write === false && Array.isArray(e.question) && e.question.length > 1, 'Expected a write expectation or the recipes asked about');
}

/** The one classification of a ticket: a successful call with recipe and type, and a later readback showing both. */
export function classified(trace, ticket, accept = () => true) {
  const all = toolCalls(trace, 'bakers_ticket_classify').filter(c => c.result?.exit_code !== 4);
  const call = all[0], read = readAfter(trace, call, ticket);
  return all.length === 1 && names(call, ticket) && succeeded(call) && arg(call, 'recipe') && arg(call, 'type') &&
    accept(arg(call, 'recipe'), arg(call, 'type')) &&
    payload(read)?.recipe === arg(call, 'recipe') && payload(read)?.type === arg(call, 'type') ? call : undefined;
}

export function checkOutput(f, output, context) {
  const e = f.expect, trace = calls(context, f.simulation.files), all = writes(trace), ticket = f.simulation.ticket;
  const recipes = trace.filter(c => c.tool === 'read_file' && succeeded(c) && /^skills\/bb-recipe-/.test(c.arguments?.path));
  const classification = classified(trace, ticket, (recipe, type) => recipe === e.recipe && e.types.includes(type));
  const common = [
    check('ticket-read', toolCalls(trace, 'bakers_ticket_read').some(c => names(c, ticket) && succeeded(c)), 'Read the ticket'),
    check('recipes-read', recipes.length >= 2, 'Read the descriptions of the installed recipes'),
    check('nothing-else', all.every(c => e.write && c.name === tool('bakers_ticket_classify')),
      e.write ? 'Publish no comment, write no label and transition nothing' : 'Write nothing before the human answers'),
  ];
  if (!e.write) {
    return [...common,
      // A recipe is named as its skill or as the `recipe` field value: `bb-recipe-pair` or `pair`.
      check('asks', output.includes('?') && e.question.every(name => output.includes(name) || output.includes(`\`${name.replace('bb-recipe-', '')}\``)),
        'Ask the human to choose between the fitting recipes')];
  }
  return [...common, check('classified', classification,
    'One bakers_ticket_classify call with the recipe (the suffix) and a declared type, read back')];
}
