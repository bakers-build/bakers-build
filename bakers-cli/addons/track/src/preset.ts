import type { BbPreset } from '@bakers-build/core';

export const commands: BbPreset['commands'] = (acc) => [
  ...acc,
  {
    name: 'track',
    plugin: '@bakers-build/addon-track',
    describe: 'read personal daily evidence for time preparation',
  },
];
