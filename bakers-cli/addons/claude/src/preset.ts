import type { Preset } from '@bakers-build/conductor/contract';
import claudeAgent, { type ClaudeAgentOptions } from './index.js';

export const agents: Preset<ClaudeAgentOptions | undefined>['agents'] = (
  acc,
  opts,
) => {
  if (opts?.model) {
    return [
      ...acc,
      {
        agent: claudeAgent(opts),
        model: opts.model,
        description:
          'Custom Claude variant; suitability depends on the configured model.',
      },
    ];
  }
  return [
    ...acc,
    {
      alias: 'opus',
      description:
        'Strong reasoning for ambiguous design, diagnosis and demanding implementation.',
      model: 'opus',
    },
    {
      alias: 'sonnet',
      description:
        'Efficient implementation of well-specified changes and routine maintenance.',
      model: 'sonnet',
    },
    {
      alias: 'fable',
      description: 'Demanding problems and long-running autonomous work.',
      model: 'fable',
    },
  ].map((candidate) =>
    'agent' in candidate
      ? candidate
      : {
          ...candidate,
          agent: claudeAgent({ ...opts, model: candidate.model }),
        },
  );
};

// Agents are per machine: list this addon in ~/.bakers/machine.config.js addons[].
export const scopes: Preset['scopes'] = ['machine'];
