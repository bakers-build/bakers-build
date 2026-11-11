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
  for (const [path, fields] of Object.entries(fixture.input.expected_config ?? {})) {
    let config;
    try { config = JSON.parse(saved.files[path]?.match(/^\s*export default\s+(\{[\s\S]*\})\s*;?\s*$/)?.[1]); }
    catch { config = undefined; }
    for (const [field, expected] of Object.entries(fields)) {
      const actual = field.split('.').reduce((value, key) => value?.[key], config);
      checks.push({ id: `config-${path}:${field}`, met: JSON.stringify(actual) === JSON.stringify(expected), reason: `${path}: ${field} must equal ${JSON.stringify(expected)} in saved data` });
    }
  }
  if (fixture.input.no_writes) checks.push({ id: 'no-writes', met: JSON.stringify(saved.files) === JSON.stringify(fixture.input.preserved_files), reason: 'Cancelled or unresolved setup must not create or change files' });
  if (fixture.input.no_questions) checks.push({ id: 'known-answers-reused', met: !saved.turns.some(turn => turn.role === 'assistant' && turn.content?.type === 'question'), reason: 'Explicit supplied scope, path and label must not be asked again' });
  return checks;
}
