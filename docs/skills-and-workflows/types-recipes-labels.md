# Ticket type, recipe and labels

**Use recipe and type to choose a method for a ticket, then labels for agent selection and optional automation. Origin-label mirroring is configured separately.**

| Field | Set by | Effect |
|---|---|---|
| `recipe` | qualification | the recipe skill that supplies the method for `plan`, `working` and `review`, such as `matt` for `bb-recipe-matt`; empty until qualification chooses |
| `ticket_type` | qualification | `feature`, `bug`, `chore` and so on; selects the recipe's slots for that type |
| `labels` | you, or qualification | agent choice and plain tags, see below |

A ticket and a ticket template carry three term fields, each from a vocabulary of the ticket's workspace:

| Field | Vocabulary | Values | Example |
|---|---|---|---|
| `ticket_type` | `type` | one | `feature`, `bug`, `chore`, `epic`, `deployment`, `verification` |
| `recipe` | `recipe` | one | a recipe name |
| `labels` | `label` | several | `agent:<alias>`, plain tags |

The field is called `ticket_type` because JSON:API reserves `type`. The type selects the recipe's variant. Workspace contributors and leads manage the terms under the workspace's settings, on the tabs Types, Recipes and Labels; guests may only view them. A term has no page of its own and cannot be deleted. Agents set them by name with [`bakers_ticket_classify`](/cli/tools).

An epic is a ticket of type `epic`. It groups child tickets, which do the work; the project overview lists epics by type.


## Recipes

A recipe is an installed skill named `bb-recipe-<method>`. Shipped methods include Matt, Superpowers, verification, and deployment/release. [Write a recipe](/skills-and-workflows/recipes) owns slot syntax. Qualification loads every installed recipe completely, picks the one whose method fits the ask, then a type that recipe declares, and writes both on the ticket with its reason. Your `WORKFLOW.md` may add guidance for that choice; no recipe is preselected. Qualification asks only when a person is present and two recipes fit equally; an unattended run decides by fit itself. A later change follows the `bb-scope-change` skill.

A run stops before doing any work when the recipe, its section for the current state, or the ticket's type within that recipe is missing, or when a recipe's own type has no `## bb-gates` row. To write your own: [Write a recipe](/skills-and-workflows/recipes).

## Labels

| Label | Set by | Effect |
|---|---|---|
| `agent:<alias>` or `agent:<route>` | you, or qualification after you confirm | the coding agent for every state |
| `agent:<alias>@<state>` or `agent:<route>@<state>` | the same | the coding agent for that state only |
| `auto` | you, or the host when it hands a specified ticket over | the agent carries the ticket to `done` on its own (skill `bb-label-auto`): it decides technical questions itself, asks you only what is yours to decide, asks for your one acceptance only when you had something to decide, and merges after review |
| `auto-review` | you (Contributor or Lead) | the agent carries the ticket to a published review verdict on its own (skill `bb-label-auto-review`); the ticket's reviewer confirms the verdict and authorizes the merge. Needs a reviewer |
| `auto-accept` | you (Lead) | the agent carries the ticket to `done` on its own, but asks you to accept the result at one link first (skill `bb-label-auto-accept`); when the plan names a risky change, the reviewer confirms the verdict too |
| `ticket-question` | you, or the host together with `auto` | the agent asks you through the ticket (skill `bb-label-ticket-question`): a question or a technical problem goes into a comment, and the ticket freezes until you answer and unfreeze it |

With `ticket-question`, answer in a comment, remove the question label and unfreeze to continue. Do not use that label when nobody will answer ticket questions. Without it, questions go to the session. `auto` does not waive checks; acceptance is due only when something was yours to decide.

Each label passes a set of named **gates**, the frame's human waits such as `plan`, `coding`, `verdict` and `merge`; every other gate waits for a person, and each handoff lists who passed which gate under `### Gates`. The gate catalog and the gate set per type are in the frame reference `references/gates.md`; the reasons in the decision record `docs/decisions/gate-keys-for-unattended-work.md`. `auto-review` and `auto-accept` do not apply to `deployment` and `verification` tickets: a run that finds one there stops with a question. Who may set which label is not enforced yet.

Other installed `bb-label-<label>` skills can define behavior for their labels. A label without such a skill or built-in meaning is a tag for people and filters.

## Agent labels

Labels pick from the agent catalog on the machine that runs the ticket. A direct alias beats a route; the full precedence list is in [Machines](/agents/reference#which-agent-runs-a-state). An unknown or unavailable label warns and falls through. Aliases, routes and defaults are set in [Agents and models](/agents/guide).

## Origin labels

A ticket with a GitLab issue as origin mirrors its progress as a label on that issue: [Origin labels](/skills-and-workflows/workflow-file#origin-labels).
