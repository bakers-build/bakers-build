import type { BbPreset } from '@bakers-build/core';

export const commands: BbPreset['commands'] = (acc) => [
  ...acc,
  {
    name: 'agents',
    plugin: '@bakers-build/addon-agents',
    describe: 'print the locally resolved agent catalog as JSON',
  },
];
