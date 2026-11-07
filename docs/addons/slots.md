# Conductor slots

The **workspace** owns the ticket's Git worktree, the **executor** hosts the agent's terminals, and the conductor runs every lifecycle hook. They share only the worktree path and branch, so any executor runs on any workspace's worktree.

## Who does what

| Owner | Job | Interface |
|---|---|---|
| Workspace | Create or reuse the ticket worktree; remove it when the ticket is done | `BbWorkspace`: `ensure`, `remove` |
| Executor | Start the agent's terminal, stop it, clean it up; optionally show a fresh worktree in the tool | `BbExecutor`: `capabilities`, `startRun`, `stopRun`, `cleanupRun`, optional `openWorkspace` |
| Conductor | Run the `hooks` of the conductor config (`after_create`, `before_run`, `after_run`, `after_done`, `on_freeze`, `on_resume`) in the worktree, after the addon hook listeners | — |

Both interfaces are exported from `@bakers-build/conductor/contract`.

```ts
interface BbExecutor {
  id: string;
  /** persistent = the agent lives in a hosted terminal; gates stopRun/cleanupRun only. */
  capabilities(): { persistent: boolean };
  openWorkspace?(path: string, ctx: { identifier: string; branch: string; title: string }): Promise<void>;
  startRun(input: SpawnRunInput): Promise<SpawnedSession>;
  stopRun(branch: string): Promise<void>;
  cleanupRun(branch: string, runId: number): Promise<void>;
}

interface BbWorkspace {
  ensure(identifier: string, branch?: string, baseRef?: string): Promise<EnsuredWorkspace>;
  remove(branch: string, worktreePath?: string): Promise<WorktreeTeardown>;
}
```

`remove` reports `removed`, `already_absent` or `unverified`; on `unverified` the next reap retries. `@bakers-build/addon-workspace-git` exports `removeGitWorktree`, the Git teardown every shipped workspace falls back to; it refuses the main checkout.

## Order of a dispatch

1. `workspace.ensure`
2. hook `after_create`, when the worktree was created or has no recorded successful `after_create`
3. `executor.openWorkspace`, only when the worktree was created
4. hook `before_run`
5. `executor.cleanupRun` for a leftover of the same run
6. `executor.startRun`

Finalising a run calls `stopRun`, stores the transcript, runs `after_run`, then `cleanupRun`. Reaping a done ticket runs `after_done`, then `workspace.remove`, for every executor.

## Which addon fills which slot

| Addon | Executor | Workspace |
|---|---|---|
| [herdr](/addons/herdr) | herdr TUI tabs; `openWorkspace` applies the `open` layout | herdr worktrees; `remove` uses `herdr worktree remove`, else Git |
| [Orca](/addons/orca) | Orca terminals; `openWorkspace` opens the overview terminal | Git worktrees adopted by Orca; `remove` uses `orca worktree rm`, else Git |
| [herdr-core](/addons/herdr-core) | herdr-core (`hc`) terminals; no `openWorkspace` | — |
| [Git workspace](/addons/workspace-git) | — | Plain Git worktrees |
| [Fake fixture](/addons/fake) | Test executor | Test workspace |

## Choose the executor per machine

The project's executor is the default. `~/.bakers/machine.config.js` may set its own `executor` slot, which wins for every project on that machine. The workspace and the remote stay with the project.

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

The executor slot resolves in this order: the machine's `executor`, the project's `executor`, then the last executor discovered from `addons`. `bakers config check` prints `Executor: from <file>` for an explicit slot. One conductor runs one executor; choosing an executor per run is not supported.

## Migrating an addon

`BbExecutor.runHook`, `BbExecutor.removeWorktree` and `BbWorkspace.applyOpenLayout` are gone: the conductor runs the config's `hooks`; move removal to `BbWorkspace.remove` and the open layout to `BbExecutor.openWorkspace`. herdr's `open` option is now read by its executor; an explicit `herdrWorkspace` slot carrying `with.open` must move it to the executor.
