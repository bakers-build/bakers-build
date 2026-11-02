# Artifacts

**Adds an Artifacts tab to a ticket in `bakers ui`, showing the run's local evidence files.**

For anyone who reviews screenshots, logs and notes that agents leave in `assets-ai/`.

## Enable it

Add the package to the top-level `addons` in `~/.bakers/machine.config.js`. Keep the other fields there.

```js
// @bakers-schema-version 3
export default {
  schema_version: 3,
  machine_id: 'alex-laptop',
  user_id: 'alex',
  max_parallel: 1,
  addons: ['@bakers-build/addon-claude', '@bakers-build/addon-bakers-ui-artifacts'],
};
```

The addon may also be listed in a project's `.bakers/conductor.config.js` or a connection's `addons`; listed in both the machine and the project file, it renders one tab from the machine entry. See [Which file takes `addons`](/addons/configure#which-file-takes-addons).

## Options

No options.

## Check it works

Restart `bakers ui` and open a ticket: it shows an **Artifacts** tab. Open a ticket twice, going back in between, to confirm the tab still resolves after navigation.

::: details Per CLI
```sh
bakers config check --scope machine
bakers ui
```
:::

## Good to know

- The tab reads the first existing folder of `<checkout>/assets-ai/<ticket identifier>/` and `<checkout>/.bakers-worktrees/<ticket branch>/assets-ai/<ticket identifier>/`. Start `bakers ui` from the ticket worktree when you can.
- Arrows select a file. Enter or Space expands text, up to 200 lines. Images and PDFs show their size only.
- The files are local and vanish with the worktree. Put lasting results in the ticket hand-off, and keep `assets-ai/` ignored by Git.

::: tip Ask your AI
"Add the Artifacts addon to my machine config without touching `agents`, then run the checks."
:::

Package source in a checkout: `bakers-cli/addons/bakers-ui-artifacts`.
