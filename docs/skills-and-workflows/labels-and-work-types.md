# Labels and work types

**Labels choose the skill, the method and the agent for a ticket, and can mirror progress to GitLab.**

| Label | Set by | Effect |
|---|---|---|
| `work:<type>` | qualification | declares a sub-work; `<type>` is the work type that selects the skill owning plan, working and review |
| `method:<set>` | qualification | the engineering method chosen from `## Skill set` in `WORKFLOW.md`; at most one per ticket |
| `agent:<alias>` or `agent:<route>` | you, or qualification after you confirm | the coding agent for every state |
| `agent:<alias>@<state>` or `agent:<route>@<state>` | the same | the coding agent for that state only |

Anything else is a plain tag for people and filters.

## Work types

A skill that owns a step declares its work type, and qualification creates any missing `work:*` term from that declaration.

| Label | Owned by | Validated by |
|---|---|---|
| `work:code` | `create-spec`, `ddev-drupal-feature`, `ddev-drupal-bug` | the project's checks, and a browser scenario where one applies |
| `work:docs` | `docs-authoring` | proportional documentation, frontmatter and workflow checks |

A project adds a work type by loading a skill that declares one ([Write WORKFLOW.md](/skills-and-workflows/write-workflow-md)). A ticket may carry several `work:*` labels: each sub-work gets its own owner, they run in load order, and the last makes the single transition. `qualification` runs before the sub-works are known, so it carries no work type.

## Method labels

The `method:<set>` value is the file name of a set listed under `## Skill set`. With one entry nothing is asked; with several, qualification asks and records the choice. A later change follows the `scope-change` skill.

## Agent labels

Labels pick from the agent catalog on the machine that runs the ticket. A direct alias beats a route; the full precedence list is in [Machines](/advanced/machines#which-agent-runs-a-state). An unknown or unavailable label warns and falls through. Aliases, routes and defaults are set in [Agents and models](/advanced/configuration/agents-and-models).

## Origin labels

A ticket with a GitLab issue as origin mirrors its progress as a label on that issue: [Origin labels](/advanced/configuration/origin-labels).
