// BB-215: the conductor support lib self-declares its COMMAND contribution via
// `./preset`. Light (no runtime import): the host runs this `commands`
// accumulator at boot to list `bakers conductor` in `--help`; the heavy engine
// module (`@bakers-build/conductor/commands/conductor`) is imported only when a
// `bakers conductor …` subcommand is actually dispatched. `oven` stays a
// hidden alias so existing scripts run.
import type { Preset } from './plugins/preset.js';

export const commands: Preset['commands'] = (acc) => [
  ...acc,
  {
    name: 'conductor',
    aliases: ['oven'],
    plugin: '@bakers-build/conductor/commands/conductor',
    describe: 'conductor lifecycle + local registry',
  },
];
