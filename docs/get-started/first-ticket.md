# Run the first ticket

**You need:** a [connected project](/get-started/connect-a-project), its selected connection, a ready client and an authenticated agent harness. If a team conductor runs tickets, you can follow its results without starting a local worker.

## AI first: guide the first run

```text
Check this project's configured TUI, agent skills, environment readiness
and conductor. Explain what is missing; reuse working settings. Help me
start the conductor, then use bb-create-ticket for a small documentation
task with checkable criteria. Confirm scope, workflow and assignment
before creating it. Show me the first run and summary.
```

## What happens in the background

The conductor selects the configured agent and skills, opens a ticket worktree in the chosen client, and invokes project hooks. The agent follows `WORKFLOW.md`, checks environment readiness and records a summary. Approval gates still apply. The steps below show the manual equivalent.

## Start the conductor

From the checkout, with the chosen [herdr or Orca client](/configuration/clients) running:

```sh
bakers agents
bakers oven check
bakers oven start
bakers oven status
```

The agent catalog must contain the intended harness; narrow the [machine's agents](/agents/guide) to those installed and authenticated. Status must show your conductor **online**. Keep its configured identity distinct from other workers. [Conductors](/configuration/project/conductors) explains scheduling and served states.

## Create and follow

Ask your agent:

```text
Use bb-create-ticket to write a small documentation ticket for this project,
with checkable acceptance criteria, and assign my online conductor.
```

Confirm the proposed scope and workflow.

Open the ticket on the web or in the terminal:

```sh
bakers ui <IDENTIFIER>
```

Read the **Runs** tab, then the latest `summary`. Questions during execution appear in the run's client terminal; answer there. A comment on the ticket reaches the next step. [Follow a ticket](/get-started/daily-work/follow-a-ticket#where-you-answer) shows where to find questions.

## Verify

**Done when:** the ticket names the intended online conductor, its first run finishes, and a `summary` records that step's result. This is the first-ticket check, not automatic approval of the final implementation.

If nothing starts, check the conductor serves this state, has a free slot, blockers are closed, and the ticket is neither frozen nor failing. Use [Troubleshooting](/configuration/clients/troubleshooting) for the next diagnostic step.

**Next:** [Follow a ticket](/get-started/daily-work/follow-a-ticket), [accept results](/skills-and-workflows/accept-results), or [create another ticket](/get-started/daily-work/create-a-ticket).
