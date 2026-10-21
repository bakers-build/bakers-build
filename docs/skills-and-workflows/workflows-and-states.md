# Workflows and states

**Every ticket follows one workflow. Each state has a clear job and a clear owner.**

In every state except `done` and `cancelled`, the ticket's conductor may start a run (an epic is the exception). `done` and `cancelled` are final: follow-up work gets a new ticket. Any open ticket can be cancelled. The owners below are those for `work:code`; `work:docs` uses `docs-authoring` for spec, diagnose, coding and review.

## bb_feature

| State | Owner | What happens | Next |
|---|---|---|---|
| `qualification` | `qualify-ticket` | prior-art search, criteria, classification, `work:*` labels; you confirm | `spec` |
| `spec` | `create-spec` | publishes `spec`, `plan`, `test`; you approve one scope | `coding` |
| `coding` | `ddev-drupal-feature` | builds in the worktree, runs checks, opens the merge request; you confirm | `review` |
| `review` | `ddev-drupal-feature` | independent `OK` or `Not OK`; `OK` merges once you authorize | `done`, or `coding` |

A feature always passes review: only `review` finishes. `requalify` sends `spec` or `coding` back to `qualification` when the handoff is missing, stale or contradictory. A fully specified intake goes from `qualification` straight to `coding`.

## bb_bug

| State | Owner | What happens | Next |
|---|---|---|---|
| `qualification` | `qualify-ticket` | as for a feature | `diagnose` |
| `diagnose` | `ddev-drupal-bug` | reproduces the defect, names the cause, plans the regression test; you approve | `coding` |
| `coding` | `ddev-drupal-bug` | fixes, runs checks, opens the merge request; you confirm | `review` or `done` |
| `review` | `ddev-drupal-bug` | as for a feature | `done`, or `coding` |

Review is optional: `finish` leaves `coding` through the merge gate. `to_diagnose` returns `coding` to `diagnose` when the diagnosis itself failed.

## bb_chore

| State | Owner | What happens | Next |
|---|---|---|---|
| `qualification` | `qualify-ticket` | as for a feature | `spec` |
| `spec` | `create-spec` | as for a feature | `coding` |
| `coding` | `ddev-drupal-feature` | as for a feature | `review` or `done` |
| `review` | `ddev-drupal-feature` | as for a feature | `done`, or `coding` |

Review is optional, as for a bug.

## bb_epic

An epic groups child tickets and does no work itself: no state starts a run. It moves `qualification` → `spec` → `active` → `review` → `done` as people move it; the children do the work on their own tickets.

## Deployment, verification and ticket relations

Deployment and verification tickets, blockers, parents and carrier branches: [Deployment and verification workflows](/advanced/deployment-and-verification).

Run states are on [Tickets in the terminal](/advanced/cli/tickets-in-the-terminal#runs).
