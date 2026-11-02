# Project info

**Prints the current project and workspace as JSON.**

For agents that the conductor did not start, and for shells where no bakers.build variables are set.

## Enable it

Nothing to enable. The command ships with the bakers.build CLI as `bakers info`.

## Options

No options. The command accepts `--config` and `--connection` to pick a connection.

## Check it works

The command prints `project`, `project_id`, `workspace`, `workspace_id` and `workspace_ids`.

::: details Per CLI
```sh
bakers info
```
:::

## Good to know

- It reads `BB_PROJECT`, `BB_PROJECT_ID`, `BB_WORKSPACE`, `BB_WORKSPACE_ID` and `BB_WORKSPACE_IDS` first, and asks the server only for what is missing.
- A value it cannot resolve is `null` (or `[]`), never left out.
- It never prompts and never writes to disk.

Package source in a checkout: `bakers-cli/addons/info`.
