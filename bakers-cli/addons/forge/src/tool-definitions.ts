// The forge tools' definitions, apart from their handlers so the preset stays
// import-light. No tool takes a ticket, a base or a target: those come from
// the calling run. The one exception is a promotion target, gated by rules.

import type { ToolDefinition } from '@bakers-build/conductor/contract';

const branch = {
  type: 'string',
  description:
    "an owned branch: the ticket's branch_name (default) or <branch_name>-<suffix>",
} as const;

const sha = { type: 'string', pattern: '^[0-9a-f]{40}$' } as const;

/** base_branch into a stable branch, for a deployment ticket's release. */
const promotion = {
  promote_to: {
    type: 'string',
    description:
      "promote base_branch into this branch (e.g. main) instead of an owned branch; only for a deployment ticket, a target whose merge rule has method 'merge', and with expected_sha",
  },
  expected_sha: {
    ...sha,
    description:
      'with promote_to: the frozen release candidate; refused unless origin/<base_branch> is still at it',
  },
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
        expected_sha: sha,
      },
    },
  },
  forge_pr_upsert: {
    description:
      "Create the PR/MR of an owned branch into its base (base_branch, or the ticket branch for a variant), or update the open one's title and body. With promote_to, the PR/MR is base_branch into that target. The title must be a Conventional Commits subject.",
    input: {
      type: 'object',
      properties: {
        branch,
        ...promotion,
        title: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['title'],
    },
  },
  forge_checks: {
    description:
      "Status of each check or pipeline job, and whether it is required, on the head of an owned branch's PR/MR, of the promotion PR/MR (promote_to), or on any `ref` (branch or SHA); read only, one shot.",
    input: {
      type: 'object',
      properties: {
        branch,
        ...promotion,
        ref: { type: 'string', description: 'any branch or SHA, read only' },
      },
    },
  },
  forge_merge: {
    description:
      "Merge the open PR/MR of an owned branch into its base, once it is conflict free and every required check is green. With promote_to: the base_branch PR/MR into that target, its head at expected_sha, by merge commit, base_branch kept, then the target's second parent verified against expected_sha. Human approval is the workflow's merge gate, not this tool's.",
    input: { type: 'object', properties: { branch, ...promotion } },
  },
};
