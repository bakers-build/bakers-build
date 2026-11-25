import { requireValue } from '../validation.mjs';

export function validate(fixture) {
  requireValue(fixture.profile === 'setup' && fixture.input?.expected_files && fixture.input?.preserved_files,
    'Setup replay needs independent file expectations and preserved files');
}

export function checkOutput(fixture, output) {
  const saved = JSON.parse(output);
  requireValue(saved && typeof saved.files === 'object' && Array.isArray(saved.turns) && Array.isArray(saved.tools),
    'Malformed saved setup conversation');
  const checks = [{ id: 'conversation-ended', met: saved.status === 'completed', reason: 'Conversation must reach an explicit final report; this does not assert setup readiness' }];
  for (const [path, fragments] of Object.entries(fixture.input.expected_files)) {
    requireValue(Array.isArray(fragments) && fragments.every(value => typeof value === 'string'), 'Expected file fragments');
    checks.push({ id: `file-${checks.length}`, met: typeof saved.files[path] === 'string' && fragments.every(value => saved.files[path].includes(value)), reason: `Saved ${path} must contain the independent expected values` });
  }
  for (const [path, content] of Object.entries(fixture.input.preserved_files)) {
    checks.push({ id: `preserved-${checks.length}`, met: saved.files[path] === content, reason: `${path} must remain unchanged` });
  }
  for (const [path, fragments] of Object.entries(fixture.input.forbidden_fragments ?? {})) {
    requireValue(Array.isArray(fragments) && fragments.every(value => typeof value === 'string'), 'Forbidden file fragments');
    checks.push({ id: `scope-${path}`, met: fragments.every(value => !(saved.files[path] ?? '').includes(value)), reason: `${path} must not contain settings owned by another scope` });
  }
  // The bounded writer accepts JSON data only; parse it without executing config code.
  // A file the CLI wrote as non-JSON JavaScript parses to undefined here, so each of its field checks fails.
  for (const [path, fields] of Object.entries(fixture.input.expected_config ?? {})) {
    let config;
    try { config = JSON.parse(saved.files[path]?.match(/^\s*export default\s+(\{[\s\S]*\})\s*;?\s*$/)?.[1]); }
    catch { config = undefined; }
    for (const [field, expected] of Object.entries(fields)) {
      const actual = field.split('.').reduce((value, key) => value?.[key], config);
      checks.push({ id: `config-${path}:${field}`, met: JSON.stringify(actual) === JSON.stringify(expected), reason: `${path}: ${field} must equal ${JSON.stringify(expected)} in saved data` });
    }
  }
  const questions = saved.turns.filter(turn => turn.role === 'assistant' && turn.content?.type === 'question').map(turn => turn.content.text);
  if (fixture.input.max_questions !== undefined) checks.push({ id: 'max-questions', met: questions.length <= fixture.input.max_questions,
    reason: `At most ${fixture.input.max_questions} questions (one per block plus each own decision); asked ${questions.length}` });
  // Preview lines read `key: value — source`; a leading list marker or code quotes are allowed.
  const previewLines = questions.flatMap(text => text.split('\n')).map(line => line.replace(/^[\s>*-]*/, '').replaceAll('`', ''))
    .filter(line => /^[^:\s][^:]*: .* — /.test(line));
  for (const source of fixture.input.derived_sources ?? []) {
    checks.push({ id: `derived-source-${source}`, met: previewLines.some(line => line.split(' — ').slice(1).join(' — ').includes(source)), reason: `A block preview must name the derived value's source \`${source}\` on its value's line` });
  }
  for (const key of fixture.input.previewed_keys ?? []) {
    checks.push({ id: `previewed-${key}`, met: previewLines.some(line => line.split(':')[0].trim().endsWith(key)), reason: `The block preview must name \`${key}\` as its own \`key: value — source\` line; an omitted value stays unresolved` });
  }
  for (const key of fixture.input.asked_values ?? []) {
    checks.push({ id: `asked-${key}`, met: questions.some(text => text.includes(`${key}: ?`)), reason: `Missing or ambiguous evidence leaves \`${key}\` open in the preview (\`${key}: ? — asked\`), never guessed` });
  }
  if (fixture.input.max_doc_loads !== undefined) {
    const page = /^(docs\/.*|https:\/\/bakers\.build\/.*)\.md(#.*)?$/;
    const loads = saved.tools.filter(({ action }) => action?.type === 'read' ? page.test(action.path)
      : action?.type === 'command' && action.argv.some(value => page.test(value))).length;
    checks.push({ id: 'max-doc-loads', met: loads <= fixture.input.max_doc_loads,
      reason: `At most ${fixture.input.max_doc_loads} documentation page loads per setup; loaded ${loads}` });
  }
  const commands = saved.tools.filter(({ action }) => action?.type === 'command').map(({ action }) => action.argv);
  for (const words of fixture.input.forbidden_commands ?? []) {
    const pattern = new RegExp(`(^| )${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
    checks.push({ id: `forbidden-${words}`, met: !commands.some(argv => pattern.test(argv.join(' '))), reason: `No command may run \`${words}\`` });
  }
  const final = saved.turns.findLast(turn => turn.role === 'assistant' && turn.content?.type === 'final')?.content.text ?? '';
  for (const fragment of fixture.input.final_fragments ?? []) {
    checks.push({ id: `final-${fragment}`, met: final.includes(fragment), reason: `The final report must contain \`${fragment}\`` });
  }
  if (fixture.input.min_questions !== undefined) checks.push({ id: 'min-questions', met: questions.length >= fixture.input.min_questions,
    reason: `At least ${fixture.input.min_questions} questions; asked ${questions.length}` });
  if (fixture.input.tool_sequence) {
    // Each step is the next `bakers tools <tool>` call; its argv names every fragment, and no other step's.
    const calls = commands.filter(argv => argv[0] === 'bakers' && argv[1] === 'tools').map(argv => ({ tool: argv[2], text: argv.slice(3).join(' ') }));
    const steps = fixture.input.tool_sequence;
    const others = step => steps.filter(other => other.tool === step.tool && other !== step).flatMap(other => other.fragments.filter(f => !step.fragments.includes(f)));
    let index = 0;
    for (const call of calls) {
      const step = steps[index];
      if (step && call.tool === step.tool && step.fragments.every(f => call.text.includes(f)) && !others(step).some(f => call.text.includes(f))) index += 1;
    }
    checks.push({ id: 'tool-sequence', met: index === steps.length, reason: `Tool calls in order: ${steps.map(step => `${step.tool}(${step.fragments.join(', ')})`).join(' → ')}` });
  }
  if (fixture.input.no_writes) checks.push({ id: 'no-writes', met: Object.keys(saved.files).length === Object.keys(fixture.input.preserved_files).length &&
    Object.entries(saved.files).every(([path, content]) => fixture.input.preserved_files[path] === content), reason: 'Cancelled or unresolved setup must not create or change files' });
  if (fixture.input.no_questions) checks.push({ id: 'known-answers-reused', met: !saved.turns.some(turn => turn.role === 'assistant' && turn.content?.type === 'question'), reason: 'Explicit supplied scope, path and label must not be asked again' });
  return checks;
}
