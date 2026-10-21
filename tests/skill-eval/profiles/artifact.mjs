import { check } from '../outtake-checks.mjs';
export function validate() {}
export const checkOutput = (_fixture, output) => [check('nonempty-artifact', output.trim(), 'Worker returned an artifact')];
