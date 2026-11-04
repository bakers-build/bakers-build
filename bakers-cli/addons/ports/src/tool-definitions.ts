// The ports tools' definitions, apart from their handlers so the preset
// stays import-light (the handlers load lazily).

import type { ToolDefinition } from '@bakers-build/conductor/contract';

const service = {
  type: 'string',
  description: 'a service key this worktree claims (see ports_status)',
} as const;

export const PORTS_TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  ports_up: {
    description:
      "Share one of this worktree's claimed services over the tunnel and return its URL; every eligible service when `service` is omitted.",
    input: { type: 'object', properties: { service } },
  },
  ports_down: {
    description:
      "Take a claimed service's tunnel down; every tunnel of this worktree when `service` is omitted.",
    input: { type: 'object', properties: { service } },
  },
  ports_status: {
    description:
      "This worktree's tunnels as JSON rows: service, status, local origin, URL.",
  },
  ports_reap: {
    description:
      'Reconcile the tunnel records: drop routes whose worktree or service is gone.',
  },
};
