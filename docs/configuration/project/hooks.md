# Lifecycle hook configuration

Configure project preparation and cleanup in the top-level `hooks` object of the selected `.bakers/project.config.js` or a named variant `project.<name>.config.js`. This reference is for maintainers who already have a working conductor; [Add lifecycle hooks](/provision/hooks) explains the practical setup.

## Configuration

All six lifecycle keys are optional shell command strings. An omitted or empty command does nothing. Keep existing engine settings and merge only the needed keys:

```js
// Fragment inside the exported project configuration.
hooks: {
  after_create: 'sh scripts/prepare.sh',
  before_run: 'sh scripts/refresh.sh',
  after_run: 'sh scripts/stop-sidecar.sh',
  after_done: 'sh scripts/cleanup.sh',
  on_freeze: 'sh scripts/pause.sh',
  on_resume: 'sh scripts/resume.sh',
},
```

These scripts are examples you must supply. Commands run through `sh -c` in the ticket worktree with the conductor user's permissions. Tools must be on that process's `PATH`. Keep long-running servers out of blocking hooks. Hooks execute worktree code outside the agent sandbox: review that code before giving it credentials or host access.

A selected variant is a complete file, not an overlay. Local values apply only through explicit JavaScript imports. The herdr addon's former `with.hooks` option is rejected; move commands to the top level. Addon listeners run before the project command, awaited in addon discovery order (children first). Listener failures do not skip later listeners or the command.

## When each hook runs

| Hook | Runs | Use for |
|---|---|---|
| `after_create` | On a dispatch that created the worktree or finds no recorded successful preparation; retried on later dispatches until successful | One-time setup |
| `before_run` | After `after_create` (and a fresh worktree's opening layout), before the agent starts | Quick refresh, launch env |
| `after_run` | After an ended run's worker stopped, before the run is closed; at once when a launch fails | Stopping a run's sidecar |
| `after_done` | During cleanup of a finished ticket, before the worktree is removed | Releasing local resources |
| `on_freeze` | Once when a poll sees the ticket [frozen](/get-started/daily-work/freeze-a-ticket), in its worktree on this machine | Stopping local services |
| `on_resume` | Once when a poll sees it unfrozen | Restarting them |

The successful preparation record survives conductor restarts and is cleared during cleanup. Changing the setup command alone does not invalidate it. A failed close write repeats `after_run`, so tolerate repetition. If the worktree directory is gone, `after_run` and `after_done` run nothing.

## Environment

`after_create`, `before_run`, `on_freeze` and `on_resume` inherit the conductor's environment plus resolved run values. Dispatch hooks filter ticket variables through the selected agent's environment policy; freeze/resume hooks use the default deny list because they have no run agent. Reserved core names cannot be overridden:

| Variable | Value |
|---|---|
| `BB_URL` | Server URL of the selected connection |
| `BAKERS_ID` | Ticket UUID |
| `BAKERS_TICKET_IDENTIFIER` | Ticket identifier |
| `BAKERS_STATE` | Run's start state; current state for freeze hooks |
| `BAKERS_RUN_UUID` | Current run UUID; unset for freeze hooks |
| `BAKERS_TUNNEL` | `1` if the machine allows preview tunnels, else `0` |
| `WORKSPACE_ROOT` | Checkout root; the working directory is the ticket worktree |
| `TICKET_URL` | Origin issue URL, when there is one |
| `BAKERS_PROJECT`, `BAKERS_PROJECT_ID` | Project name and UUID, when known |
| `BAKERS_WORKSPACE`, `BAKERS_WORKSPACE_ID` | Ticket workspace name and UUID, when known |
| `BAKERS_WORKSPACE_IDS` | Comma-separated reachable workspace UUIDs |

Optional values are omitted rather than empty. `after_run` rebuilds its context from the current ticket while keeping the run start state; if that read fails, listeners are skipped and the shell hook runs without the rebuilt variables. The `after_done` shell command receives only the inherited conductor environment, with no ticket/run variables injected. Store and validate a worktree-local resource identity for cleanup. Never log environment secrets.

## Failure behavior

Lifecycle commands and listeners are best effort. Failures are logged (`lifecycle hook failed` or `hook listener failed`), and dispatch or cleanup continues. A failed `after_create` is retried on a later dispatch; it does not block the current agent. Required readiness and validation gates belong in `WORKFLOW.md`. Verify the resulting environment rather than treating a successful dispatch as proof of setup.

## Provision on an agent's request

`provision_up` never runs on its own. The conductor offers it to runs as the [tool](/addons/build/tools#shipped-tools) `provision_up(profile?)`, so a sandboxed agent can bring its environment up without trusting the runtime's CLI. An agent calls it before a check that needs a running environment, with the profile your `WORKFLOW.md` `bb-phase-provision` hint names. The value is one command string, or a map of profile names to command strings. Omitted means the tool is unavailable. With a string, `profile` is optional and ignored; with a map it must name a configured key. A missing or unknown profile fails. The agent picks a profile, never the command:

```js
hooks: {
  provision_up: {
    test: 'sh scripts/provision.sh test',
    'test-fresh': 'sh scripts/install.sh test',
  },
},
```

Agents call it whenever a check needs the environment, so make the command cheap to repeat. It follows this contract:

| The environment is | The command |
|---|---|
| running the requested profile, and its base URL answers | changes nothing, prints the base URL and exits 0 |
| stopped, with the requested profile installed | starts it, checks the URL and prints it |
| missing, or running another profile | installs the requested profile, checks the URL and prints it |
| failing to install, or its URL does not answer | exits non-zero with its output |

The base URL *answers* when it returns an HTTP status below 500, so a site that fails with 500 is not ready. A profile that must start from a clean install every time, such as a disposable import check, gets its own key whose command always reinstalls (`test-fresh` above). The conductor runs the command as configured and checks nothing itself; a command that always reinstalls still works, it is only slower. A runtime addon's page may show one implementation.

It runs through `sh -c` in the run's worktree with the inherited conductor environment, without injecting the run's `BAKERS_*` or ticket variables. It outlives cancellation of the calling agent. Overlapping calls for the same worktree and command share the running process, even when different profile names select that command. A call after completion starts it again; different commands can run concurrently, so scripts must protect shared resources.

At 30 minutes, ticket teardown or conductor shutdown, the conductor sends `SIGTERM` to the process group. It does not escalate to `SIGKILL`; commands must handle termination. The result retains the tail of combined stdout/stderr, capped at 65,536 string characters. A non-zero exit is a tool error. Unlike lifecycle hooks, the caller sees this failure directly. No profile runs automatically, and the conductor neither checks application health nor validates the printed URL.

## Verify

Run `bakers config check --scope project`, then execute the selected preparation command twice in a disposable worktree and observe one ticket dispatch. Confirm the expected files/services, readiness, and cleanup of that worktree only. The config check alone does not execute commands or prove their safety.

For addon implementation, see [hook listeners](/addons/build/contracts#surfaces-and-extension-points). For tunnel cleanup, see [Ports](/addons/ports).
