import { calls, check, data, readAfter, succeeded, uuid, validateTools, value, writes } from '../call-utils.mjs';
import { requireValue } from '../validation.mjs';

// Classification: one update naming recipe and type, verified by readback — or a question and no write.
export function validate(f) {
  validateTools(f, 'bb-workflow/references/classify.md');
  const e = f.expect;
  requireValue(uuid(f.input.ticket_uuid) && f.simulation.ticket?.state === 'qualification', 'Expected a ticket in qualification');
  requireValue(e?.write === true ? typeof e.recipe === 'string' && Array.isArray(e.types) && e.types.length > 0
    : e?.write === false && Array.isArray(e.question) && e.question.length > 1, 'Expected a write expectation or the recipes asked about');
}

export function checkOutput(f, output, context) {
  const e = f.expect, trace = calls(context), all = writes(trace);
  const target = `bb_ticket/bb_ticket/${f.input.ticket_uuid}`;
  const update = all.find(c => c.action === 'update' && c.target === target);
  const read = readAfter(trace, update, target);
  const recipes = trace.filter(c => c.tool === 'read_file' && succeeded(c) && /^skills\/bb-recipe-/.test(c.arguments?.path));
  const common = [
    check('recipes-read', recipes.length >= 2, 'Read the descriptions of the installed recipes'),
    check('nothing-else', all.every(c => c === update) && !all.some(c => c.target?.startsWith('bb_comment')) &&
      !update?.flags.state && !update?.flags.label_names, 'Publish no comment, write no label and transition nothing'),
  ];
  if (!e.write) {
    return [...common,
      check('no-write', all.length === 0, 'Write no recipe or type before the human answers'),
      // A recipe is named as its skill or as the `recipe` field value: `bb-recipe-pair` or `pair`.
      check('asks', output.includes('?') && e.question.every(name => output.includes(name) || output.includes(`\`${name.replace('bb-recipe-', '')}\``)),
        'Ask the human to choose between the fitting recipes')];
  }
  // The frame reads tickets as Markdown (`recipe: [bb_term--recipe/…]`); JSON reads carry relationships.
  const relationships = data(read)?.relationships ?? {};
  const markdown = typeof read?.result?.stdout === 'string' ? read.result.stdout : '';
  const resolved = name => Boolean(relationships[name]?.data?.id) || new RegExp(`^${name}: \\[bb_term--`, 'm').test(markdown);
  return [...common,
    check('single-update', all.length === 1 && update && succeeded(update) && value(update, 'recipe_names') === e.recipe &&
      e.types.includes(value(update, 'type_names')), 'One update with --recipe_names (the suffix) and a declared --type_names'),
    check('readback', resolved('recipe') && resolved('ticket_type'),
      'Read the ticket back and verify the resolved recipe and type'),
  ];
}
