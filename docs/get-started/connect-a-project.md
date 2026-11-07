# Set up a project

Reuse your [prepared machine](/get-started/machine), skills and private connection. Open the repository in your agent; bring its workspace/team names and project access.

<span id="skill-wizard-—-recommended"></span>
<span id="connect-or-reuse"></span>

## AI first: connect this checkout

```text
Use `bakers:bb-init-project` to connect this checkout as a bakers.build project.
Reuse the machine, connection and any existing server project. Explain the TUI and
project-environment choices below, preserving the repository's setup.
Confirm the permission group and exact hook commands with me.
Prepare WORKFLOW.md, check required skills, and show what changed.
```

**Already registered?** Keep the README's project/workspace settings. The AI checks readiness and fills gaps; it must not create a duplicate or reinstall working tools.

## Choose your TUI

Your client organizes agent sessions and worktrees; it does not run the application's services. Choose one supported pair:

| Client | Choose it for |
|---|---|
| [herdr](/addons/herdr) | Terminal tabs and worktrees; the CLI's default wiring |
| [Orca](/addons/orca) | Worktree UI, agent terminals and diff review |

[bakers ui](/addons/bakers-ui) is the ticket cockpit, usable alongside either. Claude/Codex are the agents running inside those sessions.

## Set up your environment

The **environment** runs this repository's application and dependencies. Reuse its README and scripts:

| Environment | Existing project |
|---|---|
| [Docker Compose](/provision/docker-compose) | Compose services |
| [Native Node](/provision/node#node-js-projects) | Node version, lockfile and package scripts |

The AI proposes setup, readiness and cleanup; you confirm exact [hook commands](/provision/hooks). Separate ticket data/ports and test setup twice. Hooks log failures and continue: mandatory readiness belongs in `WORKFLOW.md`. Discovery addons find ports; they do not provision environments.

When agents need the running application for a check, add a [`provision_up`](/provision/hooks#provision-on-an-agent-s-request) command per profile. Agents call it as a tool, and it reuses an environment that is already ready.

## Choose the workflow

Tickets run [`bb_work`](/skills-and-workflows/states); `WORKFLOW.md` supplies project rules. Matt is the shipped recipe. Install every named skill.

## What changes

The skill finds/creates the server project, writes `.bakers/conductor.config.js`, fills `WORKFLOW.md` and checks ignores. Record onboarding choices in README. It does not create the repository. Credentials and `*.local.js` overrides stay private.

::: details Manual equivalent
After resolving the real server project:

```sh
bakers config init --scope project --project <name> --workspace <name>
```

Choose the client's canonical addon configuration, then approved hooks and [workflow rules](/skills-and-workflows/workflow-file). A named connection uses private `.bakers/connection.config.local.js`:

```js
export default { connection: 'team' };
```

Ignore `/assets-ai/`, `/.bakers/log.txt` and `/.bakers/*.local.js`. Commit the conductor file, WORKFLOW and README.
:::

## Verify

```sh
git check-ignore -v assets-ai/probe .bakers/log.txt .bakers/conductor.config.local.js .bakers/connection.config.local.js
bakers config check --scope project --online
bakers info
bakers oven check
```

**Done when:** identities match, skills and client are ready, private files are ignored and application readiness passes.

**Next:** [Run the first ticket](/get-started/first-ticket).
