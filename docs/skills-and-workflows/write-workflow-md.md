# Configure your workflow

**`WORKFLOW.md` at your repository root tells the agents how your project works.**

**You need:** a [connected project](/get-started/connect-a-project).

## Let your agent write it

```text
Use bakers:bb-init-project to create WORKFLOW.md for this repository.
```

`bb-init-project` starts from the plugin's template; `bb-upgrade-project` updates a file you already have, including one in the old `## Loaded skills` layout.

## What goes in

One entry line, then optional sections named after the phases of a run:

```md
# Project — WORKFLOW

Invoke `bakers:bb-workflow` and follow it for the ticket's current state.

## provision
## work
## validate
## deliver
```

| Section | Job |
|---|---|
| `## provision` | The runtime guide and setup that bring the environment up, for example `@bakers-build/bb-runtime-ddev`. Leave it out when no work needs a runtime. |
| `## work` | A `\| When \| Skill \|` table: extra skills for matching changes, for example a Drupal skill for `web/modules/`. |
| `## validate` | A `\| When \| Command \|` table: the checks for matching changes. |
| `## deliver` | How a merge request is merged: the merge gate and what runs in it. |

A run applies every matching row, and the rows are binding: the agent loads each named skill before the work it governs and stops if one is missing. The engineering method is not in this file; each ticket carries a [recipe](/skills-and-workflows/labels-and-work-types). Repository conventions and test lore belong in your repository docs, linked from `CLAUDE.md`.

## Example

A Drupal project on DDEV:

```md
## provision

Runtime: DDEV through `@bakers-build/bb-runtime-ddev`.

## work

| When | Skill |
|---|---|
| `web/modules/custom/`, `config/` | `keytec-drupal:keytec-drupal-developer` |

## validate

| When | Command |
|---|---|
| PHP implementation | `ddev phpcs && ddev phpstan` |
```

The skills and commands are examples; name your own for other stacks.

## Adjust one skill

Some core skills declare inputs with a default. To change one, name the skill and the key in the section of the phase where the skill runs, for example the origin label map, which is written at the end of a run:

```md
## transition

`@bakers-build/bb-publish-origin-status` `origin_labels.data`:

    working: in progress
    done: ready for review
```

Declared inputs: `release.prompt` (`bb-prepare-deployment`), `health.prompt` (`bb-post-deployment`), `verify.prompt` (`bb-verify-on-environment`), `origin_labels.data` (`bb-publish-origin-status`).

**Done when:** the file starts with the entry line and every skill it names is installed for the agent. [How it works](/skills-and-workflows/how-it-works) explains how a run reads it.
