// BB-215: the conductor support lib self-declares its COMMAND contribution via
// `./preset`. Light (no runtime import): the host runs this `commands`
// accumulator at boot to list `bakers oven` in `--help`; the heavy engine
// module (`@bakers-build/conductor/commands/conductor`) is imported only when a
// `bakers oven …` subcommand is actually dispatched.
import type { Preset } from './plugins/preset.js';

export const commands: Preset['commands'] = (acc) => [
  ...acc,
  {
    name: 'oven',
    plugin: '@bakers-build/conductor/commands/conductor',
    describe: 'node-agent lifecycle + local registry',
  },
];
