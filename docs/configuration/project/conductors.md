---
title: Conductors
description: Start, inspect, stop and clean up a conductor, what one polling cycle does, how several conductors share a repository and a host, and how to run one for a team.
---

# Conductors

A conductor is the claim-and-dispatch loop bound to one project checkout: it claims eligible tickets from the control plane and starts one agent run per ticket state.

This page covers the `bakers conductor` commands, one polling cycle, logs, several conductors in one repository and a team host. The file that wires a conductor is described in [Project configuration](/configuration/project); the per-command flags are in [bakers conductor](/cli/conductor).

## Before you start

Run every command from inside the checkout. A conductor needs:

- the committed `.bakers/project.config.js` ([Project configuration](/configuration/project));
- a machine file with host identity and agents ([Machines](/configuration/machine));
- a signed-in connection ([Connections](/configuration/connection));
- a configured [executor and workspace](/addons/slots), with their prerequisites available on this host;
- the agent harness of your routes, installed and logged in.

A conductor starts without a `WORKFLOW.md`, but then logs a warning and dispatches its runs with no prompt, so the project needs one.

## Commands

| Command | What it does |
|---|---|
| `bakers conductor start` | Starts the loop as a detached background process that logs to `.bakers/log.txt`, waits for the first fresh heartbeat and prints the conductor id, pid and host. |
| `bakers conductor status` | One line for this checkout's conductor. |
| `bakers conductor ls` | One line for every conductor you own on the control plane, on any machine. |
| `bakers conductor stop` | Sends `SIGTERM`; the process POSTs its own `/offline` lifecycle operation on the way out. |
| `bakers conductor once` | Runs one cycle and exits. |
| `bakers conductor clean` | Tears down the worktrees of finished tickets that were never cleaned up. |

```sh
cd /path/to/your/repo
bakers conductor start
bakers conductor status
bakers conductor stop
```

**Done when:** `status` reports this conductor online and a small assigned ticket starts a run. Stop the conductor on the host where it runs; already-started agent sessions may continue.

[bakers conductor](/cli/conductor#start) owns start/restart flags, [restart on change](/cli/conductor#restart-on-change) and graceful versus hard stop. Its [status reference](/cli/conductor#status-and-ls) defines the columns and online/stale/offline states.

The `bakers ui` Conductors tab shows the same list; see [bakers ui](/addons/bakers-ui/reference). The web UI has two listings: opening the person mark swaps the rail to Account, Conductors (`/user/{user}/conductors`, the conductors assigned to that account) and Machines (`/user/{user}/machines`), and `/{workspace}/project/{key}/conductors` is the conductors assigned to that project (Title search, status and reported load). Opening a row shows Overview at `/{workspace}/conductor/{id}`: Activities, the ticket activities of this conductor's own runs, newest first, with a **Refresh** button, beside one Identity card. An activity counts for a conductor only through its run, never through the ticket's later assignment, so work stays with the conductor and machine that did it; an activity without a run is in no conductor's or machine's feed. Activities list only tickets you may inspect.

The Identity card edits the label and the served states with its own **Save** and shows the conductor id, project, machine and owner read-only. The Overview shows none of the conductor's status, last seen and load: the heartbeat writes them. The served states are set when the conductor first registers and change on the card or through the API. Only the owner edits; other readers see the values only. **Disable conductor** and **Enable conductor** below the card change Activity after a confirmation; an inactive conductor can still be online. A conductor is the machine + project + variant, so another machine registers its own conductor id. Disabling stops new assignments and claims and reassigns or clears eligible pending tickets; work already in flight is not cancelled. Enabling restores eligibility without moving tickets back or starting a process. The heartbeat creates a conductor; **Delete** on its Overview opens `/{workspace}/conductor/{id}/delete`. Capacity is the machine's **Max parallel**, edited on the machine's Overview.

## What a cycle does

The loop repeats every `poll_interval_ms` (default 5000). Each cycle:

1. Heartbeats its registration with its active-run count and reads the host budget.
2. Finalises runs the control plane has closed: records the footprint, uploads the transcript only when [run-log storage policy](/self-hosting/server#run-log-storage) allows it, and closes the hosted tab.
3. Reaps worktrees of closed tickets that were not cleaned up.
4. Claims tickets one at a time while the machine is below its run budget, and dispatches each: it ensures the worktree under `.bakers-worktrees/`, prepares it through [`after_create`](/configuration/project/hooks#when-each-hook-runs) when needed, lays out a fresh worktree's overview tab, runs `before_run` and starts the agent session detached.

A cycle never writes ticket state; the agent does that. A dispatch error marks that run `failed` with the error; after repeated failures the server parks the ticket behind a circuit breaker until it [is restarted](/addons/bakers-ui/tickets#restart-a-parked-ticket) or 2 hours pass.

`once` runs one cycle without looping. With `--log-level debug` it shows whether it claimed, was at capacity or found nothing. It never says why a given ticket was passed over, because an ineligible ticket is simply not a candidate.

## Which tickets it takes

A conductor claims tickets that:

- belong to its project;
- are assigned to it (set on the ticket's edit popup in `bakers ui`), or have no workflow yet, in which case any conductor of the project may qualify them;
- are in a claimable state, and in `states` if the config narrows it;
- have no open blockers and no live claim;
- are not frozen.

Eligible tickets are taken by priority (lower value first), then oldest first. Capacity belongs to the machine: its run budget (`max_parallel`) is set in the backend on the machine form, starts at 5 for a new machine, is shared by every conductor on that host, and the server refuses claims above it. A conductor reads it on every tick, so a change needs no restart; when the machine row cannot be read, it claims nothing that tick.

## Logs

Read `.bakers/log.txt` in the checkout. For one diagnostic cycle:

```sh
bakers conductor --log-level debug once
```

[Logging flags and defaults](/cli/conductor#global-flags) are in the command reference.

The ticket's Runs tab shows the footprint and any transcript stored under the server policy.

## Clean up worktrees

```sh
bakers conductor clean
```

Every cycle already reaps, so run this by hand when the conductor was down while tickets closed, was restarted or was reassigned. It runs the configured cleanup commands; check their resource scope and preserve needed data first.

## Several conductors in one repository

One repository can serve several bakers.build projects, for example a Drupal multisite with a project per site. Put one engine config per project in `.bakers/`:

```
.bakers/
  project.config.js           # the default
  project.shop.config.js      # variant: shop
  project.intra.config.js     # variant: intra
```

Select a variant by its name:

```sh
bakers --conductor shop conductor start
```

[Selector precedence](/cli/conductor#global-flags) and the [project variant reference](/configuration/project#named-variants) define discovery and fallback.

Each file is its own variant, so each is a separate conductor with its own claims, and `bakers conductor ls` lists all of them. When a detached conductor starts, it carries its selector along, so it keeps the config you chose.

## Run a conductor for a team

A team host provides execution capacity so project managers need no conductor of their own.

1. Prepare the host: herdr with a running session, the agent harnesses, repository access, and a machine file from `bakers init` (its own `machine_id`, a UUID for a new machine, and `label`) ([Machines](/configuration/machine)); after its first start, set the machine's run budget in the backend to fit the hardware.
2. Give the host a service identity: a connection with the `client_credentials` profile and a secret kept private ([Connections](/configuration/connection)). The identity needs workspace and project access.
3. Clone each project on the host, commit its `.bakers/project.config.js`, and start one conductor per checkout with `bakers conductor start`. Under a service manager, run `bakers conductor start --foreground`; start herdr first when its executor runs the agent sessions.
4. Check `bakers conductor ls` from any machine, assign a small ticket to the conductor and confirm a run appears.

If a ticket is not picked up, check its conductor, state and blockers, and the conductor's liveness.

## Command reference

[bakers conductor](/cli/conductor) covers every `bakers conductor` option.
