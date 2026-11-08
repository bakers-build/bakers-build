# Write an executor or a workspace

A conductor runs each ticket in its own Git worktree, and each run's agent in a terminal. Two addon kinds do that work: the **workspace** owns the worktree, and the **executor** hosts the agent's terminal. This page explains what each one must do and how to write your own. [Conductor slots](/addons/slots) lists the shipped ones and how a config picks them.

## What they do

| Slot | Job | Interface |
|---|---|---|
| Workspace | Create or reuse the ticket's worktree; remove it when the ticket is done | `BbWorkspace`: `ensure`, `remove` |
| Executor | Start the agent's terminal in that worktree, stop it, clean it up; optionally show a fresh worktree in the tool | `BbExecutor`: `capabilities`, `startRun`, `stopRun`, `cleanupRun`, optional `openWorkspace` |
| Conductor | Call both, and run every lifecycle hook (`after_create`, `before_run`, `after_run`, `after_done`) itself | — |

The two never call each other. The conductor hands the worktree path and the branch from the workspace to the executor, so any executor runs on any workspace's worktree. One conductor has exactly one executor and one workspace.

## When the conductor calls them

A dispatch:

1. `workspace.ensure(identifier, branch, baseRef)` returns the path and whether it was `created`.
2. Hook `after_create`, on a created worktree or one with no recorded successful `after_create`.
3. `executor.openWorkspace(path, ctx)`, only when the worktree was created.
4. Hook `before_run`.
5. `executor.cleanupRun(branch, runId)`, to clear a leftover of the same run.
6. `executor.startRun(input)`.

The run ends when the server marks it done or cancelled. The conductor then calls `stopRun`, stores the transcript, runs `after_run`, and calls `cleanupRun`. For an executor that is not `persistent`, it skips `stopRun` and that `cleanupRun`.

When the ticket is done, the reaper runs `after_done`, then `workspace.remove(branch, worktreePath)`.

## Write an executor

Both interfaces come from `@bakers-build/conductor/contract`. This executor starts the agent as a detached process in the worktree:

```ts
import { spawn } from 'node:child_process';
import type { BbExecutor, ExecutorPlugin, SpawnRunInput } from '@bakers-build/conductor/contract';

class MyExecutor implements BbExecutor {
  readonly id = 'my-executor';

  constructor(private readonly command: string) {}

  capabilities() {
    return { persistent: true };
  }

  async startRun(input: SpawnRunInput) {
    const child = spawn('sh', ['-c', input.command ?? this.command], {
      cwd: input.workspacePath,
      env: { ...process.env, ...input.env },
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return { sessionRef: `${input.ticket.identifier}-${input.run.id}` };
  }

  async stopRun(_branch: string) {}

  async cleanupRun(branch: string, runId: number) {
    // Find and end only this run's terminal. Never throw.
  }
}

export function myExecutor(options: { command?: string } = {}): ExecutorPlugin {
  return {
    kind: 'executor',
    id: 'my-executor',
    requiredModules: [],
    async createExecutor() {
      return new MyExecutor(options.command ?? 'claude');
    },
  };
}

export default myExecutor;
```

The rules each method must keep:

- **`startRun(input)`** runs `input.command` in `input.workspacePath` with `input.env` added, and returns once the agent has started. `command` is the agent command the conductor built, prompt included. Throw when the launch fails: the run is then marked failed. Keep `env` out of argv and logs, since it carries tokens; the herdr executors write it to a 0600 launch script.
- **`capabilities().persistent`** is `true` when the agent lives on in a hosted terminal after `startRun` returns. It decides only whether the finalising pass calls `stopRun` and `cleanupRun`.
- **`cleanupRun(branch, runId)`** removes **only** that run's terminal. Another run of the same ticket may still be open. It is also called before every `startRun`, so a missing terminal is a quiet no-op. Log failures; never throw.
- **`stopRun(branch)`** signals the agent to stop, before the transcript is read. It must not delete the transcript. Most executors leave it empty and let `cleanupRun` end the terminal.
- **`openWorkspace(path, ctx)`** is optional. Add it when your tool has a window or layout to show for a new worktree. The worktree may come from any workspace, so find it by `path`, not by your own records. Log failures; never throw.
- An executor never creates, changes or removes a worktree, and runs no hooks.

Label each terminal with the branch and run id when you start it, so `cleanupRun` can find it again without any state of its own; the conductor may have restarted in between. [herdr-core](/addons/herdr-core) does this with `hc` labels.

## Write a workspace

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { removeGitWorktree, loadInstructions } from '@bakers-build/addon-workspace-git';
import type { BbWorkspace, WorkspacePlugin } from '@bakers-build/conductor/contract';
import { type ConductorLogger, exec } from '@bakers-build/core';

class MyWorkspace implements BbWorkspace {
  constructor(
    private readonly root: string,
    private readonly logger: ConductorLogger,
  ) {}

  async ensure(identifier: string, branch = `bakers/${identifier}`) {
    const path = join(this.root, '.bakers-worktrees', identifier);
    const created = !existsSync(path);
    if (created) await exec('git', ['-C', this.root, 'worktree', 'add', '-B', branch, path]);
    return { path, created, instructions: loadInstructions(path) };
  }

  remove(branch: string, worktreePath?: string) {
    return removeGitWorktree(
      this.root,
      branch,
      worktreePath,
      (args, cwd) => exec('git', ['-C', cwd, ...args]),
      this.logger,
    );
  }
}

export function myWorkspace(options: { root: string }): WorkspacePlugin {
  return {
    kind: 'workspace',
    id: 'my-workspace',
    requiredModules: [],
    async createWorkspace(_config, deps) {
      return new MyWorkspace(options.root, deps?.logger ?? console);
    },
  };
}
```

The rules:

- **`ensure(identifier, branch?, baseRef?)`** returns the same path for the same ticket on every call, and reuses an existing worktree instead of recreating it. Report `created: true` only when this call made it: the conductor runs `after_create` and `openWorkspace` on that. Create a new branch from `baseRef` when it resolves, else from your default base. Return `env` for variables the run needs from your backend.
- **`remove(branch, worktreePath?)`** tears the worktree down. Prefer `worktreePath` over `branch`: the agent may have renamed the branch. Return `removed` after a teardown, `already_absent` when nothing was there, and `unverified` when it may still exist on another host; the reaper retries `unverified` later. Throw only on a real failure.
- `removeGitWorktree` from `@bakers-build/addon-workspace-git` is the Git teardown every shipped workspace falls back to. It refuses to remove the main checkout. Call it after your tool's own teardown, or alone.
- A workspace starts no terminal and runs no hooks.

## Package and select it

Package it as [Addon contracts](/addons/build/contracts#write-an-addon) describes, and export the plugin from `src/preset.ts`:

```ts
import type { Preset } from '@bakers-build/conductor/contract';
import { myExecutor } from './index.js';

export const executors: Preset['executors'] = (acc, opts) => [
  ...acc,
  myExecutor(opts as Parameters<typeof myExecutor>[0]),
];
export const scopes: Preset['scopes'] = ['machine', 'project'];
```

A workspace exports `workspaces` the same way. Declare `['project']` when the addon also has hook listeners.

Then select it in `.bakers/conductor.config.js`, either by listing the addon or by naming the slot:

```js
addons: ['my-executor-addon'],
// or, explicitly, with options:
executor: { plugin: 'my-executor-addon', with: { command: 'codex' } },
workspace: { plugin: '@bakers-build/addon-workspace-git' },
```

A machine may override the executor in `~/.bakers/machine.config.js`; the workspace always stays with the project. `bakers config check` shows which file the executor came from.

## Test it

Test the executor through `startRun` and `cleanupRun` with your tool's CLI replaced by a recording function, as `bakers-cli/addons/herdr-core/tests/executor.test.ts` does. Test a Git workspace against a real temporary repository, as `bakers-cli/addons/workspace-git/tests/` does. The conductor's own suites use `@bakers-build/addon-fake` as both slots.
