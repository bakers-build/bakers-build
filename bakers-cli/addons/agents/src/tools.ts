import type { ToolHandler, ToolHost } from '@bakers-build/conductor/contract';
import { catalogReport } from './agents.js';

export function handlersFor(
  _options?: unknown,
  host?: ToolHost,
): Record<string, ToolHandler> {
  if (!host) throw new Error('agents_catalog requires a conductor tool host');
  return {
    agents_catalog: async () => ({
      text: JSON.stringify(catalogReport(host.agentCatalog()), null, 2),
    }),
  };
}
