# Configure your workflow

**`WORKFLOW.md` at your repository root tells the agents how your project works.**

**You need:** a [connected project](/get-started/connect-a-project).

## Let your agent write it

```text
Use bakers:bb-init-project to create WORKFLOW.md for this repository.
```

`bb-init-project` starts from the plugin's template; `bb-upgrade-project` updates a file you already have, including one in the old `## Loaded skills` layout.

## What goes in

One entry line, then optional `bb-phase-<phase>` sections, each named after the phase of a run it refines, and nothing else:

```md
# Project — WORKFLOW

Invoke `bakers:bb-workflow` and follow it for the ticket's current state.

## bb-phase-provision
## bb-phase-work
## bb-phase-validate
## bb-phase-deliver
## bb-phase-outtake
## bb-phase-transition
```

| Section | Job |
|---|---|
| `## bb-phase-provision` | The [`provision_up`](/configuration/project/hooks#provision-on-an-agent-s-request) profile each kind of check needs, and how container commands run. Leave it out when no work needs a runtime. |
| `## bb-phase-work` | A `\| When \| Skill \|` table: extra skills for matching changes, for example a Drupal skill for `web/modules/`. |
| `## bb-phase-validate` | A `\| When \| Command \|` table: the checks for matching changes. |
| `## bb-phase-deliver` | How a merge request is merged: the merge gate and what runs in it. |
| `## bb-phase-outtake` | Your test-user list and how test personas get a login for manual review. |
| `## bb-phase-transition` | Optional origin-label mapping, described below. |

A run applies every matching row, and the rows are binding: the agent loads each named skill before the work it governs and stops if one is missing. The engineering method is not in this file; each ticket carries a [recipe](/skills-and-workflows/types-recipes-labels). Repository conventions and test lore belong in your repository docs, linked from `CLAUDE.md`.

The [`auto` and `ticket-question` labels](/skills-and-workflows/types-recipes-labels#labels) control unattended work and where the agent asks questions. Neither needs an extra entry-line clause.

## Example

A Drupal project:

```md
## bb-phase-provision

Drupal checks run on `provision_up('test')`.

## bb-phase-work

| When | Skill |
|---|---|
| `web/modules/custom/`, `config/` | `drupal-developer` |

## bb-phase-validate

| When | Command |
|---|---|
| PHP implementation | `vendor/bin/phpcs && vendor/bin/phpstan` |
```

The skills and commands are examples; name your own for other stacks. A runtime addon's page shows how its commands map to its tools.

## Origin labels

An authorized agent transition can mirror a GitLab origin issue's progress; manual state changes are not mirrored. Install and sign in to `glab` on the conductor host. Other origin adapters are not supplied by this rule. The mapping comes only from `## bb-phase-transition`:

```md
## bb-phase-transition

| State | Origin label |
|---|---|
| qualification | doing |
| plan | doing |
| working | doing |
| review | doing |
| done | review |
```

This is the default table the project template ships. Change the labels to your customer's vocabulary. A state without a row writes nothing, and a file without the table writes no origin label at all. The labels in the table form the family bakers.build owns: exactly one of them is on the issue at a time, and labels outside the table are never touched.

bakers.build creates no origin labels: the table must name labels that exist in the GitLab project or one of its parent groups. Each table label is matched to an existing label ignoring case, and the existing spelling is written and removed, so `doing` in the table sets the project's `Doing`. Where both spellings exist, the exact one wins, otherwise the project's own label. A table label the project lacks is skipped with a warning, and the transition still goes ahead.

**Done when:** the file starts with the entry line and every skill it names is installed for the agent. [How it works](/skills-and-workflows/guide#how-it-works) explains how a run reads it.

### Publishing origin labels

The agent writes the mapped label immediately before its ticket state write. With no origin, table or destination row, it makes no origin-label change. Missing labels or adapter failures warn without blocking the ticket transition.
