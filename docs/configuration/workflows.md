# Workflows

**Your project decides how agents work. bakers.build keeps every ticket on track.**

Each ticket follows a workflow: a fixed series of states such as `plan`, `working` and `review`. In each state, one skill tells the agent what to do; in the work states that is the ticket's recipe, your engineering method. The `WORKFLOW.md` in your repository adds your runtime, extra skills and checks.

- [How it works](/configuration/workflows#how-it-works): from a ticket to a finished step.
- [Configure your workflow](/configuration/workflows/workflow-file): shape `WORKFLOW.md` for your project.
- [Workflows and states](/configuration/workflows/states): what happens in each state.
- [Ticket type, recipe and labels](/configuration/workflows/types-recipes-labels): the method, its variant and the agent for a ticket.

::: tip Ask your agent
Explain which state file and recipe run each state of this project's workflow, and check that every skill its WORKFLOW.md names is installed.
:::

## How it works

**One state, one run, one frame. Every step ends with a summary and the next state.**

## From ticket to finished step

1. **A conductor picks up the ticket** when the ticket names it, its blockers are closed and a slot is free.
2. **It prepares a workspace** on the ticket's branch and starts an agent there.
3. **The agent reads the ticket** and every comment, then follows `bb-workflow`, which routes it to the state's file and the ticket's recipe.
4. **The run does the work** and asks you whenever a decision is yours.
5. **It leaves a handoff and a `summary`**, then moves the ticket to the next state. That ends the run; the next state starts a new one.

The ticket's state is the progress. [Follow a ticket](/get-started/daily-work/follow-a-ticket) shows where to watch it.

## What your project decides

Every run passes the same seven phases: read, provision, work, validate, deliver, outtake, transition. A run is a grid of state × phase: each state's file in `bb-workflow` has one section per phase, and that section always runs. Two kinds of guidance add **slots** to the cells:

- **The recipe** adds the engineering method to every state, chosen per ticket at qualification ([Ticket type, recipe and labels](/configuration/workflows/types-recipes-labels)). A slot for one ticket type, such as `bug`, wins over the general one.
- **Your hints** in `WORKFLOW.md` add your runtime, extra skills, checks, merge rules and test users, each under the phase it refines.

The frame, `bb-workflow`, holds the state files and the rules every run keeps; recipes and hints never own gates, comments or transitions. A check that needs the running application calls the [`provision_up`](/configuration/provisioning/hooks#provision-on-an-agent-s-request) tool; your hook command decides how the environment comes up.

Change your way of working with a text edit; no migration needed.

## What bakers.build decides

The states and transitions themselves belong to the bakers.build server. `WORKFLOW.md` cannot add or remove states. Changing them is a change to bakers.build itself; see [Development](/configuration/project/contributing#index).

## Check your setup

Ask your agent:

```text
Check that this project's WORKFLOW.md starts with the bb-workflow entry line, that every skill it names is installed, and name the installed recipes.
```

A missing recipe, recipe section or required skill, or a state without a state file, stops a run before it changes anything, naming what is missing.

The rules for writing your own recipe or runtime guide are in the [skill contract](/configuration/project/contributing#skill-contract).

## Ownership, choices and verification

Every work ticket runs `bb_work`. Its recipe/type fields choose the engineering method/variant; Matt is the shipped default. The required repository entry is `WORKFLOW.md` invoking `bakers:bb-workflow`; its phase hints are optional and apply when the project needs them.

Minimal file:

```md
# Project — WORKFLOW

Invoke `bakers:bb-workflow` and follow it for the ticket's current state.
```

Add your actual setup/checks using the [workflow file reference](/configuration/workflows/workflow-file). Install every named skill and recipe. Verify the entry line, installed skill names and selected ticket workflow, then inspect a first run's summary for the intended state and gates. Missing required skills stop the run.
