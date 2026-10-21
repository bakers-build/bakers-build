import type { BbPreset } from '@bakers-build/core';

export const commands: BbPreset['commands'] = (acc) => [
  ...acc,
  {
    name: 'info',
    plugin: '@bakers-build/addon-info',
    describe: 'print the resolved project and workspace context as JSON',
  },
];
