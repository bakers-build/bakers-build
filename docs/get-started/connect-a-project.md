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

<span id="skill-wizard-—-recommended"></span>
<span id="connect-or-reuse"></span>

<span id="ai-first-connect-this-checkout"></span>
<span id="1-connect-this-checkout"></span>

## 1. Connect this checkout

This is a prompt for your agent. Start it in the checkout, then **Ask your agent:**

```text
/bakers:bb-init-project
```

Codex: `Use bakers:bb-init-project to connect this checkout.` The skill checks what is already set up, reuses an existing server project and asks only for what is missing.

<span id="choose-your-tui"></span>
<span id="set-up-your-environment"></span>
<span id="choose-the-workflow"></span>

To change the defaults later, see [Use your client](/get-started/use-your-client), [Prepare a worktree environment](/provision/guide) and [Configure your workflow](/skills-and-workflows/guide). These are optional for a first ticket.

<span id="verify"></span>
<span id="2-verify-the-connection-and-environment"></span>

## 2. Verify

**Done when:** the skill, which runs the checks itself, reports the project, your account, the ignored private files and a passing `bakers conductor check`, then offers to start the conductor and a first trial ticket.

**Next:** [Run the first ticket](/get-started/first-ticket).

<span id="what-changes"></span>

## What setup does — an example

The sample is a fresh Git repository with only a `package.json` (a `test` script) and a `README.md`. Running `/bakers:bb-init-project` there and accepting every recommendation, the skill checked the worktree support, set up the server project `docs-example` in workspace `bakers`, chose the herdr-core client and the shipped Matt recipe, derived the check from the `test` script and showed each written file back. It wrote these three files, unchanged:

`.bakers/project.config.js`, committed and the same for everyone:

```js
// @bakers-schema-version 1
// The project's bakers.build configuration — committed and identical for
// everyone. A conductor is this machine (machine.config.js) + this project +
// the variant (project.<name>.config.js). Connections are private files.
//
// Each addon in `addons` fills its slots through its preset: herdr-core
// supplies the executor and brings @bakers-build/addon-workspace-git for the
// worktree. The server comes from the connection,
// by default @bakers-build/addon-remote-drupal.

/** @type {import('@bakers-build/core').ProjectConfig} */
export default {
  schema_version: 1,
  project: { name: "docs-example", workspace: "bakers" },
  // The run budget (max_parallel) is set on the machine in the backend.
  // Transcripts upload only where the server's run-log storage allows it.
  // Set to false to keep this conductor's transcripts local even then.
  // Metrics are unaffected either way.
  capture_logs: true,
  addons: [ { use: "@bakers-build/addon-herdr-core" }],
  // Every run installs exactly these plugins into its own agent home.
  marketplaces: [
    { url: 'https://github.com/bakers-build/bakers-build.git', ref: 'main', plugins: ['bakers'] },
    { url: 'https://github.com/mattpocock/skills.git', ref: 'v1.3.2', plugins: ['mattpocock-skills'] },
  ],
};
```

`WORKFLOW.md`, excerpt: the entry line and the project's check.

```md
# docs-example — WORKFLOW

Invoke `bakers:bb-workflow` and follow it for the ticket's current state.

## bb-phase-validate

| When | Command |
|---|---|
| Any change to `*.js`, `*.mjs` or `package.json` | `npm test` |
```

`.gitignore`, the private and per-run files:

```text
/assets-ai/
/.bakers/log.txt
/.bakers/connection.config.js
```

Sign-in and credentials stay private under `~/.bakers`. [Configuration](/configuration/) explains file ownership and precedence.

<span id="manual-equivalent"></span>

## Without the skill

After creating the server project:

```sh
bakers config init --scope project --project <name> --workspace <name>
```

Ignore `/assets-ai/`, `/.bakers/log.txt` and `/.bakers/connection.config.js`, then commit `.bakers/project.config.js` and `WORKFLOW.md`. [Configuration](/configuration/) explains every setting.
