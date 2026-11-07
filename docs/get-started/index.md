# Get started

## Before you start

Choose where the **conductor**, which launches agents, will run: your developer computer or a remote worker server. Both use the same installation model. Install tools, sign in to providers and make repository credentials and application resources available on that execution machine; installing them on your laptop does not prepare a remote worker.

A worker runs agents and worktrees. The **bakers.build application server** stores tickets and accounts; using a remote worker does not require self-hosting that server. Use an existing instance or see [Self-hosting](/self-hosting/).

You need an account and workspace access. Then:

1. [Connect chat](/get-started/connector) if you want chat access.
2. [Prepare your execution machine](/get-started/machine); [Provision](/provision/) covers remote workers.
3. [Connect a project](/get-started/connect-a-project).
4. [Run your first ticket](/get-started/first-ticket).

## How it works

You describe work in a **ticket**. A **conductor** picks it up, starts an agent in a Git worktree, and records a summary after each **state**. You decide at approval gates.

A **workspace** contains your team and projects; a **project** identifies a repository. **Skills** supply instructions. The repository's `WORKFLOW.md` names project setup, standards and checks; the ticket's **recipe** selects the engineering method. [Workflows](/skills-and-workflows/guide) explains the complete process.

## After your first ticket

[Create](/get-started/daily-work/create-a-ticket), [follow](/get-started/daily-work/follow-a-ticket), [accept](/skills-and-workflows/accept-results) or [freeze](/get-started/daily-work/freeze-a-ticket) a ticket. Check [team work](/get-started/daily-work/team-overview), [record time](/get-started/daily-work/record-time), or configure [email notifications](/configuration/connector/notifications).
