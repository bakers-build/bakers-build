# Conductor commands

`bakers oven` is the node agent: it registers this machine's conductor for a project checkout, claims tickets and runs agents on them, using the checkout's existing configuration.

This page is the command reference. What a cycle does and how to run several conductors is in [Conductors](/configuration/project/conductors); the config file is in [Conductor configuration](/configuration/project).

## Synopsis

```
bakers [--conductor <name>] oven [--log-level <level>] [--log-sink <sink>] <subcommand>
```

Every subcommand except `ls` works on the conductor of the checkout you stand in, found by walking up from the working directory to a `.bakers/` directory that holds a conductor config. `start`, `once` and `clean` need a signed-in connection and stop with a pointer to `bakers auth login` when there is none.

## Global flags

| Flag | Where | Effect |
|---|---|---|
| `--conductor <name>` | before `conductor` | Select a conductor config by file stem: `conductor` is `conductor.config.js`, anything else `<name>.conductor.config.js`. Environment: `$BB_CONDUCTOR`; the flag wins. |
| `--log-level <level>` | after `oven` | `debug`, `info` (default), `warn` or `error`. Environment: `BB_LOG_LEVEL`. `debug` shows per-poll ticks, claims and idle cycles. |
| `--log-sink <sink>` | after `oven` | `stdout`, `file` or `both`. Default `both` on a terminal, `file` otherwise. `file` and `both` write `.bakers/log.txt` in the checkout. Environment: `BB_CONDUCTOR_LOG`. |

With no `--conductor`, the default is `conductor.config.js`; if that file is absent and exactly one config exists it is used, and with several you must choose or the command lists the stems and stops.

```sh
bakers oven --log-level debug start --foreground
bakers oven --log-level debug once
BB_LOG_LEVEL=debug bakers oven once
```

## Subcommands

| Subcommand | Options | What it does |
|---|---|---|
| `start` | `--foreground`, `--no-update-check`, `--force`, `--adopt <uuid>`, `--new` | Start the conductor loop |
| `once` | none | Run one conductor cycle, then exit |
| `check` | none | Check that every enabled agent can start its sandbox |
| `status` | none | One line for this checkout's conductor |
| `ls` | none | One line per conductor the control plane holds for you |
| `stop` | `--now` | Stop the conductor: graceful by default, hard kill with `--now` |
| `clean` | none | Tear down herdr worktrees of finished tickets that were never cleaned up |
| `tools` | `[name]`, `--data <json\|@file>`, `--schema` | List or call the conductor's addon tools from inside a run |

### start

By default `start` launches the loop in a herdr pane (handle `bakers-conductor:<id>`) and waits until the control plane shows a fresh heartbeat from the new process. It ends with exactly one of three outcomes: **started** (naming the pid and host), **already running** (the live pid and the age of its heartbeat) or **failed** (the reason, with a non-zero exit status). On a host without herdr, run `bakers oven start --foreground` under a service manager such as systemd or Docker.

- `--foreground` runs the loop in this process instead. It refuses to start while a verified live conductor already serves the checkout. Every foreground start, and every CI or non-TTY start, prints an update notice only and never prompts.
- `--no-update-check` skips the lookup, cache, prompt and notice; the version banner still prints.
- When the control plane does not know this conductor's id yet but this machine, project and variant already have a conductor under another id (for example from before the upgrade), `start` asks once in a terminal whether to take it over, or which one when there are several; it keeps its tickets and runs. Without a terminal it stops and names `--adopt <uuid>` (take it over) and `--new` (register another conductor); the two cannot be combined.
- `--force` turns "already running" into a restart: a verified `SIGTERM`, a grace period, then `SIGKILL`, then the normal start. It fails rather than starting a second conductor when the running one cannot be verified or stopped.

An interactive plain start (TTY stdin and stdout, empty `CI`, no `--foreground`) offers to install a newer release and migrate configuration before any lifecycle work. The procedure, decline window, rerun and failure behaviour are in [Update bakers.build](/configuration/machine/updates).

A start on a machine where an enabled agent cannot start its sandbox prints `warning: sandbox unavailable: <agent>: <cause> — <fix>` and still starts; the loop then claims nothing until the cause is fixed (see `check`).

### check

`check` prints one line per enabled agent: `<agent>: sandbox ok`, or `sandbox unavailable: <agent>: <cause> — <fix> (see https://bakers.build/security/execution#sandbox-prerequisites)`. It exits 1 when one agent cannot start its sandbox and needs no sign-in. While that is so, every cycle logs `claims withheld: sandbox unavailable: …` and claims nothing. Prerequisites per platform: [Sandbox prerequisites](/security/execution#sandbox-prerequisites).

### once and clean

`once` registers the conductor, runs a single claim-and-run cycle and exits, which is the tool for diagnosing a conductor that seems idle. `clean` recovers worktrees that a live cycle missed, for example when the conductor was down at `done`, restarted, or the ticket was reassigned.

### stop

`stop` sends `SIGTERM` to the pid recorded on the control plane, after checking that the pid belongs to a conductor process of this host; the exiting conductor writes its own `offline` status. `--now` sends `SIGKILL` instead; a killed process writes nothing, so the status follows when its lease expires. `stop` cannot stop a conductor that runs on another machine. If another record names the same checkout it is reported and left untouched.

### status and ls

Both print tab-separated columns, `status` only for this checkout's conductor and `ls` for every conductor you own, on any machine:

```
<label>	<liveness>	<project>	<workspace_root>	<conductor_id>
```

Liveness is derived, and uses the same three words as the cockpit and the control plane: `online` (heartbeating within its lease), `stale` (registered as online, but the heartbeat is older than 600 seconds or the lease has lapsed, which is what a crash looks like) and `offline` (shut down cleanly). For a conductor on this host whose recorded process no longer exists, the listing reports `offline`. With no conductors, the output is `no conductors on the control plane`. The `bakers oven ls --help` text says "on this machine"; the listing is not limited to it.

### tools

`tools` is the shell route to the conductor's [addon tools](../../addons/build/tools.md) for agents that load no MCP server for them; inside a run, [`bakers tools`](/configuration/clients/tools) takes the same route. It needs no conductor config or connection: it reads `BB_CONDUCTOR_URL` and `BB_CONDUCTOR_TOKEN` from the run environment.

- `bakers oven tools` lists `name<TAB>description`.
- `bakers oven tools <name> --schema` prints the tool's input schema.
- `bakers oven tools <name> --data '<json>'` (or `--data @<file>`) calls it for the run's worktree and prints its result.

| Exit | Meaning |
|---|---|
| 0 | success |
| 1 | the tool reported an error |
| 3 | run token rejected |
| 4 | no conductor tools in this shell, unknown tool or invalid `--data`; nothing called |
| 5 | HTTP or protocol error |

## Environment

| Variable | Effect |
|---|---|
| `BB_CONDUCTOR` | Default for `--conductor` |
| `BB_CONDUCTOR_CONFIG` | Explicit conductor config path; wins over discovery |
| `BB_LOG_LEVEL` | Default for `--log-level` |
| `BB_CONDUCTOR_LOG` | Default for `--log-sink` |

Scoped setup is done by [`bakers config` and `bakers init`](/configuration/clients/cli); `conductor init` no longer exists.
