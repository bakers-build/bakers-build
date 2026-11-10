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
bakers conductor check
bakers conductor start
bakers conductor status
```

Confirm the selected agent is signed in. `conductor check` checks whether agents can start their sandboxes; it does not check your application. Status must show your conductor **online**. If checks fail, use [Troubleshooting](/cli/troubleshooting).

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
2. **Open the ticket's Runs tab.** Inspect the latest run, then read its `summary` on the ticket. [Where to answer](/get-started/daily-work/follow-a-ticket#where-you-answer) explains how to respond during team and local work.
3. **Check the first result.** Confirm the intended setup ran the ticket and its summary explains the outcome. This does not automatically approve the final implementation.

<span id="what-happens-in-the-background"></span>

::: details What happens during the run
The conductor starts the selected agent in a ticket worktree: a separate Git checkout. The agent follows `WORKFLOW.md` and records a summary. Configured hooks attempt environment setup; a started run alone does not prove setup succeeded. Required checks and approvals still apply.
:::

## Verify

**Done when:** the first run has finished and you can read its summary. If nothing starts, check the ticket is assigned, unblocked and unfrozen, and its execution setup is online with capacity for this state.

**Next:** [Follow the ticket through to review](/get-started/daily-work/follow-a-ticket).
