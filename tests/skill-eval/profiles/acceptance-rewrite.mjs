import { check } from '../outtake-checks.mjs';
import { nonempty, requireValue } from '../validation.mjs';

// The acceptance gate rewrites a defective criterion, keeps its previous wording and tallies honestly.
export function validate(f) {
  const e = f.expect;
  requireValue(f.skill === 'bb-workflow/references/acceptance.md' && Array.isArray(f.input.criteria), 'Expected acceptance criteria');
  requireValue(nonempty(e?.rewritten) && nonempty(e.previous) && Array.isArray(e.kept) &&
    f.input.criteria.some(c => c.id === e.rewritten && c.text === e.previous), 'Expected the rewritten criterion and its wording');
}

export function checkOutput(f, output) {
  const e = f.expect;
  const kept = f.input.criteria.filter(c => e.kept.includes(c.id));
  // "2 passed, 1 rewritten", "Passed: 2 … Rewritten: 1", or one count per line; "AC-2 rewritten" is no count.
  const count = word => Number(output.match(new RegExp(`(?<![\\w-])(\\d+)\\s+${word}|${word}[^\\d\\n]{0,12}?(?<![\\w-])(\\d+)`, 'i'))?.slice(1).find(Boolean));
  const rewritten = count('rewritten'), passed = count('passed');
  return [
    check('previous-wording', output.includes(e.previous), 'Report the rewritten criterion\'s previous wording verbatim'),
    check('rewritten-id', output.split('\n').some(line => line.includes(e.rewritten) && !line.includes(e.previous) && line.length > e.rewritten.length + 20),
      'The rewritten criterion keeps its ID with new wording'),
    check('kept-verbatim', kept.every(c => output.includes(c.text)), 'Passing criteria keep their wording exactly'),
    check('tally', rewritten === 1 && passed >= kept.length, 'The gate reports its passed/rewritten tally: one rewritten'),
  ];
}
