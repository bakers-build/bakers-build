// The forge tools' definitions, apart from their handlers so the preset stays
// import-light. No tool takes a ticket, a base or a target: those come from
// the calling run.

import type { ToolDefinition } from '@bakers-build/conductor/contract';

const branch = {
  type: 'string',
  description:
    "an owned branch: the ticket's branch_name (default) or <branch_name>-<suffix>",
} as const;

export const FORGE_TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  forge_fetch: {
    description:
      "Fetch the ticket's base_branch, its own branch and the named parent branches into refs/remotes/origin/*; read only. Then rebase or merge locally with git.",
    input: {
      type: 'object',
      properties: {
        branches: {
          type: 'string',
          description:
            'further branches to fetch, space-separated, e.g. those of parent-linked tickets',
        },
      },
    },
  },
  forge_push: {
    description:
      "Push an owned branch's local head. Fast-forward only, unless force_with_lease: then the remote must still be at expected_sha (default: refs/remotes/origin/<branch>). Bare force does not exist.",
    input: {
      type: 'object',
      properties: {
        branch,
        force_with_lease: { type: 'boolean' },
        expected_sha: { type: 'string', pattern: '^[0-9a-f]{40}$' },
      },
    },
  },
  forge_pr_upsert: {
    description:
      "Create the PR/MR of an owned branch into its base (base_branch, or the ticket branch for a variant), or update the open one's title and body. The title must be a Conventional Commits subject.",
    input: {
      type: 'object',
      properties: {
        branch,
        title: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['title'],
    },
  },
  forge_checks: {
    description:
      "Status of each check or pipeline job, and whether it is required, on the head of an owned branch's PR/MR, or on any `ref` (branch or SHA); read only, one shot.",
    input: {
      type: 'object',
      properties: {
        branch,
        ref: { type: 'string', description: 'any branch or SHA, read only' },
      },
    },
  },
  forge_merge: {
    description:
      "Merge the open PR/MR of an owned branch into its base, once it is conflict free and every required check is green. Human approval is the workflow's merge gate, not this tool's.",
    input: { type: 'object', properties: { branch } },
  },
};
