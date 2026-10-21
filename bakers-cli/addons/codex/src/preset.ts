import type { Preset } from '@bakers-build/conductor/contract';
import codexAgent, { type CodexAgentOptions } from './index.js';

export const agents: Preset<Partial<CodexAgentOptions> | undefined>['agents'] =
  (acc, opts) => {
    const model = opts?.model;
    const candidates = [
      ...acc,
      {
        alias: 'codex',
        description:
          'Implementation and debugging with the locally configured Codex model.',
        ...(model !== undefined ? { model } : {}),
        agent: codexAgent(opts),
      },
    ];
    if (model !== undefined) return candidates;
    return [
      ...candidates,
      ...[
        {
          alias: 'astra',
          model: 'gpt-6-astra',
          description:
            'Strong reasoning for complex design, difficult debugging and demanding implementation.',
        },
        {
          alias: 'sol',
          model: 'gpt-5.6-sol',
          description:
            'Reliable implementation and routine maintenance from a clear plan.',
        },
        {
          alias: 'terra',
          model: 'gpt-5.6-terra',
          description:
            'Balanced reasoning and implementation for everyday coding work.',
        },
        {
          alias: 'luna',
          model: 'gpt-5.6-luna',
          description:
            'Fast, economical implementation of small, well-specified changes.',
        },
      ].map((variant) => ({
        ...variant,
        agent: codexAgent({ ...opts, model: variant.model }),
      })),
    ];
  };

// Agents are per machine: list this addon in ~/.bakers/machine.config.js addons[].
export const scopes: Preset['scopes'] = ['machine'];
