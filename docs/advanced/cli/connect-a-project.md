# Connect a project by hand

Connect a repository to bakers.build step by step with the CLI. Most people let their agent do it: [Connect your project](/get-started/connect-a-project).

**You need:** the [installed and signed-in CLI](/advanced/cli/install), a checkout of the repository, permission to create projects on the server, and the workspace, team and project names you agreed.

## Steps

Use the named skills where indicated.

1. Reuse the project if it exists, or create it. Ask your AI to search the server for the name first, then use the `create-project` skill only when nothing matches. It asks for the name, the group the project's permissions come from (select an existing one or create one; it never guesses), the repository, and optionally teams and members. It does not create the git repository itself.

2. Write the checkout's shared configuration. `--workspace` is needed when several workspaces hold a project of that name.

   ```sh
   bakers config init --scope project --project <name> --workspace <name>
   ```

   This creates `.bakers/conductor.config.js` with `bakers.project`, `bakers.workspace` and the herdr execution addons. Optional `--after-create <command>` and `--after-done <command>` set the worktree hooks; leave them out unless your team has provisioning commands (see [Hooks](/advanced/configuration/hooks)).

3. Give the repository a `WORKFLOW.md`. Ask your AI to run `initialize-project` for the project scope: it creates the file from a template, asks which skill set the project uses and checks the ignore rules in step 4. [Write WORKFLOW.md](/skills-and-workflows/write-workflow-md) explains what goes into it.

4. Decide what is committed.

   | Commit | Keep private |
   |---|---|
   | `.bakers/conductor.config.js` | `.bakers/connection.config.local.js`, the connection selector |
   | `WORKFLOW.md` | `.bakers/conductor.config.local.js`, local overrides |
   | The README onboarding entry | `~/.bakers/` (machine file and connections) |
   | | `assets-ai/` and `.bakers/log.txt` |

   Make sure `.gitignore` covers the private paths, and prove it. These lines do:

   ```text
   /assets-ai/
   /.bakers/log.txt
   /.bakers/*.local.js
   ```

   ```sh
   git check-ignore -v assets-ai/probe .bakers/log.txt .bakers/conductor.config.local.js .bakers/connection.config.local.js
   ```

5. Make the skills that `WORKFLOW.md` loads discoverable to the agent, then validate the file. Add `--skills <dir>` for each skill root that is not inside the checkout, such as an installed plugin.

   ```sh
   bakers validate
   ```

   Fix every `FAILED` result before you call the repository ready.

6. Add a short onboarding entry to the README so the next person can join without asking. Name the repository, the workspace and project, the connection name to select and who runs tickets; link to this manual instead of copying it, and never put credentials in it.

7. Verify the result against the server.

   ```sh
   bakers config check --scope project --online
   bakers info
   ```

   `bakers info` prints the resolved project and workspace as JSON; both must be the ones you meant.

**Done when:** the online check passes, `bakers info` names your project and workspace, `bakers validate` reports no failure, and the private files are ignored by git.

## Next

[Run your first ticket](/advanced/cli/first-ticket) in the connected project. Who may run tickets is decided in [Conductors](/advanced/conductors).
