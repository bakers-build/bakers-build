import { check, criterionRows, outtakeChecks, visibleMarkdown } from '../outtake-checks.mjs';
import { requireValue } from '../validation.mjs';

const KEYS = ['ac_ids', 'question', 'criteria', 'logins', 'mr', 'markers', 'absent', 'problems', 'next_fix', 'missing',
  'not_recorded', 'verdict', 'findings'];
const part = (text, heading) => text.split(new RegExp(`^#{1,6}\\s+${heading}\\s*$`, 'm'))[1]?.split(/^#{1,6}\s/m)[0] ?? '';

// One state's outtake rendered from its handoff: the skeleton plus what this fixture's handoff demands.
export function validate(f) {
  requireValue(f.skill === 'bb-workflow/references/outtake.md' && ['qualification', 'working', 'review'].includes(f.input.state),
    'Expected the outtake reference and a state with a state section');
  requireValue(f.references.includes(`bb-workflow/references/outtake/${f.input.state}.md`), 'Load the state section');
  requireValue(f.expect && Object.keys(f.expect).length > 0 && Object.keys(f.expect).every(k => KEYS.includes(k)), 'Expected known expect keys');
  requireValue(!f.expect.criteria || criterionRows(f.input).length > 0, 'Criterion lines need checks and results');
  requireValue(!f.expect.mr || (f.input.handoff?.mr && f.input.handoff.base && f.input.handoff.head), 'The MR check needs handoff mr, base and head');
}

export function checkOutput(f, output) {
  const e = f.expect, text = visibleMarkdown(output);
  const beforeNext = text.split(/^#{1,6}\s+➡️ Next action\s*$/m)[0];
  const next = part(text, '➡️ Next action');
  const checks = outtakeChecks(output, e.criteria ? criterionRows(f.input) : undefined);
  const add = (id, met, reason) => checks.push(check(id, met, reason));
  if (e.ac_ids) {
    const named = new Set(text.match(/\bAC-\d+\b/g) ?? []);
    add('all-criteria', e.ac_ids.every(id => named.has(id)) && [...named].every(id => e.ac_ids.includes(id)),
      'List every criterion of the handoff and none outside it');
  }
  if (e.question) add('asks-fit', next.includes('?'), 'Next action asks the question the approval answers');
  if (e.logins) add('issued-logins', e.logins.every(url => text.split(url).length === 2), 'Each issued login URL appears unchanged, once');
  if (e.mr) add('mr-link', text.includes(f.input.handoff.mr) && text.includes(f.input.handoff.base.slice(0, 7)) &&
    text.includes(f.input.handoff.head.slice(0, 7)), 'Manual review carries the MR and base → head');
  if (e.missing) add('missing-persona', e.missing.every(p => text.split('\n').some(l => l.includes(p) && /missing/i.test(l))),
    'A missing persona stays listed as missing');
  if (e.markers) add('slot-markers', e.markers.every(m => beforeNext.includes(m)), 'The recipe slot adds its lines before Next action');
  if (e.absent) add('slot-absent', e.absent.every(m => !text.includes(m)), 'No line from a slot that does not apply');
  if (e.not_recorded) add('not-recorded', text.split('\n').some(l => l.includes(e.not_recorded) && /not recorded/i.test(l)),
    'A value the slot asks for that the handoff lacks is shown as not recorded');
  if (e.problems) add('problems', e.problems.every(id => part(text, '⚠️ Problems').includes(id)), 'Failures appear under Problems');
  if (e.next_fix) add('next-fix', /\bfix/i.test(next) && !next.split(/(?<=[.?!])\s+/).some(s => /review/i.test(s) && s.trim().endsWith('?')),
    'Next action is the fix and offers no move to review');
  if (e.verdict) add('verdict', part(text, '🎯 Outcome').includes(e.verdict), 'Outcome names the verdict');
  if (e.findings) add('findings', e.findings.every(loc => text.includes(loc)), 'Every finding appears with its file:line');
  return checks;
}
