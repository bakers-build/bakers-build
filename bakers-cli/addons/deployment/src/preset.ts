// BB-224 (Finding 7): the deployment addon self-declares its COMMAND
// contribution via `./preset`. Light (no runtime import, and deliberately no
// `@bakers-build/conductor` import): the host runs this `commands` accumulator at boot
// to list `bakers deployment` in `--help`, importing the command module (which
// pulls the conductor config loader) only when the subcommand is dispatched.
import type { BbPreset } from '@bakers-build/core';

export const commands: BbPreset['commands'] = (acc) => [
  ...acc,
  {
    name: 'deployment',
    plugin: '@bakers-build/addon-deployment',
    describe: 'release / deployment helpers',
  },
];
