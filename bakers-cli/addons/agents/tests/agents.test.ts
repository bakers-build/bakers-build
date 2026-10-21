import type { AgentCandidate } from '@bakers-build/conductor/contract';
import { describe, expect, it } from 'vitest';
import { agentReport } from '../src/agents.js';

const candidate = (alias?: string): AgentCandidate => ({
  alias,
  description: 'Implementation',
  model: 'model-test',
  agent: {
    kind: 'agent',
    id: 'test-harness',
    requiredModules: [],
    createAgent: async () => {
      throw new Error('Catalog must not construct agents');
    },
  },
});

describe('agent catalog report', () => {
  it('projects the normalized effective policy without retired keys', () => {
    const report = agentReport({
      agents: [candidate('fast')],
      enabled_agents: ['fast'],
      disabled_agents: ['careful'],
      default_agent: 'fast',
      routes: {
        default: { '*': 'fast' },
        cheap: { '*': 'fast', review: 'careful' },
      },
    });
    expect(report).toEqual({
      agents: [
        {
          alias: 'fast',
          description: 'Implementation',
          harness: 'test-harness',
          model: 'model-test',
        },
      ],
      enabled_agents: ['fast'],
      disabled_agents: ['careful'],
      default_agent: 'fast',
      routes: {
        default: { '*': 'fast' },
        cheap: { '*': 'fast', review: 'careful' },
      },
    });
    expect(report).not.toHaveProperty('agent');
    expect(report).not.toHaveProperty('agent_routes');
  });

  it('reports a zero-config inferred default and synthesized default route', () => {
    expect(
      agentReport({
        agents: [candidate('local')],
        enabled_agents: ['local'],
        disabled_agents: [],
        default_agent: 'local',
        routes: { default: { '*': 'local' } },
      }),
    ).toMatchObject({
      enabled_agents: ['local'],
      disabled_agents: [],
      default_agent: 'local',
      routes: { default: { '*': 'local' } },
    });
  });
});
