# Conductor slots

A conductor fills two slots for the work on a ticket. The **workspace** owns the ticket's Git worktree, and the **executor** hosts the agent's terminal in it. The conductor calls both and runs every lifecycle hook itself. They share only the worktree path and branch, so any executor runs on any workspace's worktree.

Each slot holds exactly one addon. To write your own, read [Write an executor or a workspace](/addons/build/executor-workspace).

[Use your client](/get-started/use-your-client) explains the user-facing choices. herdr-cli and herdr-app use separate terminal hosts; herdr-core integrates the latter. Hermes discusses tickets through MCP and fills neither slot.

## Which addon fills which slot

| Addon | Executor | Workspace |
|---|---|---|
| [herdr](/addons/herdr) | herdr TUI tabs; shows a new worktree with the `open` layout | herdr worktrees; removed with `herdr worktree remove`, else Git |
| [Orca](/addons/orca) | Orca terminals; opens a new worktree's overview terminal | Git worktrees adopted by Orca; removed with `orca worktree rm`, else Git |
| [herdr-core](/addons/herdr-core) | herdr-core (`hc`) terminals | — |
| [Git workspace](/addons/workspace-git) | — | Plain Git worktrees |

## Set both in the project

`.bakers/project.config.js` names one addon per slot. Listing an addon in `addons` fills the slots it contributes; an explicit slot wins over that.

```js
executor: { use: '@bakers-build/addon-herdr-core' },
worktree: { use: '@bakers-build/addon-workspace-git' },
```

When several listed addons contribute the same slot, the last one wins, with a warning.

## Choose the executor per machine

`~/.bakers/machine.config.js` may set its own `executor` slot, which wins for every project on that machine. There is no equivalent explicit machine `worktree` or `server` override; addon contributions still follow the scope and selection rules.

```js
// Add to the existing ~/.bakers/machine.config.js:
executor: { use: '@bakers-build/addon-herdr-core' },
```

The executor resolves in this order: the machine's `executor`, the project's `executor`, then the last executor discovered from `addons`. `bakers config check` prints `Executor: from <file>` for an explicit slot. Choosing an executor per ticket or run is not supported.

## Start hook

The conductor's `hooks` listeners may define `before_conductor_start(machine,
conductor)` for start-only machine enrichment. This is an addon callback, not a
project shell-hook slot. See [the start contract](/addons/build/contracts#before-conductor-start).

## Migrating an addon

For custom implementations, follow the [executor/workspace migration notes](/addons/build/executor-workspace#migrating-an-addon). For configuration changes, keep lifecycle `hooks` at project level and move a legacy workspace `open` layout to the executor.
