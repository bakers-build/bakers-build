# Run your first ticket

**Describe a small task. Your agent turns it into a ticket and works it on your machine.**

**You need:** a [connected project](/get-started/connect-a-project) and the setup from [Set up bakers.build](/get-started/install) on this machine.

1. **Start your conductor.** The conductor is the part of bakers.build that picks up tickets and starts an agent for each one. Ask your agent, in the project:

   ```text
   Start the bakers.build conductor for this project and tell me when it is online.
   ```

2. **Create the ticket.**

   ```text
   Use bb-create-ticket to write a small documentation ticket for this project, and set my conductor to run it.
   ```

   Your agent asks for anything missing, checks for duplicates and creates the ticket. Your conductor picks it up within seconds.

3. **Watch it move.** Open the ticket in bakers.build in your browser. Each step leaves a short `summary` comment, and the state shows what happens next.

4. **Answer questions.** When the agent needs a decision, it asks in its own terminal tab on your machine, the one your workspace manager opened for this ticket. Answer there and it continues. [Follow a ticket](/daily-work/follow-a-ticket#where-you-answer) explains how to find it.

5. **Review the result.** Read the latest `summary`, check the result and give your verdict. [Accept results](/daily-work/accept-results) shows what to look for.

**Done when:** your ticket shows a `summary` comment from its first step.

::: tip Nothing happens?
Check three things on the ticket page: the ticket names **your** conductor and it shows **online**; no blocking ticket is still open; the header shows no reason such as *frozen*, *no conductor* or *failing*. Still stuck? [Troubleshooting](/advanced/cli/troubleshooting).
:::

## Next

[Daily work](/daily-work/): create, follow and accept tickets with your team.
