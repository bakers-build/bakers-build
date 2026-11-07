# Conductor slots

A conductor fills two slots for the work on a ticket. The **workspace** owns the ticket's Git worktree, and the **executor** hosts the agent's terminal in it. The conductor calls both and runs every lifecycle hook itself. They share only the worktree path and branch, so any executor runs on any workspace's worktree.

Each slot holds exactly one addon. To write your own, read [Write an executor or a workspace](/addons/build/executor-workspace).

## Which addon fills which slot

| Addon | Executor | Workspace |
|---|---|---|
| [herdr](/addons/herdr) | herdr TUI tabs; shows a new worktree with the `open` layout | herdr worktrees; removed with `herdr worktree remove`, else Git |
| [Orca](/addons/orca) | Orca terminals; opens a new worktree's overview terminal | Git worktrees adopted by Orca; removed with `orca worktree rm`, else Git |
| [herdr-core](/addons/herdr-core) | herdr-core (`hc`) terminals | — |
| [Git workspace](/addons/workspace-git) | — | Plain Git worktrees |
| [Fake fixture](/addons/fake) | Test executor | Test workspace |

## Set both in the project

`.bakers/conductor.config.js` names one addon per slot. Listing an addon in `addons` fills the slots it contributes; an explicit slot wins over that.

```js
executor: { plugin: '@bakers-build/addon-herdr-core' },
workspace: { plugin: '@bakers-build/addon-workspace-git' },
```

When several listed addons contribute the same slot, the last one wins, with a warning.

## Choose the executor per machine

`~/.bakers/machine.config.js` may set its own `executor` slot, which wins for every project on that machine. The workspace and the remote stay with the project.

```js
// ~/.bakers/machine.config.js
export default {
  schema_version: 1,
  machine_id: '…',
  label: 'my-laptop',
  addons: ['@bakers-build/addon-claude'],
  executor: { plugin: '@bakers-build/addon-herdr-core' },
};
```

The executor resolves in this order: the machine's `executor`, the project's `executor`, then the last executor discovered from `addons`. `bakers config check` prints `Executor: from <file>` for an explicit slot. Choosing an executor per ticket or run is not supported.

## Migrating an addon

`BbExecutor.runHook`, `BbExecutor.removeWorktree` and `BbWorkspace.applyOpenLayout` are gone: the conductor runs the config's `hooks`; move removal to `BbWorkspace.remove` and the open layout to `BbExecutor.openWorkspace`. herdr's `open` option is now read by its executor; an explicit `herdrWorkspace` slot carrying `with.open` must move it to the executor.
