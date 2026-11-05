# Workflows and states

**Every ticket follows one workflow. Each state has a clear job and one state file.**

Every work ticket follows the workflow `bb_work`. In every state except `done` and `cancelled`, the ticket's conductor may start a run. `done` and `cancelled` are final: follow-up work gets a new ticket. Any open ticket can be cancelled. The kind of work is [ticket data](#ticket-type-recipe-and-labels), not a workflow. Each state runs its state file in `bb-workflow`, phase by phase; the ticket's [recipe](/configuration/workflows/types-recipes-labels#recipes) supplies the method inside it.

## bb_work

| State | Method | What happens | Next |
|---|---|---|---|
| `qualification` | `bb-workflow`, plus the recipe's qualification slot | prior-art search, criteria, recipe and ticket type; you confirm | `plan`, or `working` |
| `plan` | the ticket's recipe | publishes `spec`, `plan`, `test`, or for a bug reproduces the defect, names the cause and plans the regression test; you approve one scope | `working` |
| `working` | the ticket's recipe | builds in the worktree, runs checks, opens the merge request; you confirm | `review` or `done` |
| `review` | the ticket's recipe, in a `bb-verdict` subagent | independent `OK` or `Not OK`; `OK` merges once you authorize | `done`, or `working` |

The transitions:

| Transition | From | To |
|---|---|---|
| `qualify` | `qualification` | `plan` |
| `requalify` | `plan`, `working` | `qualification` |
| `to_working` | `qualification`, `plan`, `review` | `working` |
| `to_plan` | `working` | `plan` |
| `to_review` | `working` | `review` |
| `finish` | `working`, `review` | `done` |
| `cancel` | every state except `done` and `cancelled` | `cancelled` |

A fully specified intake goes from `qualification` straight to `working`. `requalify` returns to `qualification` when the handoff is missing, stale or contradictory; `to_plan` redoes a missing or wrong plan. Review is optional: `finish` leaves `working` or `review`.

## Ticket type, recipe and labels

A ticket and a ticket template carry three term fields, each from a vocabulary of the ticket's workspace:

| Field | Vocabulary | Values | Example |
|---|---|---|---|
| `ticket_type` | `type` | one | `feature`, `bug`, `chore`, `epic`, `deployment`, `verification` |
| `recipe` | `recipe` | one | a recipe name |
| `labels` | `label` | several | `agent:<alias>`, plain tags |

The field is called `ticket_type` because JSON:API reserves `type`. The type selects the recipe's variant. Workspace contributors and leads manage the terms under the workspace's settings, on the tabs Types, Recipes and Labels; guests may only view them. A term has no page of its own and cannot be deleted. Agents set them by name with [`bakers_ticket_classify`](/configuration/clients/tools).

An epic is a ticket of type `epic`. It groups child tickets, which do the work; the project overview lists epics by type.

## Blockers, parents and branches

Blockers, parents, carrier tickets, the deployment workflows and run states: [Tickets in the terminal](/addons/bakers-ui/tickets#blockers-parents-and-branches).
