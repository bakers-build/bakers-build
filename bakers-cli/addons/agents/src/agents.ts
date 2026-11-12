import type { ConductorEngineConfig } from '@bakers-build/conductor/contract';
import { resolveRuntimeOptions } from '@bakers-build/conductor/contract';

/** Report the already-resolved catalog; no agent launch or connection I/O. */
export function agentReport(
  config: Pick<
    ConductorEngineConfig,
    | 'agents'
    | 'enabled_agents'
    | 'disabled_agents'
    | 'default_agent'
    | 'routes'
    | 'runtime'
    | 'sharedRuntime'
  >,
) {
  const runtime =
    config.runtime?.readOnly ??
    resolveRuntimeOptions({ shared_runtime: config.sharedRuntime });
  return {
    runtime: {
      read_only: [{ value: '.bakers', source: 'builtin' }, ...runtime.entries],
      protected_roots: [
        ...new Set([
          '.bakers',
          ...runtime.entries.map((entry) => entry.value.split('/')[0]),
        ]),
      ],
      removed: runtime.removed,
    },
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
