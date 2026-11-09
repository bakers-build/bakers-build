# Workflows and states

**Every ticket follows one workflow. Each state has a clear job and one state file.**

Every work ticket follows the workflow `bb_work`. In every state except `done` and `cancelled`, the ticket's conductor may start a run. `done` and `cancelled` are final: follow-up work gets a new ticket. Any open ticket can be cancelled. The kind of work is [ticket data](#ticket-type-recipe-and-labels), not a workflow. Each state runs its state file in `bb-workflow`, phase by phase; the ticket's [recipe](/skills-and-workflows/types-recipes-labels#recipes) supplies the method inside it.

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

A fully specified intake goes from `qualification` straight to `working`. `requalify` returns to `qualification` when required qualification fields are missing; `to_plan` redoes a missing or wrong plan. The server permits `finish` from `working` or `review`, but the selected recipe and authorization still control its use. Matt requires review for features; bugs and chores may skip it only through the merge gate with explicit authorization.

## Ticket type, recipe and labels

[Ticket type, recipe and labels](/skills-and-workflows/types-recipes-labels) owns the field definitions, vocabulary administration and selection rules. An epic groups child tickets; it is a ticket type, not a separate workflow.

## Blockers, parents and branches

Blockers, parents, carrier tickets, the deployment workflows and run states: [Tickets in the terminal](/addons/bakers-ui/tickets#blockers-parents-and-branches).
