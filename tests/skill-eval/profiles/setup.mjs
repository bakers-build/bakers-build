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
  if (fixture.input.no_writes) checks.push({ id: 'no-writes', met: JSON.stringify(saved.files) === JSON.stringify(fixture.input.preserved_files), reason: 'Cancelled or unresolved setup must not create or change files' });
  if (fixture.input.no_questions) checks.push({ id: 'known-answers-reused', met: !saved.turns.some(turn => turn.role === 'assistant' && turn.content?.type === 'question'), reason: 'Explicit supplied scope, path and label must not be asked again' });
  return checks;
}
