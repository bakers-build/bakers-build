# Run tickets from the terminal

Open a bakers.build project checkout, create a small ticket, let a conductor work it and read the result.

**You need:** the [installed and signed-in CLI](/advanced/cli/install), a checkout of a repository that is already a bakers.build project, and the bakers.build skills in your IDE. To run tickets on your own machine you also need herdr and a logged-in agent harness such as Claude Code or Codex.

1. Clone the project repository and open it in your IDE. Read its README and `WORKFLOW.md`; the README should name the workspace, project and connection to use.

2. If you use a named connection, select it for this checkout. Create `.bakers/connection.config.local.js`, which holds one literal connection name and stays out of git:

   ```js
   export default { connection: 'team' };
   ```

3. Check the checkout against the server.

   ```sh
   bakers config check --scope project --online
   ```

   It must resolve the project in the intended workspace. If two workspaces hold a project of that name, the committed `bakers.workspace` in `.bakers/conductor.config.js` decides.

4. Create a small ticket with clear acceptance criteria. Ask your AI to use the `create-ticket` skill, or press `n` in the terminal cockpit:

   ```sh
   bakers ui
   ```

   In the popup, **Create with agent** (`Ctrl+S`) interviews you for what is missing; **Create directly** (`Ctrl+D`) writes the ticket as typed. The conductor field is preselected with your own; clearing it leaves the ticket waiting for a human.

5. Make sure something will run it.
   - **A team conductor runs it.** Nothing to do; skip to step 6. PMs normally stop here.
   - **Your machine runs it.** Check the prerequisites, then start the conductor from the checkout:

     ```sh
     herdr --version
     herdr workspace list
     bakers agents
     bakers oven start
     bakers oven status
     ```

     `herdr workspace list` needs a running herdr session; start one with `herdr`. `bakers agents` prints the agent catalog as JSON and must list at least one agent. A fresh machine file lists every alias of the Claude, Codex and Grok addons and names no default route; narrow it as described in [Agents and models](/advanced/configuration/agents-and-models). The status line shows your conductor as `online`.

6. Watch the run. Open the ticket in the cockpit and use its **Runs** tab:

   ```sh
   bakers ui <IDENTIFIER>
   ```

   Each state is one run. When the agent needs a decision it asks in its herdr tab (`herdr tab list` shows them); answer there. When a run ends, the agent leaves a handoff comment and a `summary` comment and moves the ticket to its next state.

7. Read the `summary` comment on the ticket. It is the result of that state; [Follow a ticket](/daily-work/follow-a-ticket) explains the comment types and [Accept results](/daily-work/accept-results) how to judge them.

**Done when:** a run for your ticket appears, finishes, and the ticket carries a `summary` comment.

::: tip Ask your AI
"Use create-ticket to write a small documentation ticket for this project, then show me how to follow it."
:::

## If nothing starts

Check that the ticket names a conductor that is `online` and serves the ticket's state, that its blockers are closed and that the conductor has a free slot. [Troubleshooting](/advanced/cli/troubleshooting) has the checklist; [Conductors](/advanced/conductors) explains which tickets a conductor takes.

## Next

[Connect a project by hand](/advanced/cli/connect-a-project) if your own repository is not a bakers.build project yet; otherwise [Daily work](/daily-work/).
