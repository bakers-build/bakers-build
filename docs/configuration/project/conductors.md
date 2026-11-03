---
title: Conductors
description: Start, inspect, stop and clean up a conductor, what one polling cycle does, how several conductors share a repository and a host, and how to run one for a team.
---

# Conductors

A conductor is the claim-and-dispatch loop bound to one project checkout: it claims eligible tickets from the control plane and starts one agent run per ticket state.

This page covers the `bakers oven` commands, one polling cycle, logs, several conductors in one repository and a team host. The file that wires a conductor is described in [Conductor configuration](/configuration/project); the per-command flags are in [Conductor commands](/configuration/project/conductor-commands).

## Before you start

Run every command from inside the checkout. A conductor needs:

- the committed `.bakers/conductor.config.js` ([Conductor configuration](/configuration/project));
- a machine file with host identity and capacity ([Machines](/configuration/machine));
- a signed-in connection ([Connections](/configuration/connector/connections));
- herdr installed with a running session, because the herdr executor and workspace start the agent sessions and worktrees;
- the agent harness of your routes, installed and logged in.

A conductor starts without a `WORKFLOW.md`, but then logs a warning and dispatches its runs with no prompt, so the project needs one.

## Commands

| Command | What it does |
|---|---|
| `bakers oven start` | Hands the loop to herdr, waits for the first fresh heartbeat and prints the conductor id, pid and host. |
| `bakers oven status` | One line for this checkout's conductor. |
| `bakers oven ls` | One line for every conductor you own on the control plane, on any machine. |
| `bakers oven stop` | Sends `SIGTERM`; the process POSTs its own `/offline` lifecycle operation on the way out. |
| `bakers oven once` | Runs one cycle and exits. |
| `bakers oven clean` | Tears down the worktrees of finished tickets that were never cleaned up. |

```sh
cd /path/to/your/repo
bakers oven start
bakers oven status
bakers oven stop
```

`start` accepts `--foreground` (run the loop in this process, for a service unit or debugging), `--no-update-check` (skip the daily notice about a newer `@bakers-build/bakers`) and `--force` (stop the running conductor with `SIGTERM`, then `SIGKILL` after a grace period, and start a new one; it fails instead of starting a second conductor when the old one cannot be verified or stopped). `--foreground` moves only the loop: worker sessions still need herdr. Without `--force`, a conductor that is already alive prints `already running` and exits.

`stop --now` sends `SIGKILL` instead. A killed process cannot write `offline`, so the status changes when its lease expires. Stop signals the process itself, so run it on the host where the conductor runs; other hosts refuse. Runs already started keep going in their own herdr tabs. The control plane that protects server-maintained conductor fields needs this CLI: older generic status PATCH callers fail.

`status` and `ls` print tab-separated columns: label, liveness, project, workspace root, conductor id (`<machine_id>-<project>-<variant>`). Liveness is derived the same way in the CLI, in `bakers ui` and on the server:

| Word | Meaning |
|---|---|
| `online` | Heartbeat within the last 10 minutes and the lease not lapsed. |
| `stale` | Not shut down cleanly, but the heartbeat is old or the lease lapsed, for example after a crash. |
| `offline` | The conductor wrote `offline` as it exited cleanly, or a check on this host proves its recorded pid is gone. |

The `bakers ui` Conductors tab shows the same list; see [bakers ui](/addons/bakers-ui/reference). The web UI has two listings: opening the person mark swaps the rail to Account, Conductors (`/user/{user}/conductors`, the conductors assigned to that account) and Machines (`/user/{user}/machines`), and `/{workspace}/project/{key}/conductors` is the conductors assigned to that project (Title search, status and reported load). Opening a row shows Overview at `/{workspace}/conductor/{id}`: Activities, the ticket activities of this conductor's own runs, newest first, with a **Refresh** button, beside one Identity card. An activity counts for a conductor only through its run, never through the ticket's later assignment, so work stays with the conductor and machine that did it; an activity without a run is in no conductor's or machine's feed. Activities list only tickets you may inspect.

The Identity card edits the label with its own **Save** and shows the conductor id, project, machine and owner read-only. The Overview shows none of the conductor's served states, status, last seen and load: the heartbeat writes status, last seen and load, and the served states are set when the conductor first registers and change only through the administrative edit form or the API. Only the owner edits; other readers see the values only. **Disable conductor** and **Enable conductor** below the card change Activity after a confirmation; an inactive conductor can still be online. A conductor is the machine + project + variant, so another machine registers its own conductor id. Disabling stops new assignments and claims and reassigns or clears eligible pending tickets; work already in flight is not cancelled. Enabling restores eligibility without moving tickets back or starting a process. Create, delete, capacity and the full administrative edit form stay under `/admin/bakers/conductor`.

## What a cycle does

The loop repeats every `poll_interval_ms` (default 5000). Each cycle:

1. Heartbeats its registration with its active-run count and reads the host budget.
2. Finalises runs the control plane has closed: captures each transcript and footprint, uploads them and closes the hosted tab.
3. Reaps worktrees of closed tickets that were not cleaned up.
4. Claims tickets one at a time while the host is below `max_parallel`, and dispatches each: it ensures the worktree under `.bakers-worktrees/`, runs the `after_create` hook, lays out a fresh worktree's overview tab, runs `before_run` and starts the agent session detached.

A cycle never writes ticket state; the agent does that. A dispatch error marks that run `failed` with the error; after repeated failures the server parks the ticket behind a circuit breaker.

`once` runs one cycle without looping. With `--log-level debug` it shows whether it claimed, was at capacity or found nothing. It never says why a given ticket was passed over, because an ineligible ticket is simply not a candidate.

## Which tickets it takes

A conductor claims tickets that:

- belong to its project;
- are assigned to it (set on the ticket's create or edit popup in `bakers ui`), or have no workflow yet, in which case any conductor of the project may qualify them;
- are in a claimable state, and in `states` if the config narrows it;
- have no open blockers and no live claim;
- are not frozen.

Eligible tickets are taken by priority (lower value first), then oldest first. Capacity belongs to the host: `max_parallel` in the machine file is shared by every conductor on that host, and the server refuses claims above it. The default is 1 when the machine file sets none.

## Logs

The conductor logs to `.bakers/log.txt` in the checkout and, when it has a terminal, to that terminal. Set the level and sink as flags before the subcommand or as environment variables:

| Flag | Environment | Values |
|---|---|---|
| `--log-level` | `BB_LOG_LEVEL` | `debug`, `info` (default), `warn`, `error` |
| `--log-sink` | `BB_CONDUCTOR_LOG` | `stdout`, `file`, `both` (default on a terminal; `file` otherwise) |

```sh
bakers oven --log-level debug start --foreground
```

Each run's own log and footprint are on the ticket's Runs tab.

## Clean up worktrees

```sh
bakers oven clean
```

Every cycle already reaps, so run this by hand when the conductor was down while tickets closed, was restarted or was reassigned. It is safe at any time.

## Several conductors in one repository

One repository can serve several bakers.build projects, for example a Drupal multisite with a project per site. Put one engine config per project in `.bakers/`:

```
.bakers/
  conductor.config.js         # the default
  shop.conductor.config.js    # stem: shop
  intra.conductor.config.js   # stem: intra
```

A file is a conductor config only if it is exactly `conductor.config.js` or ends in `.conductor.config.js`. Select one per invocation by stem, with the flag before the subcommand; the flag wins over the variable:

```sh
bakers --conductor shop oven start
BB_CONDUCTOR=intra bakers oven status
```

With no selector, `conductor.config.js` is the default; otherwise a lone config is used; otherwise the command fails and lists the stems. `--conductor conductor` names the default explicitly. `BB_CONDUCTOR_CONFIG` may name an exact file instead.

Each config is its own variant (its stem), so each is a separate conductor with its own claims, and `bakers oven ls` lists all of them. When a herdr-hosted conductor starts, it carries its selector along, so it keeps the config you chose.

## Run a conductor for a team

A team host provides execution capacity so project managers need no conductor of their own.

1. Prepare the host: herdr with a running session, the agent harnesses, repository access, and a machine file from `bakers init` (its own `machine_id` UUID and `label`) and a `max_parallel` that fits the hardware ([Machines](/configuration/machine)).
2. Give the host a service identity: a connection with the `client_credentials` profile and a secret kept in an environment variable ([Connections](/configuration/connector/connections)). The identity needs workspace and project access.
3. Clone each project on the host, commit its `.bakers/conductor.config.js`, and start one conductor per checkout with `bakers oven start`. Under a service manager, run `bakers oven start --foreground` with herdr already running.
4. Check `bakers oven ls` from any machine, assign a small ticket to the conductor and confirm a run appears.

If a ticket is not picked up, check its conductor, state and blockers, and the conductor's liveness.

## Command reference

[Conductor commands](/configuration/project/conductor-commands) covers every `bakers oven` option.
