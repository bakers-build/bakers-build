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

Connect a repository on your computer so agents can work on its tickets. A server **project** holds those tickets within your team's **workspace**; your checkout holds the code. This needs your [computer set up](/get-started/#set-up-your-computer).

Ticket identifiers start with the project's **identifier prefix**, such as `SHOP` in `SHOP-42`, derived from the project name. A project editor can change it on the project's **Settings** tab or with `bakers_project_update`; existing tickets keep their identifier and only tickets created afterwards use the new prefix. A prefix that another project's tickets still carry stays reserved.

<span id="skill-wizard-—-recommended"></span>
<span id="connect-or-reuse"></span>

<span id="ai-first-connect-this-checkout"></span>
<span id="1-connect-this-checkout"></span>

## 1. Connect this checkout

Use this skill to set up the project for bakers.build. Start your agent in the checkout, then **Ask your agent:**

::: code-group

```text [Claude Code]
/bakers:bb-init-project
```

```text [Codex]
Use bakers:bb-init-project to connect this checkout.
```

:::

It asks only for what is not yet set up.

<span id="choose-your-tui"></span>
<span id="set-up-your-environment"></span>
<span id="choose-the-workflow"></span>

To change the defaults later, see [Use your client](/get-started/use-your-client), [Prepare a worktree environment](/provision/guide) and [Configure your workflow](/skills-and-workflows/). These are optional for a first ticket.

<span id="verify"></span>
<span id="2-verify-the-connection-and-environment"></span>

## 2. Verify

**Done when:** the skill reports all its checks as passed. It then offers to start the conductor and a first trial ticket.

**Next:** [Run the first ticket](/get-started/first-ticket).

<span id="what-changes"></span>

## What setup writes

- **`.bakers/project.config.js`** names the server project, the client and the skill plugins each run installs. It is committed and the same for everyone. See [Project configuration](/configuration/project).
- **`WORKFLOW.md`** starts with the entry line for the agents and lists the project's checks. See [Configure your workflow](/skills-and-workflows/workflow-file).
- **`.gitignore`** gains three entries for per-run and private files:

```text
/assets-ai/
/.bakers/log.txt
/.bakers/connection.config.js
```

Sign-in and credentials stay private under `~/.bakers`.

<span id="manual-equivalent"></span>

## Without the skill

After creating the server project:

```sh
bakers config init --scope project --project <name> --workspace <name>
```

Ignore `/assets-ai/`, `/.bakers/log.txt` and `/.bakers/connection.config.js`, then commit `.bakers/project.config.js` and `WORKFLOW.md`. [Configuration](/configuration/) explains every setting.
