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

A run applies every matching row, and the rows are binding: the agent loads each named skill before the work it governs and stops if one is missing. The engineering method is not in this file; each ticket carries a [recipe](/skills-and-workflows/labels-and-work-types). Repository conventions and test lore belong in your repository docs, linked from `CLAUDE.md`.

## Example

A Drupal project on DDEV:

```md
## bb-phase-provision

Runtime: DDEV through `@bakers-build/bb-runtime-ddev`.

## bb-phase-work

| When | Skill |
|---|---|
| `web/modules/custom/`, `config/` | `keytec-drupal:keytec-drupal-developer` |

## bb-phase-validate

| When | Command |
|---|---|
| PHP implementation | `ddev phpcs && ddev phpstan` |
```

The skills and commands are examples; name your own for other stacks.

## Adjust an input

Some `bb-workflow` references declare inputs with a default. To change one, name the reference and the key in the section of the phase where it is used, for example the origin label map, which is written at the end of a run:

```md
## bb-phase-transition

`@bakers-build/bb-workflow` › `references/origin-status.md` `origin_labels.data`:

    working: in progress
    done: ready for review
```

`origin_labels.data` is the one declared input.

**Done when:** the file starts with the entry line and every skill it names is installed for the agent. [How it works](/skills-and-workflows/how-it-works) explains how a run reads it.
