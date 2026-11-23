# Rex

Run each ticket's agent in its own [Rex](https://www.superlogical.com/rex/) session. Rex is a terminal multiplexer whose server keeps sessions running whether or not a client is attached. Its preset brings [Git workspace](/addons/workspace-git) in project scope.

## AI first

```text
Read https://bakers.build/addons/rex.
Use Rex as this machine's executor. Check `rex version` (0.1.0 or later) and
that `rex ls` reaches the server, propose the machine.config.js executor entry
or a project addon entry and verify it with bakers conductor check.
```

## Setup

Install Rex from [superlogical.com/rex](https://www.superlogical.com/rex/). bakers.build requires `rex` 0.1.0 or later on the conductor's `PATH`.

Run the Rex server as a service, so it keeps running without a client and comes back after a reboot:

```sh
rex server install
rex version
rex ls
```

The executor never starts a Rex server itself: a server started by the conductor would take the run sessions down with it. A run fails at once with an install, upgrade or "server unreachable" message when `rex` is missing, older or its server is not running.

## Configuration

Initialize a project with the executor choice:

```sh
bakers config init --scope project --project <name> --executor @bakers-build/addon-rex
```

Its preset brings `@bakers-build/addon-workspace-git`; no separate worktree entry is needed.
Existing projects can list it in `.bakers/project.config.js`:

```js
addons: [
  '@bakers-build/addon-rex',
],
```

To use it on your machine only, while the project keeps its own executor, set it in `~/.bakers/machine.config.js`:

```js
executor: { use: '@bakers-build/addon-rex' },
```

The machine's executor wins for every project on that machine; the project keeps its workspace and hooks. [Conductor slots](/addons/slots) explains the precedence. No `with` options are required; [Options](#options) lists them.

The executor calls `rex` from the conductor, outside any agent sandbox.

## Options

<!-- @options @bakers-build/addon-rex -->

## Run lifecycle

`startRun` creates one Rex session per run in the worktree (`rex new --cwd <worktree> --shell none`), labelled `<identifier>-<run id> <branch>`. The run's environment travels in a private launch script, never in the command line. `stopRun` does nothing. Cleanup kills (`rex session kill`) only this run's sessions, found by the end of their label and addressed by their session id, so a session with the same label elsewhere is never hit. Run state reaches bakers.build through the agent and the server, as with herdr.

Rex has no workspace of its own and opens no layout. Remote Rex servers (`rex -S`) are not used.

## Verify

Run `bakers conductor check`, then [a first ticket](/get-started/first-ticket). The run appears in `rex ls` as `<identifier>-<run id> <branch>`; a Rex client shows its agent terminal. Close the client: the run keeps working. When the run is finalised, its session ends and disappears from `rex ls`.

Package source in a checkout: `bakers-cli/addons/rex`.
