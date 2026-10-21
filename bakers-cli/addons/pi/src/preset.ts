import type { Preset } from '@bakers-build/conductor/contract';
import piAgent, { type PiAgentOptions } from './index.js';

export const agents: Preset<Partial<PiAgentOptions> | undefined>['agents'] = (
  acc,
  opts,
) => {
  const model = opts?.model;
  return [
    ...acc,
    {
      alias: 'pi',
      description: 'General coding with the locally configured Pi model.',
      ...(model !== undefined ? { model } : {}),
      agent: piAgent(opts),
    },
  ];
};

// Agents are per machine: list this addon in ~/.bakers/machine.config.js addons[].
export const scopes: Preset['scopes'] = ['machine'];
