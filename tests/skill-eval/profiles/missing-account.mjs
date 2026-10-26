import { check } from '../outtake-checks.mjs';
import { nonempty, requireValue } from '../validation.mjs';

export function validate(fixture) {
  const i = fixture.input;
  requireValue(fixture.skill === 'bb-resolve-environment' && nonempty(i.required_actor?.role) &&
    nonempty(i.required_actor.identity_requirement) && nonempty(i.ticket) && nonempty(i.task) &&
    nonempty(i.project_adapter) && nonempty(i.revision) && Array.isArray(i.observations) &&
    i.observations.length > 0 && i.observations.every(nonempty), 'Expected missing-account input and required actor');
  const url = new URL(i.environment);
  requireValue(url.protocol === 'https:' && url.hostname.endsWith('.invalid'), 'Expected a synthetic HTTPS environment');
}

export function checkOutput(fixture, output) {
  const i = fixture.input;
  const role = i.required_actor.role.toLowerCase();
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
