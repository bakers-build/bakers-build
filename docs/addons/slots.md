# Conductor slots

The **workspace** owns a ticket's Git worktree; the **executor** hosts its agent terminal.
The conductor owns lifecycle hooks. Each slot holds one addon.
[Use your client](/get-started/use-your-client) explains the choices;
[Write an executor or a workspace](/addons/build/executor-workspace) covers custom addons.

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

## Initialize and compose

`config init --scope project --executor @bakers-build/addon-herdr-core` selects
herdr-core with Git workspace. `--server`, `--executor`, `--worktree` accept package
names contributing that slot in project scope, filling missing entries. An executor
without a workspace needs `--worktree`. Without flags it writes only herdr; the [connection](/configuration/connection) supplies the server unless the project names one.

Presets may export `addons: ['package-name']`: children load before parents in the
same scope, at any depth. Resolved presets and aliases are deduplicated; cycles
report their chain. Nested scope mismatches are skipped silently. Unresolved children
name their parent: project fails, machine warns/skips. Explicit slots win.

herdr-core nests workspace-git. Checks report
`@bakers-build/addon-workspace-git (via @bakers-build/addon-herdr-core)`.

## Choose the executor per machine

A machine's explicit `executor` wins for every project. Machine `worktree` and `server` overrides are unsupported.

```js
// Add to the existing ~/.bakers/machine.config.js:
executor: { use: '@bakers-build/addon-herdr-core' },
```

The executor resolves in this order: the machine's `executor`, the project's `executor`, then the last executor discovered from `addons`. `bakers config check` prints `Executor: from <file>` for an explicit slot. Choosing an executor per ticket or run is not supported.

## Runtime: where a run starts

The optional machine slot `runtime` decides where the agent runs: on the host, in a
[Docker container](/addons/runtime-docker), or a [Bubblewrap sandbox](/addons/runtime-bwrap). It rewrites the launch before the
executor starts it; a failure fails the run. Agent permissions stay unchanged. To add your own
backend, [write a runtime addon](/addons/build/runtime).

## Start hook

The conductor's `hooks` listeners may define `before_conductor_start(machine,
conductor)` for start-only machine enrichment. This is an addon callback, not a
project shell-hook slot. See [the start contract](/addons/build/contracts#before-conductor-start).

## Migrating an addon

For custom implementations, follow the [executor/workspace migration notes](/addons/build/executor-workspace#migrating-an-addon).
