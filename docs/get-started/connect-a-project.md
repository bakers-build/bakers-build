---
prev:
  text: Get started
  link: /get-started/
next:
  text: Run the first ticket
  link: /get-started/first-ticket
---

<span id="set-up-a-project"></span>
<span id="set-up-your-project"></span>

# Prepare your project

Connect a repository on your computer so agents can work on its tickets. A server **project** holds those tickets within your team's **workspace**; your checkout holds the code.

**You need:** a local Git checkout, [a bakers.build account](https://app.bakers.build/) with workspace access, and [Claude Code](/addons/claude#setup) or [Codex](/addons/codex#setup) signed in.

::: tip This checkout is already connected?
Run the [verification below](#verify). If it passes, continue with [your first ticket](/get-started/first-ticket); do not create another project.
:::

<span id="skill-wizard-—-recommended"></span>
<span id="connect-or-reuse"></span>

<span id="ai-first-connect-this-checkout"></span>
<span id="1-connect-this-checkout"></span>

## 1. Connect this checkout

Make sure the [bakers skills](/skills-and-workflows/skills) are available in your agent. In the checkout, ask it to set up the project. It checks existing settings and guides you through missing prerequisites before making changes.

```text
Use `bakers:bb-init-project` to connect this checkout as a bakers.build project.
Check local tools and sign-in, and guide me through anything missing.
Reuse this environment, connection and any existing server project. Ask which
client I want to use unless I already chose one or the project has one configured.
Check the project’s setup commands.
Confirm the permission group and exact hook commands with me.
Prepare WORKFLOW.md, check required skills, and show what changed.
```

<span id="choose-your-tui"></span>
<span id="set-up-your-environment"></span>
<span id="choose-the-workflow"></span>

### Review the project setup

Start with the client, application environment and workflow. Keep existing settings and use these guides when you need to change them.

<DocTiles :tiles="[
  { title: 'Use your client', text: 'Choose how you observe, discuss and act on ticket work with herdr-cli, herdr-app, Orca or Hermes. Keep working project settings.', link: '/get-started/use-your-client', icon: 'terminal', meta: 'Explore clients →' },
  { title: 'Prepare your environment', text: 'The environment runs your application and dependencies. Reuse your project scripts and make them work independently in each ticket worktree.', link: '/provision/guide', icon: 'layers', meta: 'Prepare the environment →' },
  { title: 'Configure your workflow', text: 'WORKFLOW.md supplies project rules and checks. Keep the existing recipe, or start with the shipped Matt recipe.', link: '/skills-and-workflows/guide', icon: 'book', meta: 'Understand workflows →' }
]" />

Return here after any changes. Before starting agents, install every skill the workflow names and review [tools and security](/provision/guide#check-tools-and-access).

<span id="what-changes"></span>

::: details What changes

The skill resolves the server project, prepares `.bakers/project.config.js` and `WORKFLOW.md`, and checks ignores. Credentials and a project `.bakers/connection.config.js` stay private. [Configuration](/configuration/) explains file ownership and precedence.
:::

::: details Manual equivalent
After resolving the real server project:

```sh
bakers config init --scope project --project <name> --workspace <name>
```

Choose the project's [executor and worktree](/addons/slots), then approved hooks and [workflow rules](/skills-and-workflows/workflow-file). Select a named connection with `--connection team` or `BAKERS_CONNECTION=team`.

Ignore `/assets-ai/`, `/.bakers/log.txt` and `/.bakers/connection.config.js`. Commit the project file, WORKFLOW and README.
:::

<span id="verify"></span>
<span id="2-verify-the-connection-and-environment"></span>

## 2. Verify the connection and environment

Confirm that this checkout points to the intended project and is ready for a ticket.

```sh
git check-ignore -v assets-ai/probe .bakers/log.txt .bakers/connection.config.js
bakers config check --scope project --online
bakers info
bakers conductor check
```

The online check verifies sign-in; confirm project access separately. `conductor check` tests agent sandbox startup. Use your project's workflow checks to establish application readiness.

**Done when:** project and account are correct, required skills are available, private files are ignored and the project's readiness checks pass.

**Next:** [Run the first ticket](/get-started/first-ticket).
