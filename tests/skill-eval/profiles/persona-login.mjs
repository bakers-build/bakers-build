import { check } from '../outtake-checks.mjs';
import { nonempty, requireValue } from '../validation.mjs';

// The runtime guide hands each persona its issued login, reports a missing one, and never uses an admin.
export function validate(f) {
  requireValue(f.skill === 'bb-runtime-ddev' && Array.isArray(f.input.test_as) && f.input.test_as.length === 2, 'Expected two test_as personas');
  requireValue(nonempty(f.expect?.login) && f.input.observations.some(o => o.includes(f.expect.login)) &&
    f.input.test_as.some(p => p.persona === f.expect.missing), 'Expected the issued link and the missing persona');
}

export function checkOutput(f, output) {
  const e = f.expect;
  const urls = output.match(/https?:\/\/[^\s<>()`"'\]]+/g) ?? [];
  const logins = urls.filter(u => /\/user\/reset\//.test(u));
  return [
    check('issued-link', output.split(e.login).length === 2 && logins.length === 1 && logins[0] === e.login,
      'Show exactly the issued link, unchanged, once — and no other login link'),
    check('missing-persona', output.split('\n').some(line => line.includes(e.missing) && /missing/i.test(line)),
      'Report the persona that does not exist as missing'),
    check('no-admin-login', !/uli\b[^\n]*(?:--uid[ =]1\b|--name[ =]admin\b)/.test(output) && !/\/user\/reset\/1\//.test(output),
      'Issue no administrator login; refusal text is allowed'),
  ];
}
