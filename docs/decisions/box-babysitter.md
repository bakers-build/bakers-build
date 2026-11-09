# No babysit agent on bakers-ddev boxes

- **Status:** Approved by the owner 2026-11-09
- **Scope:** bakers-ddev Coder boxes (`coder/bakers-ddev`), their conductors and the PM bot

## Decision

No babysit agent runs on a bakers-ddev box. Each manual repair that operators made from outside a
box belongs in the part of the product that already owns the state the repair touches. That part
gets a ticket if it has none. The template gains no babysitter parameter, process or README
section.

## Placement

| # | Babysitting item | Placement | Reason |
|---|---|---|---|
| 1 | Conductor down after a workspace restart | BAKERS-66 | The box's start script already starts its services (herdr, frpc); BAKERS-66 makes it start the conductors too. |
| 2 | Conductor down after a CLI upgrade (HTTP 426, config migration, `--adopt`) | BAKERS-138 | Restarting the same old binary repairs nothing. The upgrade path itself must migrate the conductor and restart it with adoption. |
| 3 | Agent pane stopped at Claude Code's trust dialog | BAKERS-78 | Conductor runs of Claude Code trust their own ticket worktree, so the dialog does not appear. Clicking through it from outside would hide a regression. |
| 4 | Agent asked a question in its pane instead of on the ticket | BAKERS-83 | Questions go to the requester on the ticket. An outside agent cannot answer for the requester. |
| 5 | Run stalled, or a ticket stays `running` with no pane | BAKERS-139 | The conductor owns its runs and their herdr panes. Only the conductor can tell a lost pane from a slow agent, so it marks the run failed and reports it on the ticket. |
| 6 | Hermes conversation hung ("paused: a previous turn did not finish") | BAKERS-140 | The PM bot's container already restarts when its gateway or poller exits. Recovering a hung session belongs in the same container, in its entrypoint or poller, with a test. |
| 7 | Leftover DDEV sites, tunnels or conductor registration after a cancelled ticket | BAKERS-141, BAKERS-81 | Cleanup of finished tickets (`after_done`) and heartbeats own this. A leftover is a cleanup bug that needs a reproduction, not a sweeper. |
| 8 | Watching runs and telling the requester what happens | BAKERS-64, BAKERS-135 | The PM bot poller already relays ticket changes and technical problems. BAKERS-135 makes those updates more frequent. |

## Rejected alternative

An opt-in babysitter on the box would observe the conductor, panes, runs and the PM bot on an
interval, repair the safe cases and report the rest. It was rejected for two reasons:

- A repairing actor hides product defects that should be fixed where they arise.
- It needs repair permissions of its own on the box.

If gaps remain after the tickets above land, a new ticket can reopen the question with evidence.

## Related

BAKERS-136 (this decision), BAKERS-90 (preview tunnels, the tunnels of item 7).
