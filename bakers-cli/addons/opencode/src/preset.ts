import type { Preset } from '@bakers-build/conductor/contract';
import opencodeAgent, { type OpencodeAgentOptions } from './index.js';

export const agents: Preset<
  Partial<OpencodeAgentOptions> | undefined
>['agents'] = (acc, opts) => {
  const model = opts?.model;
  return [
    ...acc,
    {
      alias: 'opencode',
      description: 'General coding with the locally configured Opencode model.',
      ...(model !== undefined ? { model } : {}),
      agent: opencodeAgent(opts),
    },
  ];
};

// Agents are per machine: list this addon in ~/.bakers/machine.config.js addons[].
export const scopes: Preset['scopes'] = ['machine'];
