import type { ToolDefinition } from '@bakers-build/conductor/contract';

export const DEPLOYMENT_TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  deployment_tickets: {
    description:
      "Compute the release batch from a local git range in this run's worktree. Returns JSON with range, resolved tickets (identifier, uuid, title) and unresolved identifiers, scoped to the run ticket's project. Fetch the refs first through forge_fetch. Read only; no relationship writes.",
    input: {
      type: 'object',
      properties: {
        since: {
          type: 'string',
          description: 'currently deployed git ref (range start)',
        },
        to: {
          type: 'string',
          description: 'frozen candidate git ref or SHA (range end)',
        },
      },
      required: ['since', 'to'],
    },
  },
};
