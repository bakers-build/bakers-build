# Name references

**Lets you set a ticket's type, recipe, labels and environments by name instead of by ID.**

It is a support library. You do not enable it on its own; [Essentials](/addons/essentials) loads it for every connection.

## Enable it

Nothing to enable — used by [Essentials](/addons/essentials).

## Options

No options.

## Check it works

There is nothing to run by hand. To set a ticket's type, recipe or labels by name yourself, use the named tools: `bakers_ticket_classify` for type and recipe, `bakers_ticket_update` with `labels_add` for labels ([bakers tools](/advanced/cli/tools)).

## Good to know

- A type, recipe or label name resolves in the ticket's workspace. An unknown name is created there first, then linked.
- An unknown environment name stops the write; nothing is sent.
- Environment names are unique only within a project, so they resolve against the ticket's project.

Source: [`bakers-cli/addons/name-refs`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/name-refs)
