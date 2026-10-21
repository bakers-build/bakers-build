# Name references

**Lets you set labels and environments by name instead of by ID.**

It is a support library. You do not enable it on its own; [Essentials](/addons/essentials) loads it for every connection.

## Enable it

Nothing to enable — used by [Essentials](/addons/essentials).

## Options

No options.

## Check it works

A write with `--label_names work:code` or `--environment_names staging` sets the matching relationship.

## Good to know

- Names resolve only on the live write. A dry run shows the name unresolved.
- An unknown name stops the write; nothing is sent.
- Environment names are unique only within a project, so they resolve against the ticket's project.

Source: [`bakers-cli/addons/name-refs`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/name-refs)
