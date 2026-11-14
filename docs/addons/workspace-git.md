# Git workspace

**Gives each ticket its own plain Git worktree, without a terminal session.**

For operators pairing a terminal executor with plain Git worktrees. Git must be available, and the conductor needs a separate executor.

## Enable it

Add the package to `addons` in the project's `.bakers/project.config.js`, next to your executor.

```js
addons: [
  '@bakers-build/addon-herdr-core',
  { use: '@bakers-build/addon-workspace-git', with: { branch_prefix: 'bakers/' } },
],
```

## Options

<!-- @options @bakers-build/addon-workspace-git -->

With `auto_setup_merge: false`, the setting applies to everyone who uses that repository: `git switch <remote branch>` no longer sets an upstream either. If the first write meets a `config.lock` held by a sandbox, the conductor logs a warning with the repair command. To undo it after switching to `true`, run `git config --unset branch.autoSetupMerge`.

## Isolated runs

Under an isolating runtime ([Docker](/addons/runtime-docker), [Bubblewrap](/addons/runtime-bwrap)) every run start fetches the target branch and replaces the worktree with a fresh clone of the ticket branch at the same path. Tracked files are reset and untracked files removed; ignored files such as `node_modules` stay. Commit before a run ends: uncommitted work is not carried over. On the host, the workspace's `.git` is an empty placeholder.

`shared: true` on the isolating runtime borrows the parent repository's objects instead of copying them. The workspace option `shared` is deprecated: it applies only when the runtime does not set `shared`. While a run is open, never prune the parent or run `git repack -d` or `git gc --prune` there: the clone can lose objects it needs. See [run clones](/provision/security/shared-settings#isolated-git-delivery).

## Check it works

A dispatched ticket gets a worktree in `<checkout>-worktrees/` on a branch that matches your template.

## Good to know

- This backend currently ignores the requested `baseRef` and derives its branch through the template. Creation uses the root checkout’s HEAD with `git worktree add --force -B`, which can reset an existing same-name branch. Use unique branch names; choose herdr or Orca when exact ticket branches and parent-base selection are required.

- Worktrees are created next to the checkout, in `<root>-worktrees`.
- The package also loads `WORKFLOW.md` from the worktree as run instructions, when the file exists.
- Listing [herdr](/addons/herdr) or [Orca](/addons/orca) in `addons` as well adds their workspace, and the last one listed wins with a warning. To run their executor on Git worktrees, set an explicit `executor` slot instead; see [Conductor slots](/addons/slots).
- When a ticket is done, the conductor removes its worktree with Git, whatever the executor.

Package source in a checkout: `bakers-cli/addons/workspace-git`.
