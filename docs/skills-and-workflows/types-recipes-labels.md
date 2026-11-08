# Ticket type, recipe and labels

**The recipe chooses the method, the type chooses its variant, and labels choose the agent and can mirror progress to GitLab.**

| Field | Set by | Effect |
|---|---|---|
| `recipe` | qualification | the recipe skill that supplies the method for `plan`, `working` and `review`, such as `matt` for `bb-recipe-matt`; empty until qualification chooses |
| `ticket_type` | qualification | `feature`, `bug`, `chore` and so on; selects the recipe's slots for that type |
| `labels` | you, or qualification | agent choice and plain tags, see below |

The fields and their vocabularies are listed under [Ticket type, recipe and labels](/skills-and-workflows/states#ticket-type-recipe-and-labels).

## Recipes

A recipe is a skill named `bb-recipe-<method>`, one per engineering method, with one `## bb-state-<state>` section per state it refines and `### bb-phase-<phase>` slots inside. bakers.build ships `bb-recipe-matt` and `bb-recipe-superpowers`. Qualification loads every installed recipe completely, picks the one whose method fits the ask, then a type that recipe declares, and writes both on the ticket with its reason. Your `WORKFLOW.md` may add guidance for that choice; no recipe is preselected. Qualification asks only when a person is present and two recipes fit equally; an unattended run decides by fit itself. A later change follows the `bb-scope-change` skill.

A run stops before doing any work when the recipe, its section for the current state, or the ticket's type within that recipe is missing. To write your own: [Write a recipe](/skills-and-workflows/recipes).

## Labels

| Label | Set by | Effect |
|---|---|---|
| `agent:<alias>` or `agent:<route>` | you, or qualification after you confirm | the coding agent for every state |
| `agent:<alias>@<state>` or `agent:<route>@<state>` | the same | the coding agent for that state only |
| `auto` | you, or the host when it hands a specified ticket over | the agent carries the ticket to `done` on its own (skill `bb-label-auto`): it decides technical questions itself, asks you only what is yours to decide, asks for your one acceptance only when you had something to decide, and merges after review |
| `ticket-question` | you, or the host together with `auto` | the agent asks you through the ticket (skill `bb-label-ticket-question`): a question or a technical problem goes into a comment, and the ticket freezes until you answer and unfreeze it |

Anything else is a plain tag for people and filters.

## Agent labels

Labels pick from the agent catalog on the machine that runs the ticket. A direct alias beats a route; the full precedence list is in [Machines](/agents/reference#which-agent-runs-a-state). An unknown or unavailable label warns and falls through. Aliases, routes and defaults are set in [Agents and models](/agents/guide).

## Origin labels

A ticket with a GitLab issue as origin mirrors its progress as a label on that issue: [Origin labels](/skills-and-workflows/workflow-file#origin-labels).
