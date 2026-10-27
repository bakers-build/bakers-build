import { check } from '../outtake-checks.mjs';
import { nonempty, requireValue } from '../validation.mjs';

export function validate(fixture) {
  const i = fixture.input;
  requireValue(fixture.skill === 'bb-workflow/references/provision.md' && Array.isArray(i.test_as) && i.test_as.length === 1 &&
    nonempty(i.test_as[0].persona) && nonempty(i.test_as[0].sees) && nonempty(i.ticket) && nonempty(i.task) &&
    nonempty(i.project_adapter) && nonempty(i.revision) && Array.isArray(i.observations) &&
    i.observations.length > 0 && i.observations.every(nonempty), 'Expected missing-account input and one test_as persona');
  const url = new URL(i.environment);
  requireValue(url.protocol === 'https:' && url.hostname.endsWith('.invalid'), 'Expected a synthetic HTTPS environment');
}

export function checkOutput(fixture, output) {
  const i = fixture.input;
  const role = i.test_as[0].persona.toLowerCase();
  const words = output.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const urls = output.match(/https?:\/\/[^\s<>()[\]`"']+/g) ?? [];
  return [
    check('nonempty-artifact', output.trim(), 'Worker returned an artifact'),
    check('required-role', words.join(' ').includes(role) && (role.includes(' ') || words.includes(role)),
      'The required role remains visible; access status is assessed by the semantic rubric'),
    check('environment-retained', output.includes(i.environment), 'The supplied environment remains visible'),
    check('no-invented-url', urls.every(url => url.replace(/[.,;]+$/, '') === i.environment),
      'No login or other URL was supplied; only the known environment URL may appear'),
  ];
}
