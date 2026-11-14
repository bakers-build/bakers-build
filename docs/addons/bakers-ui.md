# Terminal UI

**The renderer behind `bakers ui`: your work, tickets, runs and conductors in the terminal.**

For anyone who works with bakers.build from a terminal.

## Enable it

Nothing to enable. `bakers ui` loads it on its own. You need a signed-in [connection](/configuration/connection); select a workspace if prompted.

## Check it works

`bakers ui` opens on **My work**, your open assigned tickets.

::: details Per CLI
```sh
bakers ui
```
:::

## Good to know

- It runs on the Bun runtime that the package installs; `bakers ui` restarts itself under Bun. `BAKERS_UI_NO_BUN=1` uses Node 26.1 or later with `--experimental-ffi` instead.
- `@bakers-build/ui` is the `bakers ui` command; `@bakers-build/addon-bakers-ui` is this renderer.

More: [Usage](/addons/bakers-ui/usage), [command reference](/addons/bakers-ui/reference), [tickets and runs](/addons/bakers-ui/tickets).

Package source in a checkout: `bakers-cli/addons/bakers-ui`.
