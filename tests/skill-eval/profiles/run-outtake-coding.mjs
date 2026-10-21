import { check, visibleMarkdown, outtakeChecks } from '../outtake-checks.mjs';
import { requireValue, nonempty } from '../validation.mjs';
export const SOURCES = ['method-context/references/results.md', 'method-context/SKILL.md', 'essential-skills/SKILL.md'];
export function validate(fixture) {
  const i = fixture?.input;
  requireValue(fixture?.synthetic === true && fixture.skill === 'run-outtake' && i?.state === 'coding',
    'Expected a synthetic run-outtake coding fixture');
  for (const field of ['ticket', 'outcome', 'gate', 'evidence', 'next_action', 'mr', 'revision']) {
    requireValue(nonempty(i[field]), `Missing fixture input.${field}`);
  }
  requireValue(i.gate === 'GREEN' && /^[a-f0-9]{40}$/.test(i.revision), 'Expected GREEN and a synthetic 40-hex revision');
  requireValue(JSON.stringify(fixture.references) === JSON.stringify(SOURCES), 'Fixture must load the maintained outtake references');
  for (const field of ['artifacts', 'acceptance_criteria', 'checks', 'results']) {
    requireValue(Array.isArray(i[field]) && i[field].length > 0, `Missing fixture input.${field}`);
  }
  const acIds = i.acceptance_criteria.map(c => c.id);
  requireValue(new Set(acIds).size === acIds.length, 'Acceptance IDs must be unique');
  for (const ac of i.acceptance_criteria) {
    requireValue(nonempty(ac.id) && nonempty(ac.criterion) && ac.result === 'PASS' && ac.evidence === i.evidence,
      'Every acceptance criterion needs wording, PASS and supplied evidence');
    const check = i.checks.find(c => c.ac_ids?.includes(ac.id));
    const result = i.results.find(r => r.check_id === check?.id);
    requireValue(check && nonempty(check.command_or_steps) && nonempty(check.expected) && result?.status === 'passed' &&
      nonempty(result.observed) && result.revision === i.revision && result.evidence === i.evidence,
    `Missing check/result/evidence triad for ${ac.id}`);
  }
  const review = i.manual_review;
  requireValue(review?.status === 'pending' && nonempty(review.account) && nonempty(review.role) &&
    nonempty(review.environment) && Array.isArray(review.paths) && review.paths.length > 0 &&
    review.paths.every(path => typeof path === 'string' && /^\/(?!\/)/.test(path)),
  'Expected a pending review with account, role, environment and absolute application paths');
  for (const value of [i.mr, i.evidence, review.environment, review.login_url]) {
    const url = new URL(value);
    requireValue(url.protocol === 'https:' && url.hostname.endsWith('.invalid'), 'Fixture URLs must be synthetic absolute HTTPS URLs');
  }
  return fixture;
}

export function checkOutput(fixture, output) {
  const input = fixture.input;
  const review = input.manual_review ?? {};
  const text = visibleMarkdown(output);
  const links = [...text.matchAll(/\[([^\]\n]+)\]\(([^\s]+)\)/g)];
  const standalone = [...text.matchAll(/(?:^|\n\s*\n)🔗\s+([^\n]+)\n(?:\s*\n)?(https?:\/\/[^\s]+)(?=\n\s*\n|\s*$)/g)];
  const urls = text.match(/https?:\/\/[^\s<>()`\[\]]+/g) ?? [];
  const allowed = [input.mr, input.evidence, review.login_url, review.environment,
    ...(review.paths ?? []).map(p => review.environment + p)];
  const common = outtakeChecks(output);
  return [
    ...common.slice(0, 2),
    check('issued-login-url', output.split(review.login_url).length === 2 && urls.filter(url => url === review.login_url).length === 1,
      'The issued one-time login URL must appear unchanged exactly once'),
    check('review-resources', [input.mr, input.evidence].every(url => urls.includes(url)) &&
      (review.paths ?? []).every(path => text.includes(path)),
    'The supplied MR, evidence and supplied review paths must remain available'),
    check('review-actor', text.includes(review.account) && text.toLowerCase().includes(review.role?.toLowerCase()) && urls.some(url => url.startsWith(review.environment)),
      'Review must preserve the supplied account, role and environment'),
    check('links', urls.length > 0 && new Set(urls).size === urls.length && links.every(m => {
      const prefix = text.slice(0, m.index);
      const suffix = text.slice(m.index + m[0].length);
      return allowed.includes(m[2]) &&
        !/https?:\/\//.test(m[1]) && /(?:^|\n\s*\n)🔗\s*$/.test(prefix) && /^(?:\s*\n\s*\n|\s*$)/.test(suffix);
    }) && standalone.every(m => allowed.includes(m[2]) && !/https?:\/\//.test(m[1])) &&
      urls.every(url => links.some(m => m[2] === url) || standalone.some(m => m[2] === url)),
    'Use supplied absolute URLs once, with descriptive labels, 🔗 and blank lines'),
    common.at(-1),
  ];
}
