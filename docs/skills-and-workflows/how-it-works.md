# How it works

**One state, one run, one skill. Every step ends with a summary and the next state.**

## From ticket to finished step

1. **A conductor picks up the ticket** when the ticket names it, its blockers are closed and a slot is free.
2. **It prepares a workspace** on the ticket's branch and starts an agent there.
3. **The agent reads the ticket** and every comment, then follows `bb-workflow`, which names the one skill that owns this state.
4. **The skill does the work** and asks you whenever a decision is yours.
5. **It leaves a handoff and a `summary`**, then moves the ticket to the next state. That ends the run; the next state starts a new one.

The ticket's state is the progress. [Follow a ticket](/daily-work/follow-a-ticket) shows where to watch it.

## What your project decides

Every run passes the same six phases: read, provision, work, validate, deliver, transition. Four kinds of guidance plug into them:

- **The frame**, `bb-workflow`, routes the state to its owner and holds the rules every run keeps.
- **The recipe** owns `plan`, `working` and `review`. It is the engineering method, chosen per ticket at qualification ([Ticket type, recipe and labels](/skills-and-workflows/labels-and-work-types)).
- **A runtime guide**, such as `bb-runtime-ddev`, says how to provision, run, lint and test in one technology. It is provisioned only when the work needs it.
- **Your hints** in `WORKFLOW.md` add your runtime, extra skills, checks and merge rules, each under the phase it refines.

Change your way of working with a text edit; no migration needed.

## What bakers.build decides

The states and transitions themselves belong to the bakers.build server. `WORKFLOW.md` cannot add or remove states. Changing them is a change to bakers.build itself; see [Development](/advanced/development/).

## Check your setup

Ask your agent:

```text
Check that this project's WORKFLOW.md starts with the bb-workflow entry line, that every skill it names is installed, and name the installed recipes.
```

A missing recipe, recipe section or required skill stops a run before it changes anything, naming what is missing.

The rules for writing your own recipe or runtime guide are in the [skill contract](/advanced/development/skill-contract).
