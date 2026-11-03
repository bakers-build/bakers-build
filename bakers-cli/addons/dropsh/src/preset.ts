// Keep command discovery light; the runtime loads only on dispatch.
import type { BbPreset } from '@bakers-build/core';

export const commands: BbPreset['commands'] = (acc) => [
  ...acc,
  {
    name: 'dropsh',
    hidden: true,
    plugin: '@bakers-build/addon-dropsh',
    describe:
      'JSON:API shell (dropsh) bound to the bakers.build connection config',
  },
  {
    name: 'tools',
    plugin: '@bakers-build/addon-dropsh',
    export: 'toolsCommandPlugin',
    forwardHelp: true,
    describe: 'discover, inspect and execute named tools',
  },
  {
    name: 'auth',
    plugin: '@bakers-build/addon-dropsh',
    export: 'authCommandPlugin',
    forwardHelp: true,
    describe: 'manage connection authentication and profiles',
  },
  {
    name: 'hook',
    plugin: '@bakers-build/addon-dropsh',
    export: 'hookCommandPlugin',
    describe: 'agent hooks for conductor runs',
  },
];
