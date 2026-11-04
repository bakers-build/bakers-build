# Create a ticket

**Tell your agent what you need. It writes a clear ticket with checkable acceptance criteria.**

**You need:** a [connected project](/get-started/connect-a-project).

1. **Ask your agent.**

   ```text
   Use bb-create-ticket for: <what you need and why>.
   ```

   Your agent checks whether a similar ticket exists, asks for anything missing and creates the ticket. If it finds a match, you decide: create anyway, extend that ticket or drop the idea.

   To work the idea out together first, add *and specify it with me*. Your agent then asks you only about the content, until you agree on what changes, how you will know it is done and what stays out. On your yes it writes the plan, and the ticket runs on its own.

2. **Or use the web.** In the project's ticket list choose **New ticket**, fill in the dialog and choose **Create ticket**. The ticket is saved as typed.

3. **Decide who works it.** Name the conductor that should run it: yours, or a teammate's. The first step starts within seconds. Without a conductor, the ticket waits for a person.

## Give your agent

| Your agent needs | Example |
|---|---|
| The goal and why it matters | "Customers lose the return URL after login, so they land on the start page." |
| Who notices the result | "Anyone who signs in from a product page." |
| How you will know it is done | "After login I am back on the product page I came from." |
| What is out of scope | "No change to the login form itself." |
| Anything you already decided | "Keep the existing redirect module; fix, don't replace." |

Everything else, such as workflow, labels, identifier and branch, your agent and bakers.build fill in. Ask your agent to read the ticket back to you before you confirm.

| Created by | Ticket starts in |
|---|---|
| Your agent with `bb-create-ticket` | `plan`, already qualified |
| Your agent with `bb-create-ticket`, specified with you | `working`, ready to run on its own |
| **New ticket** on the web | `qualification` |

**Done when:** the ticket has an identifier and your criteria. Next: [Follow a ticket](/get-started/daily-work/follow-a-ticket).
