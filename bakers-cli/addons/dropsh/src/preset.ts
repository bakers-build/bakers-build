// BB-215: the dropsh addon self-declares its COMMAND contribution via
// `./preset`. Light (no runtime import): the host runs this `commands`
// accumulator at boot to list `bakers dropsh` in `--help`, importing the dropsh
// command module only when the subcommand is actually dispatched.
import type { BbPreset } from '@bakers-build/core';

export const commands: BbPreset['commands'] = (acc) => [
  ...acc,
  {
    name: 'dropsh',
    plugin: '@bakers-build/addon-dropsh',
    describe:
      'JSON:API shell (dropsh) bound to the bakers.build connection config',
  },
];
