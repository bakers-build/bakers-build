# Tickets in the terminal

Follow, answer and freeze tickets with the CLI. The agent route is in [Daily work](/get-started/#after-your-first-ticket).

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

Each visit to a state is one run: a claim, a worktree, an agent session in a herdr tab named `<identifier> · <state> #<run>`, and a state write that ends it. The ticket's **Runs** tab lists them; `Enter` opens one with its log and footprint (tokens, turns, tool calls).

| Run state | Meaning |
|---|---|
| `claimed` | lease granted, agent not started |
| `running` | agent session is up |
| `done` | the state write retired the run |
| `expired` | the lease ran out before the agent started; the ticket is claimable again |
| `failed` | dispatch threw (worktree hook, missing executor); the cause is in the run's error log |
| `cancelled` | a person cancelled it in the terminal UI or on the ticket page, a person or agent cancelled it with the `bakers_run_cancel` tool, or the ticket's conductor changed; the conductor stops the agent on its next tick; the tool and a conductor change put the cause in the run's error log |

One `bb_activity` row per event: `created`; `status_changed` with the step's summary and any closed run and its conductor; `claimed` for the first run outside qualification only; `run_ended` for a `failed`, `expired` or `cancelled` run; `assigned`, `review_requested` and `review_completed` when the assignee changes, a reviewer is added or a review is submitted (they can also be [mailed to you](/configuration/connector/notifications)). Later claims, unchanged saves, heartbeats and `done` runs add none. Visibility follows ticket view.

```sh
bakers tools tool_api__bakers_ticket_activity_list --data '{"ticket":"<identifier>","limit":20}'
```

Pass `project` (key or UUID) instead of `ticket` for a whole project's feed, and `offset` with the returned `next_offset` for the next page. Clients cannot write these rows. The tool reference is [bakers tools](/configuration/clients/tools).

## Answer a waiting agent

A step that needs a decision asks in its herdr tab and stops. On the machine that runs the conductor, find the tab and answer there:

```sh
herdr tab list
```

A run that shows `running` with no new comment is usually a blocked tab nobody has looked at. A comment you add on the ticket reaches the next run, not a run that is already waiting.

## Freeze a ticket

```sh
bakers tools tool_api__bakers_ticket_update --data '{"ticket":"<identifier>","frozen":true}'
```

In the terminal UI, press `f` on the ticket; `"frozen":false` or `f` again releases it. Freezing a whole project or machine is `bakers oven stop`.

The conductor that holds the ticket's worktree notices the change on its next poll and:

- runs the [`on_freeze` or `on_resume` hook](/configuration/provisioning/hooks#when-each-hook-runs) once in that worktree;
- marks the worktree's herdr workspace with the display-only token `bb_frozen`, and clears it on unfreeze.

herdr shows the token in its left-hand sidebar once a row names it. Add it to `~/.config/herdr/config.toml`:

```toml
[ui.sidebar.spaces]
rows = [["state_icon", "workspace", "$bb_frozen"], ["branch", "git_status"]]
```

A ticket without a worktree on that machine gets no hook and no marker. The conductor records the frozen tickets it has seen in `.bakers/<config name>.frozen.json` beside its config, so a restart or a one-shot `bakers oven once` does not repeat `on_freeze`, and a ticket unfrozen while the conductor was down gets its `on_resume` on the next poll.

`on_resume` runs whenever a ticket leaves the conductor's frozen list, so closing or reassigning a frozen ticket whose worktree still exists runs it too. A conductor follows its first 50 frozen tickets; any beyond that get no hooks. The server records the freeze time in `frozen_at`; clients cannot write it.

## Blockers, parents and branches

- **Blocked by.** A ticket is not dispatched while any ticket in `blocked_by` is open.
- **Parent.** A sub-ticket's base branch is its parent's branch; otherwise it is the project's default branch. It is computed, never set.
- **Carrier ticket.** To base several tickets on a long-lived branch, create one ticket whose `branch_name` is that branch (writable only at creation) and hang the real tickets under it.

A work ticket runs `bb_work`, or [`bb_autopilot`](/configuration/workflows/autopilot) when its approvals should be automatic. A deployment or a verification is a ticket with the type `deployment` or `verification` and its recipe.
