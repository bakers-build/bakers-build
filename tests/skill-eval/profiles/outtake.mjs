import { outtakeChecks } from '../outtake-checks.mjs';
import { requireValue } from '../validation.mjs';
export function validate(fixture) {
  requireValue(fixture.skill === 'run-outtake', 'Outtake profile requires run-outtake');
}
export const checkOutput = (_fixture, output) => outtakeChecks(output);
