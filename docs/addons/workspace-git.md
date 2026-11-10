# Git workspace

**Gives each ticket its own plain Git worktree, without a terminal session.**

For operators pairing a terminal executor with plain Git worktrees. Git must be available, and the conductor needs a separate executor.

## Enable it

Add the package to `addons` in the project's `.bakers/project.config.js`, next to your executor.

```js
addons: [
  '@bakers-build/addon-remote-drupal',
  '@bakers-build/addon-herdr-core',
  { use: '@bakers-build/addon-workspace-git', with: { branch_prefix: 'bakers/' } },
],
```

## Options

| Option | Type | Default | Effect |
|---|---|---|---|
| `branch_prefix` | string | `bakers/` | Prefix of every ticket branch. |
| `branch_template` | string | `{branch_prefix}{key}-{title_slug}` | Branch name. `{identifier}` is also available. |
| `auto_setup_merge` | boolean | `false` | `false`: before it creates a worktree, the addon sets `branch.autoSetupMerge=false` in the root repository. Creating a worktree then writes nothing to the shared `.git/config`, so once the setting is written it still works while a sandbox holds `config.lock`. If that first write meets a held lock, the conductor logs a warning with the repair command. Runs get `push.default=current` through `GIT_CONFIG_COUNT`, so a plain `git push` creates the same-name remote branch, and run branches have no upstream. This applies to everyone who uses that repository: `git switch <remote branch>` no longer sets an upstream either. `true` leaves Git alone, but it does not revert an earlier change; for that, run `git config --unset branch.autoSetupMerge`. |

## Check it works

A dispatched ticket gets a worktree in `<checkout>-worktrees/` on a branch that matches your template.

## Good to know

- This backend currently ignores the requested `baseRef` and derives its branch through the template. Creation uses the root checkout’s HEAD with `git worktree add --force -B`, which can reset an existing same-name branch. Use unique branch names; choose herdr or Orca when exact ticket branches and parent-base selection are required.

- Worktrees are created next to the checkout, in `<root>-worktrees`.
- The package also loads `WORKFLOW.md` from the worktree as run instructions, when the file exists.
- Listing [herdr](/addons/herdr) or [Orca](/addons/orca) in `addons` as well adds their workspace, and the last one listed wins with a warning. To run their executor on Git worktrees, set an explicit `executor` slot instead; see [Conductor slots](/addons/slots).
- When a ticket is done, the conductor removes its worktree with Git, whatever the executor.

Package source in a checkout: `bakers-cli/addons/workspace-git`.
