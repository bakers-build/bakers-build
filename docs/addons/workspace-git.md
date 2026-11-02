# Git workspace

**Gives each ticket its own plain Git worktree, without a terminal session.**

For conductors that use an executor other than herdr.

## Enable it

Add the package to `addons` in the project's `.bakers/conductor.config.js`, next to your executor.

```js
addons: [
  '@bakers-build/addon-remote-drupal',
  { use: '@bakers-build/addon-workspace-git', with: { branchPrefix: 'bakers/' } },
],
```

## Options

| Option | Type | Default | Effect |
|---|---|---|---|
| `branchPrefix` | string | `bakers/` | Prefix of every ticket branch. |
| `branchTemplate` | string | `{branchPrefix}{key}-{titleSlug}` | Branch name. `{identifier}` is also available. |

## Check it works

A dispatched ticket gets a worktree in `<checkout>-worktrees/` on a branch that matches your template.

## Good to know

- Worktrees are created next to the checkout, in `<root>-worktrees`.
- The package also loads `WORKFLOW.md` from the worktree as run instructions, when the file exists.
- Do not combine it with [herdr](/addons/herdr): herdr brings its own workspace, and the last one listed wins with a warning.

Package source in a checkout: `bakers-cli/addons/workspace-git`.
