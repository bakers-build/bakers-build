---
prev:
  text: Prepare your project
  link: /get-started/connect-a-project
next:
  text: Follow a ticket
  link: /get-started/daily-work/follow-a-ticket
---

# Run the first ticket

Run a small task from your [prepared project](/get-started/connect-a-project) and read its first result. This guide runs the agent on your computer.

<span id="choose-where-the-work-runs"></span>
<span id="use-the-team-setup"></span>

::: tip Your team already runs tickets?
Use the team's entry in the ticket's **Conductor** field and skip to [Create and follow](#create-and-follow). Your team handles startup.
:::

<span id="start-the-conductor"></span>
<span id="start-your-local-setup"></span>

## Start your agents

In your local checkout, check the signed-in agent and the configured terminal host: herdr-cli's session, herdr-app's herdr-core host, or Orca's runtime. [Use your client](/get-started/use-your-client) explains each view. Start ticket execution:

```sh
bakers agents
bakers oven check
bakers oven start
bakers oven status
```

The catalog must contain an installed, authenticated agent and status must show your setup **online**. If checks fail, use [Troubleshooting](/configuration/clients/troubleshooting) before creating the ticket.

<span id="ai-first-guide-the-first-run"></span>

::: details Let your agent guide startup
```text
Check this project's configured client, agent skills and environment.
Reuse working settings. Help me start its conductor and verify that it is online.
```
:::

## Create and follow

Follow these steps with either setup. If you already have a suitable ticket, reuse it.

1. **[Create a ticket](/get-started/daily-work/create-a-ticket)** for a small documentation change. State the expected result and select the execution entry identified above.
2. **Open the ticket's Runs tab.** Read the latest `summary`. Questions during a run appear in its terminal; a ticket comment reaches the next step. [Where to answer](/get-started/daily-work/follow-a-ticket#where-you-answer) explains both team and local work.
3. **Check the first result.** Confirm the intended setup ran the ticket and its summary explains the outcome. This does not automatically approve the final implementation.

<span id="what-happens-in-the-background"></span>

::: details What happens during the run
The selected agent works in a ticket worktree, follows `WORKFLOW.md` and records a summary. Project hooks prepare the environment; required checks and approval gates still apply.
:::

## Verify

**Done when:** the first run has finished and you can read its summary. If nothing starts, check the ticket is assigned, unblocked and unfrozen, and its execution setup is online with capacity for this state.

**Next:** [Follow the ticket through to review](/get-started/daily-work/follow-a-ticket).
