import type { Preset } from '@bakers-build/conductor/contract';
import grokAgent, { type GrokAgentOptions } from './index.js';

export const agents: Preset<Partial<GrokAgentOptions> | undefined>['agents'] = (
  acc,
  opts,
) => {
  const model = opts?.model;
  return [
    ...acc,
    {
      alias: 'grok',
      description: 'Reasoning and implementation through Grok Build.',
      ...(model !== undefined ? { model } : {}),
      agent: grokAgent(opts),
    },
  ];
};

// Agents are per machine: list this addon in ~/.bakers/machine.config.js addons[].
export const scopes: Preset['scopes'] = ['machine'];
