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

<span id="run-agents-for-a-project"></span>
<span id="from-ticket-to-result"></span>

## How it works

The path of one ticket:

1. You write a **ticket** with checkable acceptance criteria in a **project** of your **workspace** on the bakers.build server.
2. A **conductor** on a **worker machine** (your computer or a remote worker) claims it: see [which tickets it takes](/configuration/project/conductors#which-tickets-it-takes) and [where agents run](/provision/machine).
3. It starts a coding **agent**, Claude Code or Codex under your own sign-in ([Agents](/agents/)).
4. The agent writes a spec and plan and waits for your approval ([Workflows and states](/skills-and-workflows/states)).
5. Each attempt is a **run** in its own **worktree**, a separate Git checkout, within [Agent permissions and isolation](/agents/security).
6. An agent reviews the change, then you review the summary and merge request ([Accept results](/skills-and-workflows/accept-results)).
7. You authorize the merge.

<span id="choose-where-the-work-runs"></span>
<span id="use-the-team-setup"></span>

<span id="start-the-conductor"></span>
<span id="start-your-local-setup"></span>

## Start your agents

If you confirmed the start at the end of project setup, the conductor already runs. Otherwise, in your checkout with the configured terminal host running ([Use your client](/get-started/use-your-client)):

```sh
bakers agents
bakers conductor check
bakers conductor start
bakers conductor status
```

Confirm the selected agent is signed in. `conductor check` checks whether agents can start their sandboxes; it does not check your application. Status must show your conductor **online**. If checks fail, use [Troubleshooting](/cli/troubleshooting).

## Create and follow

Follow these steps with either setup. If you already have a suitable ticket, reuse it.

1. **[Create a ticket](/get-started/daily-work/create-a-ticket)** for a small documentation change. State the expected result and select the execution entry identified above. Project setup proposes one you can take as it is: "Document how to run the tests in README.md", which adds a *Running tests* section with the commands that run the test suite locally.
2. **Open the ticket's Runs tab.** Inspect the latest run, then read its `summary` on the ticket. [Where to answer](/get-started/daily-work/follow-a-ticket#where-you-answer) explains how to respond during team and local work.
3. **Check the first result.** Confirm the intended setup ran the ticket and its summary explains the outcome. This does not automatically approve the final implementation.

<span id="what-happens-in-the-background"></span>

The agent follows `WORKFLOW.md`. Configured hooks attempt environment setup; a started run alone does not prove setup succeeded.

## Verify

<span id="ai-first-guide-the-first-run"></span>

::: details Let your agent guide startup
**Ask your agent:**

```text
Check this project's configured client, agent skills and environment.
Reuse working settings. Help me start its conductor and verify that it is online.
```
:::

**Done when:** the first run has finished and you can read its summary. If nothing starts, check the ticket is assigned, unblocked and unfrozen, and its execution setup is online with capacity for this state.

**Next:** [Follow the ticket through to review](/get-started/daily-work/follow-a-ticket).
