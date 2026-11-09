# Workflows

Use this overview to understand how ticket state, recipe and project instructions fit together. For setup, start with [Install the skills](/skills-and-workflows/skills) and a connected repository.

Each ticket follows a workflow: a defined set of states and allowed transitions such as `plan`, `working` and `review`. In each state, one skill tells the agent what to do; in the work states that is the ticket's recipe, your engineering method. The `WORKFLOW.md` in your repository adds your runtime, extra skills and checks.

- [How it works](/skills-and-workflows/guide#how-it-works): from a ticket to a finished step.
- [Configure your workflow](/skills-and-workflows/workflow-file): shape `WORKFLOW.md` for your project.
- [Workflows and states](/skills-and-workflows/states): what happens in each state.
- [Ticket type, recipe and labels](/skills-and-workflows/types-recipes-labels): the method, its variant and the agent for a ticket.

::: tip Ask your agent
Explain which state file and recipe run each state of this project's workflow, and check that every skill its WORKFLOW.md names is installed.
:::

## How it works

One run handles one state. A handoff records the outcome; the ticket advances only when its checks and required approvals allow it.

## From ticket to finished step

1. **A conductor picks up the ticket** when the ticket names it, its blockers are closed and a slot is free.
2. **It prepares a workspace** on the ticket's branch and starts an agent there.
3. **The agent reads the ticket** and every comment, then follows `bb-workflow`, which routes it to the state's file and the ticket's recipe.
4. **The run does the work** and asks you whenever a decision is yours.
5. **It leaves a handoff and a `summary`**, then moves the ticket only when the state gate permits. Missing evidence or a required decision can leave the ticket in its current state.

The ticket's state is the progress. [Follow a ticket](/get-started/daily-work/follow-a-ticket) shows where to watch it.

## What your project decides

Every run passes the same seven phases: read, provision, work, validate, deliver, outtake, transition. A run is a grid of state × phase: each state's file in `bb-workflow` has one section per phase, and that section always runs. Two kinds of guidance add **slots** to the cells:

- **The recipe** adds the engineering method to every state, chosen per ticket at qualification ([Ticket type, recipe and labels](/skills-and-workflows/types-recipes-labels)). A slot for one ticket type, such as `bug`, wins over the general one.
- **Your hints** in `WORKFLOW.md` add your runtime, extra skills, checks, merge rules and test users, each under the phase it refines.

The frame, `bb-workflow`, owns state routing and gates. Recipe slots supply the method under the [recipe rules](/skills-and-workflows/recipes#the-rules); they cannot remove approval, verdict or readback requirements. A check that needs the running application calls the [`provision_up`](/configuration/project/hooks#provision-on-an-agent-s-request) tool; your hook command decides how the environment comes up.

Change your way of working with a text edit; no migration needed.

## What bakers.build decides

The states and transitions themselves belong to the bakers.build server. `WORKFLOW.md` cannot add or remove states. Changing them is a change to bakers.build itself.

## Check your setup

Follow [Configure your workflow](/skills-and-workflows/workflow-file) for the entry line, phase hints and installed-skill checks. A missing recipe, state section, declared ticket type or required skill stops a run before work starts.

To add a method, follow [Write a recipe](/skills-and-workflows/recipes).

## Ownership, choices and verification

The server owns workflow states. [Ticket fields](/skills-and-workflows/types-recipes-labels) select the method and agent; no recipe is preselected. The project owns its runtime instructions and checks in `WORKFLOW.md`.

**Done when:** you can identify those three owners for your project and a run's summary names the expected state, checks and remaining decisions.
