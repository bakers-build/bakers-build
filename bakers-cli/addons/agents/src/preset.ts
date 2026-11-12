import type { AddonTools } from '@bakers-build/conductor/contract';
import type { BbPreset } from '@bakers-build/core';

export const scopes: BbPreset['scopes'] = ['machine', 'project'];

export const tools: AddonTools = {
  contract: 1,
  tools: {
    agents_catalog: {
      description:
        'Report the conductor’s loaded agent catalog and routes without permissions, configuration reload or agent launch.',
    },
  },
  handlers: (options, host) =>
    import('./tools.js').then((m) => m.handlersFor(options, host)),
};

export const commands: BbPreset['commands'] = (acc) => [
  ...acc,
  {
    name: 'agents',
    plugin: '@bakers-build/addon-agents',
    describe: 'print the locally resolved agent catalog as JSON',
  },
];
