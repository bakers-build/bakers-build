# Terminal UI

**The renderer behind `bakers ui`: your work, tickets, runs and conductors in the terminal.**

For anyone who works with bakers.build from a terminal. Other UI addons, such as [Artifacts](/addons/bakers-ui-artifacts), add tabs to it.

## Enable it

Nothing to enable. `bakers ui` loads it on its own.

## Options

No options for users. `bakers ui` passes its own settings, such as the start screen and the workspace.

## Check it works

`bakers ui` opens on **My work**, your open assigned tickets.

::: details Per CLI
```sh
bakers ui
```
:::

## Good to know

- It runs on the Bun runtime that the package installs; `bakers ui` restarts itself under Bun. `BB_UI_NO_BUN=1` uses Node 26 or later with `--experimental-ffi` instead.
- `@bakers-build/ui` is the `bakers ui` command; `@bakers-build/addon-bakers-ui` is this renderer.

More: [Terminal UI](/advanced/cli/terminal-ui), [bakers ui](/advanced/cli/ui), [UI keys](/advanced/cli/ui-keys).

Source: [`bakers-cli/addons/bakers-ui`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/bakers-ui)
