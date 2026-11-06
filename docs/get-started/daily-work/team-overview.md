# See what the team works on

**One look tells you which tickets move, which wait, and what each run consumed.**

**You need:** access to the workspace.

## On the web

| Where | What you see |
|---|---|
| Workspace **Stats** | Closed tickets, runs and token spend for the last 24 hours, 7 and 30 days, with trends. |
| A project's ticket list | Every ticket with state, assignee, conductor and, when it stands still, the reason: *frozen*, *blocked*, *no conductor* or *failing*. |
| A ticket's **Runs** | One row per step that ran. Open a run for its footprint: tokens, agent turns, tool calls. |
| **Team → Time** | Recorded hours of the team's members, for team leads. |

## Ask your agent

```text
Read the open tickets of this project as bb-workflow's references/read-ticket.md describes and tell me which ones wait for a person.
```

## Reading the numbers

- A run's **tokens** are what the agent's model consumed for that step; your provider bills them under your own subscription.
- **Runs per closed ticket** shows how many steps a ticket took; it is not a success rate.
- A ticket in a running step with no new comment for a while usually waits for an answer in its terminal tab ([where you answer](/get-started/daily-work/follow-a-ticket#where-you-answer)).

**Done when:** you know which tickets need a person and which run on their own.

What each figure measures: [Ticket metrics](/configuration/workflows/metrics).
