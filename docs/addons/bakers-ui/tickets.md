# Tickets in the terminal

Follow, answer and freeze tickets with the CLI. Use a signed-in connection with ticket access. The agent route is in [Daily work](/get-started/#after-your-first-ticket).

## Read a ticket

The terminal UI's Overview tab leads with the latest `summary`:

```sh
bakers ui <identifier>
```

`bakers ui <identifier> | cat` prints the same sections as text. The full record with every comment, through the `bakers_ticket_read` tool that every agent run starts with:

```sh
bakers tools tool_api__bakers_ticket_read --data '{"ticket":"<identifier>"}'
```

## Runs

A run is one execution attempt for a ticket state: a claim, a worktree and an agent session hosted by the configured executor. A state may have retries. The ticket's **Runs** tab lists them; `Enter` opens one with its log and footprint (tokens, turns, tool calls).

| Run state | Meaning |
|---|---|
| `claimed` | lease granted, agent not started |
| `running` | agent session is up |
| `done` | the state write retired the run |
| `expired` | the lease ran out before the agent started; the ticket is claimable again |
| `failed` | dispatch failed (for example, a worktree or executor error); lifecycle-hook failures alone are logged best-effort; the cause is in the run's error log |
| `cancelled` | a person cancelled it in the terminal UI or on the ticket page, a person or agent cancelled it with the `bakers_run_cancel` tool, or the ticket's conductor changed; the conductor stops the agent on its next tick; the tool and a conductor change put the cause in the run's error log |

One `bb_activity` row per event: `created`; `status_changed` with the step's summary and any closed run and its conductor; `claimed` for the first run outside qualification only; `run_ended` for a `failed`, `expired` or `cancelled` run; `assigned`, `review_requested` and `review_completed` when the assignee changes, a reviewer is added or a review is submitted (they can also be [mailed to you](/configuration/guides/notifications)). Later claims, unchanged saves, heartbeats and `done` runs add none. Visibility follows ticket view.

```sh
bakers tools tool_api__bakers_ticket_activity_list --data '{"ticket":"<identifier>","limit":20}'
```

Pass `project` (key or UUID) instead of `ticket` for a whole project's feed, and `offset` with the returned `next_offset` for the next page. Clients cannot write these rows. The tool reference is [bakers tools](/cli/tools).

## Answer a waiting agent

Open the active run in the [client hosting it](/get-started/use-your-client) and answer in that agent session. For herdr-cli, use `herdr tab list`; herdr-app and Orca have their own terminals.

A quiet run may be working or waiting: inspect its session and error log. Ticket comments become context for the next run; they do not automatically answer an already waiting agent.

## Freeze a ticket

```sh
bakers tools tool_api__bakers_ticket_update --data '{"ticket":"<identifier>","frozen":true}'
```

In the terminal UI, press `f` on the ticket; `"frozen":false` or `f` again releases it. To stop one conductor, use `bakers conductor stop`; this does not set ticket freeze flags or stop every conductor on a machine.

Freezing ends the ticket's active run: the server cancels it with the note `frozen by <account>`. The conductor that holds the ticket's worktree notices the change on its next poll and:

- stops the cancelled run's agent and keeps the worktree;
- runs the [`on_freeze` or `on_resume` hook](/provision/hooks#when-each-hook-runs) once in that worktree;
- marks the worktree's herdr workspace with the display-only token `bb_frozen`, and clears it on unfreeze.

herdr shows the token in its left-hand sidebar once a row names it. Add it to `~/.config/herdr/config.toml`:

```toml
[ui.sidebar.spaces]
rows = [["state_icon", "workspace", "$bb_frozen"], ["branch", "git_status"]]
```

A ticket without a worktree on that machine gets no hook and no marker. The conductor records the frozen tickets it has seen in `.bakers/<config name>.frozen.json` beside its config, so a restart or a one-shot `bakers conductor once` does not repeat `on_freeze`, and a ticket unfrozen while the conductor was down gets its `on_resume` on the next poll.

`on_resume` runs whenever a ticket leaves the conductor's frozen list, so closing or reassigning a frozen ticket whose worktree still exists runs it too. A conductor follows its first 50 frozen tickets; any beyond that get no hooks. The server records the freeze time in `frozen_at`; clients cannot write it.

## Restart a parked ticket

A ticket is **parked** when its 3 most recent runs all failed and the newest of them changed within the last 2 hours, typically because the environment did not start (DDEV, credentials, the host). Conductors skip it and its Stall reads `failing`. It becomes claimable again by itself 2 hours after the last failure, or at once with a restart.

Once the cause is fixed, open the ticket page and choose **Restart ticket** in the Properties footer, or cancel through the tool:

```sh
bakers tools tool_api__bakers_run_cancel --data '{"ticket":"<identifier>","reason":"environment fixed"}'
```

A restart sets the newest failed run to `cancelled`, so the 3 most recent runs are no longer all failed and the next claim succeeds. Every run stays with its error log; the tool appends the reason to that run's log. Restart needs update access to the ticket and is offered only while the ticket is parked; on a ticket that is neither parked nor running, the tool refuses and changes nothing. Three new failures park the ticket again.

## Blockers, parents and branches

- **Blocked by.** A ticket is not dispatched while any ticket in `blocked_by` is open.
- **Parent.** A sub-ticket's base branch is its parent's branch; otherwise it is the project's default branch. It is computed, never set.
- **Carrier ticket.** To base several tickets on a long-lived branch, create one ticket whose `branch_name` is that branch (writable only at creation) and hang the real tickets under it.

Every ticket runs the one workflow `bb_work`. A deployment or a verification is a ticket with the type `deployment` or `verification` and its recipe.
