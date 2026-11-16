import type { AgentCatalog } from '@bakers-build/conductor/contract';

/** Sandbox-safe catalog; permission entries can contain personal machine paths. */
export function catalogReport(config: AgentCatalog) {
  const report = agentReport(config);
  return {
    ...report,
    agents: report.agents.map(
      ({ permissions: _permissions, ...agent }) => agent,
    ),
  };
}

/**
 * Report the already-resolved catalog; no agent launch or connection I/O.
 * With `isSet`, each agent's declared secrets show `set` or `unset`, never a value.
 */
export function agentReport(
  config: AgentCatalog,
  isSet?: (name: string) => boolean,
) {
  return {
    agents: config.agents.map((c) => ({
      alias: c.alias,
      description: c.description ?? '',
      harness: c.agent.id,
      model: c.model ?? null,
      permissions: c.agent.permissions ?? null,
      ...(isSet && c.agent.secretEnv?.length
        ? {
            secret_env: Object.fromEntries(
              c.agent.secretEnv.map((name) => [
                name,
                isSet(name) ? 'set' : 'unset',
              ]),
            ),
          }
        : {}),
    })),
    enabled_agents: config.enabled_agents,
    disabled_agents: config.disabled_agents,
    default_agent: config.default_agent,
    routes: config.routes,
  };
}
