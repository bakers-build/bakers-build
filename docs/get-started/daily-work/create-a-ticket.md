# Create a ticket

**Tell your agent what you need. It writes a clear ticket with checkable acceptance criteria.**

**You need:** your own account and access to the team's project. You do not need a local checkout to create a ticket on the web or through a connected chat.

::: tip No project access yet?
Ask your team for access. If you are setting up a repository to run agents yourself, start with [Provision](/provision/) and return here when it is connected.
:::

## 1. Create with your agent or on the web

Use either method. A chat client needs a [connector](/get-started/connector); a local coding agent needs the [bakers skills](/skills-and-workflows/skills).

**Ask your agent:**

```text
Use bb-create-ticket for: <what you need and why>.
```

Your agent checks for a similar ticket and asks for missing details. If it finds a match, choose whether to create, extend or drop the idea.

To plan together first, add *and specify it with me*. Agree on the change, acceptance criteria and scope. On your confirmation, the agent writes the plan, moves the ticket to `working` and assigns it to an execution setup, asking you if needed.

**Or use the web:** in the project's ticket list choose **New ticket**, fill in the dialog and choose **Create ticket**. The ticket is saved as typed.

## 2. Choose where the work runs

The ticket's **Conductor** field identifies the setup that runs it. Use your team's entry, or [start your own prepared setup](/get-started/first-ticket#start-the-conductor). Without an assignment, the ticket waits for a person.

## Give your agent

Include enough context to make the result checkable.

| Your agent needs | Example |
|---|---|
| The goal and why it matters | "Customers lose the return URL after login, so they land on the start page." |
| Who notices the result | "Anyone who signs in from a product page." |
| How you will know it is done | "After login I am back on the product page I came from." |
| What is out of scope | "No change to the login form itself." |
| Anything you already decided | "Keep the existing redirect module; fix, don't replace." |

Your agent and bakers.build fill in workflow, labels, identifier and branch. Read the ticket before confirming.

| Created by | Ticket starts in |
|---|---|
| Your agent with `bb-create-ticket` | `plan`, already qualified |
| Your agent with `bb-create-ticket`, specified with you | `working`, with its conductor |
| **New ticket** on the web | `qualification` |

**Done when:** the ticket has an identifier and your criteria. Next: [Follow a ticket](/get-started/daily-work/follow-a-ticket).
