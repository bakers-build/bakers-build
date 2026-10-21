import type { Preset } from '@bakers-build/conductor/contract';
import kimiAgent, { type KimiAgentOptions } from './index.js';

export const agents: Preset<Partial<KimiAgentOptions> | undefined>['agents'] = (
  acc,
  opts,
) => {
  const model = opts?.model;
  return [
    ...acc,
    {
      alias: 'kimi',
      description: 'General coding with the locally configured Kimi model.',
      ...(model !== undefined ? { model } : {}),
      agent: kimiAgent(opts),
    },
  ];
};

// Agents are per machine: list this addon in ~/.bakers/machine.config.js addons[].
export const scopes: Preset['scopes'] = ['machine'];
