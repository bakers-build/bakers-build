import { criterionRows, outtakeChecks } from '../outtake-checks.mjs';
import { requireValue } from '../validation.mjs';
export function validate(fixture) {
  requireValue(fixture.skill === 'bb-workflow/references/outtake.md', 'Outtake profile requires the outtake reference');
}
export const checkOutput = (fixture, output) =>
  outtakeChecks(output, fixture.input.state === 'working' ? criterionRows(fixture.input) : undefined);
