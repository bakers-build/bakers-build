# How it works

**One state, one run, one skill. Every step ends with a summary and the next state.**

## From ticket to finished step

1. **A conductor picks up the ticket** when the ticket names it, its blockers are closed and a slot is free.
2. **It prepares a workspace** on the ticket's branch and starts an agent there.
3. **The agent reads the ticket** and every comment, then loads the one skill that owns this state.
4. **The skill does the work** and asks you whenever a decision is yours.
5. **It leaves a handoff and a `summary`**, then moves the ticket to the next state. That ends the run; the next state starts a new one.

The ticket's state is the progress. [Follow a ticket](/daily-work/follow-a-ticket) shows where to watch it.

## What your project decides

`WORKFLOW.md` loads skills and gives them your rules: method, extra skills, checks, setup and standards. Change your way of working with a text edit; no migration needed.

Every step-owning skill names the work type, workflow and step it owns. For each combination your project can produce, exactly one loaded skill must match. The work type comes from the ticket's `work:*` label ([Labels and work types](/skills-and-workflows/labels-and-work-types)). A ticket with several work types gets one owner per type; they run in load order and the last one moves the ticket.

## What bakers.build decides

The states and transitions themselves belong to the bakers.build server. `WORKFLOW.md` cannot add or remove states. Changing them is a change to bakers.build itself; see [Development](/advanced/development/).

## Check your setup

Ask your agent:

```text
Check that this project's WORKFLOW.md is valid and name the owner of every step.
```

It reports `OK` with the owners, or the first thing to fix: a step without an owner, two owners for one step, or an unknown setting. The command behind it: [`bakers validate`](/advanced/cli/#other-setup-commands).

The rules for writing your own step skill are in the [skill contract](/advanced/development/skill-contract).
