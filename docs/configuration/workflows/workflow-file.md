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
| `## bb-phase-provision` | The runtime guide and setup that bring the environment up, for example `@bakers-build/bb-runtime-ddev`. Leave it out when no work needs a runtime. |
| `## bb-phase-work` | A `\| When \| Skill \|` table: extra skills for matching changes, for example a Drupal skill for `web/modules/`. |
| `## bb-phase-validate` | A `\| When \| Command \|` table: the checks for matching changes. |
| `## bb-phase-deliver` | How a merge request is merged: the merge gate and what runs in it. |
| `## bb-phase-outtake` | Your test-user list and how test personas get a login for manual review. |

A run applies every matching row, and the rows are binding: the agent loads each named skill before the work it governs and stops if one is missing. The engineering method is not in this file; each ticket carries a [recipe](/configuration/workflows/types-recipes-labels). Repository conventions and test lore belong in your repository docs, linked from `CLAUDE.md`.

To let tickets labelled `ticket:pingpong` work on their own, add a second sentence to the entry line: "When the ticket's labels include `ticket:pingpong` and its state is `working` or `review`, invoke `bakers:bb-ticket-pingpong` too and follow it with the frame." Such a ticket then works on its own, asks the user only content questions through the ticket and reports technical problems to keytec. Leave the sentence out where nobody answers questions on tickets.

## Example

A Drupal project on DDEV:

```md
## bb-phase-provision

Runtime: DDEV through `@bakers-build/bb-runtime-ddev`.

## bb-phase-work

| When | Skill |
|---|---|
| `web/modules/custom/`, `config/` | `drupal-developer` |

## bb-phase-validate

| When | Command |
|---|---|
| PHP implementation | `ddev phpcs && ddev phpstan` |
```

The skills and commands are examples; name your own for other stacks.

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

**Done when:** the file starts with the entry line and every skill it names is installed for the agent. [How it works](/configuration/workflows#how-it-works) explains how a run reads it.

### Publishing origin labels

An agent step mirrors a GitLab origin's label immediately before its state write. Manual state changes are not mirrored. Install and sign in to `glab` on every conductor host, and create the table's labels in the GitLab project with their colour and description first.
