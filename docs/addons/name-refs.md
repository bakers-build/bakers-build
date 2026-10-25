# Name references

**Lets you set a ticket's type, recipe, labels and environments by name instead of by ID.**

It is a support library. You do not enable it on its own; [Essentials](/addons/essentials) loads it for every connection.

## Enable it

Nothing to enable — used by [Essentials](/addons/essentials).

## Options

No options.

## Check it works

A write with `--type_names bug`, `--recipe_names <recipe>`, `--label_names work:code` or `--environment_names staging` sets the matching relationship.

## Good to know

- Names resolve only on the live write. A dry run shows the name unresolved.
- A type, recipe or label name resolves in the ticket's workspace. An unknown name is created there first, then linked. A create that names no project has no workspace, so an unknown name stops it.
- `--type_names` and `--recipe_names` take one name and replace the previous value; `--label_names` adds to the labels given in the same write.
- An unknown environment name stops the write; nothing is sent.
- Environment names are unique only within a project, so they resolve against the ticket's project.

Source: [`bakers-cli/addons/name-refs`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/name-refs)
