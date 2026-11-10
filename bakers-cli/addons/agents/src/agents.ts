import type { ConductorEngineConfig } from '@bakers-build/conductor/contract';

/** Report the already-resolved catalog; no agent launch or connection I/O. */
export function agentReport(
  config: Pick<
    ConductorEngineConfig,
    'agents' | 'enabled_agents' | 'disabled_agents' | 'default_agent' | 'routes'
  >,
) {
  return {
    agents: config.agents.map((c) => ({
      alias: c.alias,
      description: c.description ?? '',
      harness: c.agent.id,
      model: c.model ?? null,
      permissions: c.agent.permissions ?? null,
    })),
    enabled_agents: config.enabled_agents,
    disabled_agents: config.disabled_agents,
    default_agent: config.default_agent,
    routes: config.routes,
  };
}
