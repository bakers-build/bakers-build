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
  it('shows the top-level roots protected for nested path selections', () => {
    const report = agentReport({
      agents: [],
      enabled_agents: [],
      disabled_agents: [],
      default_agent: '',
      routes: {},
      sharedRuntime: { project: { read_only: ['scripts/host.sh'] } },
    });
    expect(report.runtime.protected_roots).toEqual(['.bakers', 'scripts']);
  });
  it('reports effective runtime paths and source layers', () => {
    const report = agentReport({
      agents: [],
      enabled_agents: [],
      disabled_agents: [],
      default_agent: '',
      routes: {},
      sharedRuntime: { default: { read_only: ['.ddev'] } },
    });
    expect(report.runtime.read_only).toEqual([
      { value: '.bakers', source: 'builtin' },
      { value: '.ddev', source: 'default' },
    ]);
  });
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
      runtime: {
        read_only: [{ value: '.bakers', source: 'builtin' }],
        protected_roots: ['.bakers'],
        removed: [],
      },
      agents: [
        {
          alias: 'fast',
          description: 'Implementation',
          harness: 'test-harness',
          model: 'model-test',
          permissions: null,
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

  it('shows the effective run security of every alias with its source layers', () => {
    const security = {
      mode: { value: 'sandbox', source: 'default' },
      sandbox: {
        deny_read: { entries: [], removed: [] },
        allow_write: { entries: [], removed: [] },
        trusted_commands: {
          entries: [{ value: 'make', source: 'project' }],
          removed: ['bakers', 'git'],
        },
      },
      not_applied: [],
    } as const;
    const withSecurity = candidate('fast');
    const report = agentReport({
      agents: [
        {
          ...withSecurity,
          agent: { ...withSecurity.agent, permissions: security },
        },
      ],
      enabled_agents: ['fast'],
      disabled_agents: [],
      default_agent: 'fast',
      routes: { default: { '*': 'fast' } },
    });
    expect(report.agents[0]?.permissions).toEqual(security);
  });
});
