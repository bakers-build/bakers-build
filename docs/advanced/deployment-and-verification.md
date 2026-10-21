---
title: Deployment and verification workflows
description: The bb_deployment and bb_verification workflows, and how blockers, parents and carrier tickets shape dispatch and branches.
---

# Deployment and verification workflows

The everyday workflows are on [Workflows and states](/skills-and-workflows/workflows-and-states). This page holds the two operational workflows and the ticket relations that steer dispatch and branches.

## bb_deployment

A person creates it with the target environment set.

| State | Owner | What happens | Next |
|---|---|---|---|
| `pre_deployment` | `prepare-deployment` | needs a green pipeline, freezes or promotes the release branch, merges onto the environment, records the delivered tickets | `post_deployment` |
| `post_deployment` | `post-deployment` | waits for a successful deploy and a passing health check, stamps the environment on the delivered tickets; otherwise stays | `done` |

## bb_verification

| State | Owner | What happens | Next |
|---|---|---|---|
| `verifying` | `verify-on-environment` | re-verifies the subject and its linked tickets on the environment; files a `bb_bug` per failed check | `summary` |
| `summary` | `summarize-verification` | publishes the pass or fail per ticket; you confirm closing | `done` |

## Blockers, parents and branches

- **Blocked by.** A ticket is not dispatched while any ticket in `blocked_by` is open.
- **Parent.** A sub-ticket's base branch is its parent's branch; otherwise it is the project's default branch. It is computed, never set.
- **Carrier ticket.** To base several tickets on a long-lived branch, create one ticket whose `branch_name` is that branch (writable only at creation) and hang the real tickets under it.

