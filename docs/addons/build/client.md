# Connect a new terminal client

Connect a terminal or desktop application that has no Bakers integration yet. Your application hosts agent terminals; a new addon implements the adapter that Bakers uses to start and remove them.

This example defines a small HTTP API for a hypothetical application, **My Client**, and implements its Bakers addon. These endpoints belong to your client runtime, not to the Bakers server. You supply the runtime and its UI; no herdr or Orca adapter is reused.

## Two APIs meet here

**Bakers → addon:** the `ExecutorPlugin` factory returns a `BbExecutor`. Bakers calls `startRun`, `stopRun` and `cleanupRun` during a ticket run.

**Addon → your client:** the adapter translates those calls into HTTP requests. Your runtime starts the terminal, keeps it available after the request returns, and shows it in your application.

The client uses the worktree path Bakers already prepared. Keep the project's existing workspace provider; this example adds no workspace implementation. For a ticket-management application that does not host agents, use the [Bakers connector API](/get-started/connector) instead.

## Define your client's runtime API

The following is the contract this example expects. Implement it in your runtime, or adapt the addon to your existing API.

| Request | Runtime responsibility |
|---|---|
| `PUT /sessions/{id}` | Start the supplied command in a PTY, using `cwd` and adding `env` to the process environment. Apply `label` in the UI. Return 201 only once launch succeeds. |
| Repeated `PUT` with the same ID and body | Return 200 or 204 for the same session; do not start a duplicate. Reject a conflicting body with 409. |
| `DELETE /sessions/{id}` | Stop that session's process tree, wait for exit, remove its terminal and return 204. Return 404 if already absent. Preserve project files and transcripts. |

Every request requires `Authorization: Bearer <token>`. Bind the runtime to `127.0.0.1`; scope session IDs to the authenticated Bakers connection. The runtime must retain or recover its session registry across restarts. Reject unauthorized requests before launching anything.

A start request has this JSON body:

```json
{
  "cwd": "/path/to/ticket-worktree",
  "command": "my-agent --session 'run-id' --prompt 'Work on the ticket'",
  "env": {
    "BB_CONDUCTOR_URL": "http://127.0.0.1:<conductor-port>",
    "BB_CONDUCTOR_TOKEN": "<run-token>"
  },
  "label": "EXAMPLE-1 · working #7"
}
```

`command` is a shell command already built by the harness. Start it through the runtime's shell in `cwd`; pass `env` through the process environment. Neither request bodies nor environment values may appear in access logs. Return non-2xx on launch failures. Closing a UI window must not silently destroy a hosted run.

## Implement the Bakers API

Types live in `@bakers-build/conductor/contract`: `ExecutorPlugin`, `BbExecutor`, `SpawnRunInput` and `SpawnedSession`.

| Method | Meaning |
|---|---|
| `createExecutor(config, { logger })` | Construct the adapter and validate runtime configuration. |
| `capabilities()` | Return `{ persistent: true }` because the terminal outlives the start request. |
| `startRun(input)` | Start `input.command` in `input.workspacePath` with `input.env`; return `{ sessionRef }`. Throw on failure. |
| `stopRun(branch)` | Called before transcript capture. This protocol leaves the idle PTY available until cleanup. |
| `cleanupRun(branch, runId)` | Remove only that run. Missing sessions are harmless; log other failures without throwing. |

Cleanup also runs before dispatch. Derive the same session ID from branch and numeric run ID so a fresh adapter can clean up after a conductor restart. A sibling run gets a different ID. Optional `openWorkspace(path, context)` can present a newly created worktree in your UI; this example does not need it.

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
import { createHash } from 'node:crypto';

export const scopes = ['project'];

export const executors = (acc, options = {}) => [
  ...acc,
  {
    kind: 'executor',
    id: 'my-client',
    requiredModules: [],
    async createExecutor(_config, { logger }) {
      const url = new URL(options.url ?? 'http://127.0.0.1:4170');
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
          url.username || url.password || url.pathname !== '/' ||
          url.search || url.hash) {
        throw new Error('My Client requires a loopback HTTP origin');
      }
      const token = process.env.MY_CLIENT_TOKEN;
      if (!token) throw new Error('MY_CLIENT_TOKEN is required');

      const key = (branch, runId) => createHash('sha256')
        .update(JSON.stringify([branch, runId])).digest('hex');

      async function request(method, id, body) {
        const response = await fetch(new URL('/sessions/' + id, url), {
          method,
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        });
        const expected = method === 'DELETE' ? [204, 404] : [200, 201, 204];
        if (!expected.includes(response.status)) {
          throw new Error('My Client ' + method + ' failed (' + response.status + ')');
        }
      }

      return {
        id: 'my-client',
        capabilities: () => ({ persistent: true }),
        async startRun(input) {
          if (!input.command) throw new Error('An agent command is required');
          const id = key(input.ticket.branchName, input.run.id);
          await request('PUT', id, {
            cwd: input.workspacePath,
            command: input.command,
            env: input.env ?? {},
            label: input.ticket.identifier + ' · ' + input.ticket.state + ' #' + input.run.id,
          });
          return { sessionRef: id };
        },
        async stopRun() {
          // Keep the PTY and transcript until finalization reads the log.
        },
        async cleanupRun(branch, runId) {
          const id = key(branch, runId);
          try {
            await request('DELETE', id);
          } catch {
            logger.warn({ sessionId: id }, 'My Client cleanup failed; check the runtime');
          }
        },
      };
    },
  },
];
```

The token belongs to the runtime connection and comes from the conductor process environment. Each run's separate environment is sent in the JSON body. Requests time out after ten seconds and do not follow redirects.

## Enable and verify

Implement and start your runtime first. Set `MY_CLIENT_TOKEN` in the conductor's environment using your normal secret configuration. Never commit the token.

Replace only the project's previous executor addon entry with:

```js
{ use: './addons/my-client', with: { url: 'http://127.0.0.1:4170' } },
```

Keep the existing remote, agents and workspace settings. Explicit `executor` settings and a machine executor override discovered addons; resolve those settings using [Conductor slots](/addons/slots). Commit the package/configuration, check configuration and restart the conductor.

```sh
bakers config check --scope project --online
bakers oven check
```

Dispatch a disposable ticket. Expect a labelled terminal in **your application**, in that ticket's worktree, receiving the agent command and environment. When the run ends, Bakers captures its transcript before cleanup removes its terminal. The agent must flush its transcript before completing the ticket step.

Then verify two runs in the same branch: finalizing one must leave the other running. Restart the conductor and repeat cleanup. An already missing session is harmless; an unavailable runtime must fail launch and produce a cleanup warning. If a start request times out, inspect its session ID before retrying: it may have started.

To remove the example, restore the previous executor configuration, restart the conductor, and remove only this package. See the [full lifecycle contract](/addons/build/executor-workspace) for workspace and hook responsibilities.
