# Create a ticket

**Tell your agent what you need. It writes a clear ticket with checkable acceptance criteria.**

**You need:** your own account and permission to create tickets in the team's project. Web and connected-chat creation need no local checkout.

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

With a coding agent, add *and specify it with me* to agree the change, criteria and scope first. An approved feature or chore can enter `working` with its plan and conductor. Bugs enter `plan` for diagnosis. The supplied [chat instructions](/configuration/connector/project-instructions) stop at `plan`.

**Or use the web:** in the project's ticket list choose **New ticket**, fill in the dialog and choose **Create ticket**. The ticket is saved as typed.

## 2. Choose where the work runs

The **Conductor** field identifies the setup that runs the ticket. Use your team's entry, or [start your own prepared setup](/get-started/first-ticket#start-the-conductor). A ticket with a workflow needs an assigned conductor. One without a workflow may be picked up for qualification.

## Give your agent

Include enough context to make the result checkable.

| Your agent needs | Example |
|---|---|
| The goal and why it matters | "Customers lose the return URL after login, so they land on the start page." |
| Who notices the result | "Anyone who signs in from a product page." |
| How you will know it is done | "After login I am back on the product page I came from." |
| What is out of scope | "No change to the login form itself." |
| Anything you already decided | "Keep the existing redirect module; fix, don't replace." |

Read the ticket before approving its specification. For the standard `bb_work` workflow:

| Created by | State after intake |
|---|---|
| Your agent with `bb-create-ticket` | `plan`, already qualified |
| Coding agent, approved feature/chore specification | `working`, with its conductor |
| Coding agent, bug specified with you | `plan`, for diagnosis |
| **New ticket** on the web | `qualification` |

**Done when:** the ticket has an identifier and your criteria. Next: [Follow a ticket](/get-started/daily-work/follow-a-ticket).
