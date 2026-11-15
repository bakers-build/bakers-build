# Workflow reference

**Every ticket follows one workflow. Each state has a clear job and one state file.**

Every work ticket follows the workflow `bb_work`. In every state except `done` and `cancelled`, the ticket's conductor may start a run. `done` and `cancelled` are final: follow-up work gets a new ticket. Any open ticket can be cancelled. Each state runs its state file in `bb-workflow`, phase by phase; the ticket's [recipe](/skills-and-workflows/recipes) supplies the method inside it.

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

## How a run works

One run handles one state. The conductor prepares the ticket's workspace and starts the agent. The agent reads `bb-workflow`, the ticket's context, its recipe and the project's hints. Each state runs the same seven phases:

| Phase | Purpose |
|---|---|
| read | Recover context and check entry requirements |
| provision | Prepare the environment needed for checks |
| work | Apply the recipe's method |
| validate | Check the result against the criteria and project rules |
| deliver | Commit, push and prepare the merge request as required |
| outtake | Publish evidence, a summary and review instructions |
| transition | Apply the gate before moving the ticket |

The state file always runs. Recipe slots add the method; `WORKFLOW.md` adds project hints at the matching phases. A handoff records the result, but does not itself authorize a transition. [Collaboration labels](/skills-and-workflows/collaboration) determine which gates still wait for a person.

## What stays fixed

The server owns the states and allowed transitions. The `bb-workflow` frame owns routing, approval gates, verdicts and readbacks. Recipes and project hints work within those boundaries. Changing the states requires a change to bakers.build itself.

**Example:** adding `## bb-state-security` to a recipe does not create a security-review state. Instead, put the security check in the existing review method, or require a security check in the project's validation rules.

**Verify:** the ticket still uses the existing states. Its review handoff or validation results must contain the added security evidence; a new Markdown heading alone is not evidence of a new workflow state.

## Ticket fields

`recipe` selects the method; `ticket_type` selects a variant supported by that method; `labels` select collaboration behavior, an agent, or ordinary tags. An epic groups child tickets and is a type, not a separate workflow. [Choose a method](/skills-and-workflows/recipes) owns recipe selection; [Agents](/agents/guide) owns agent selection.

Workspace contributors and leads manage the Types, Recipes and Labels vocabularies in workspace settings; guests may view them. Each ticket has one type, one recipe and multiple labels. The API calls the field `ticket_type` because JSON:API reserves `type`.

## Blockers, parents and branches

Blockers, parents, carrier tickets, the deployment workflows and run states: [Tickets in the terminal](/addons/bakers-ui/tickets#blockers-parents-and-branches).
