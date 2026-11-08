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
```

| Section | Job |
|---|---|
| `## bb-phase-provision` | The [`provision_up`](/provision/hooks#provision-on-an-agent-s-request) profile each kind of check needs, and how container commands run. Leave it out when no work needs a runtime. |
| `## bb-phase-work` | A `\| When \| Skill \|` table: extra skills for matching changes, for example a Drupal skill for `web/modules/`. |
| `## bb-phase-validate` | A `\| When \| Command \|` table: the checks for matching changes. |
| `## bb-phase-deliver` | How a merge request is merged: the merge gate and what runs in it. |
| `## bb-phase-outtake` | Your test-user list and how test personas get a login for manual review. |

A run applies every matching row, and the rows are binding: the agent loads each named skill before the work it governs and stops if one is missing. The engineering method is not in this file; each ticket carries a [recipe](/skills-and-workflows/types-recipes-labels). Repository conventions and test lore belong in your repository docs, linked from `CLAUDE.md`.

The label `auto` alone lets a ticket work on its own; the entry line needs no clause for it. In any state, such a ticket then works on its own to `done`, asks the user only content questions, collected into one question per run, and one acceptance, and refers technical problems to the developers. The label `ticket-question` sends those questions and problems through the ticket, which then freezes until answered; without it they go to the session. Label no ticket `ticket-question` where nobody answers questions on tickets.

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

A ticket whose origin is an issue gets a customer-facing label on that issue at every transition. The labels come from one table in `## bb-phase-transition`, and from nowhere else:

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

An agent step mirrors a GitLab origin's label immediately before its state write. Manual state changes are not mirrored. Install and sign in to `glab` on every conductor host, and make sure every label the table names exists in the GitLab project or a parent group, with its colour and description; bakers.build reads the labels before writing and never creates one.
