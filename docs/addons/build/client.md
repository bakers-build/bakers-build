# Connect a new terminal client

Make bakers.build run agents in your terminal application. The addon receives a command and a worktree path from bakers.build, asks your application to open an agent terminal, and closes that terminal when the run is finished.

Herdr, herdr-core and Orca use this pattern through local CLIs. This guide implements a **new** adapter for a hypothetical `my-client` CLI. Replace its two commands with your application's API; you do not need to build an HTTP server for the addon.

<span id="two-apis-meet-here"></span>
<span id="define-your-client-s-runtime-api"></span>

## Your client's API

The example expects two commands. Each reads one JSON object from standard input:

| Command | JSON input | Your application does |
|---|---|---|
| `my-client start --json-stdin` | `{ branch, runId, cwd, command, env }` | Open a terminal in `cwd`, run `command` through its shell with `env` added, then exit 0 once launch is confirmed. |
| `my-client close --json-stdin` | `{ branch, runId }` | Stop that run's process tree and remove its terminal. Exit 0 when closed or already absent. |

The application owns the terminal after the CLI exits. It remembers the **branch and run ID**, so a fresh addon instance can close the correct terminal after a conductor restart. Repeating `start` for the same run must not create another terminal. Scope that identity to the client's configured bakers.build connection.

Pass commands and environment values through stdin, not command-line arguments or logs: they may contain secrets. The client must report failures with a nonzero exit, keep transcripts on disk, and leave the worktree and other runs untouched.

<span id="implement-the-bakers-api"></span>

## The bakers.build API {#the-bakers-api}

Your package exports an `executors` preset. Its `ExecutorPlugin` factory returns a `BbExecutor`:

| bakers.build calls | Your adapter does |
|---|---|
| `startRun(input)` | Forward the command, environment and worktree to `my-client start`; return a session reference. |
| `stopRun(branch)` | Leave the idle terminal available while bakers.build captures the agent's transcript. |
| `cleanupRun(branch, runId)` | Call `my-client close` for that run; warn if cleanup fails. |

This follows Herdr's lifecycle: the agent flushes its transcript before completing the ticket step; closing its terminal happens after capture. bakers.build also calls cleanup before dispatch to remove a leftover terminal. Types are exported from `@bakers-build/conductor/contract`.

## Create the package

Create `.bakers/addons/my-client/package.json` in a disposable project:

```json
{
  "name": "example-my-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./preset.js",
  "exports": {
    ".": "./preset.js",
    "./preset": "./preset.js"
  }
}
```

Create `.bakers/addons/my-client/preset.js`:

```js
import { execFile } from 'node:child_process';

function client(action, data) {
  return new Promise((resolve, reject) => {
    const failed = () => reject(new Error('my-client ' + action + ' failed'));
    const child = execFile('my-client', [action, '--json-stdin'],
      { timeout: 10_000 }, error => error ? failed() : resolve());
    child.stdin.on('error', failed);
    child.stdin.end(JSON.stringify(data));
  });
}

export const scopes = ['project'];
export const executors = acc => [
  ...acc,
  {
    kind: 'executor',
    id: 'my-client',
    requiredModules: [],
    async createExecutor(_config, { logger }) {
      return {
        id: 'my-client',
        capabilities: () => ({ persistent: true }),
        async startRun(input) {
          if (!input.command) throw new Error('An agent command is required');
          await client('start', {
            branch: input.ticket.branchName,
            runId: input.run.id,
            cwd: input.workspacePath,
            command: input.command,
            env: input.env ?? {},
          });
          return { sessionRef: input.ticket.branchName + '#' + input.run.id };
        },
        async stopRun() {
          // Keep the terminal until bakers.build has captured the transcript.
        },
        async cleanupRun(branch, runId) {
          try {
            await client('close', { branch, runId });
          } catch {
            logger.warn({ branch, runId }, 'my-client cleanup failed');
          }
        },
      };
    },
  },
];
```

The small `client()` helper sends JSON to the CLI and rejects failed or timed-out calls. It does not include the client's output in errors, because that output could echo secrets. `{ persistent: true }` tells bakers.build the agent lives in a hosted terminal.

## Enable and verify

Make your client's CLI available on the conductor's `PATH`. In the project's `addons` array, replace its previous executor entry with:

```js
{ use: './addons/my-client' },
```

Keep the existing agents, server and worktree provider: bakers.build already supplies the worktree. If an explicit `executor` setting or machine executor overrides the addon, adjust it as described in [Conductor slots](/addons/slots). Commit the package/configuration, check configuration and restart the conductor:

```sh
bakers config check --scope project --online
bakers conductor check
```

Dispatch a disposable ticket. Its agent should appear in your application, inside the ticket's worktree. Test two runs: finishing one must close only its terminal. Restart the conductor and check cleanup again. An absent terminal is harmless; a failed launch must fail the run, and a failed cleanup must warn. After a timeout, inspect the run in your client before retrying: it may have started.

The example defines the adapter, not a terminal application. You supply the real CLI and terminal hosting. Restore the previous executor configuration before removing the example package.

## Real implementations

- [herdr-core](/addons/herdr-core): the smallest shipped client adapter; starts `hc run` and finds terminals by branch/run labels. See `bakers-cli/addons/herdr-core/src/index.ts`.
- [Herdr](/addons/herdr): adds workspaces, tabs and pane layouts. See `bakers-cli/addons/herdr/src/index.ts`.
- [Orca](/addons/orca): adopts worktrees and creates/closes terminals through the Orca CLI. See `bakers-cli/addons/orca/src/index.ts`.

The [executor/workspace contract](/addons/build/executor-workspace) covers the full lifecycle. To build a ticket-management app that does not host agents, use the [bakers.build connector API](/get-started/connector).
