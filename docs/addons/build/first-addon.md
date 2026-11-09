# Build your first addon

Build two small JavaScript packages: **Add an agent** gives your machine a named Claude agent; **Add a client** connects a project's runs to herdr-app. Both examples compose shipped adapters, so you can learn the package and preset API with working integrations.

For a button you can call from a ticket, follow [Extend the control panel](/addons/build/control-panel): an **Is dirty?** check of the ticket's worktree.

## What an addon is

An addon extends an application through its extension API. In bakers.build, it is an ordinary **JavaScript package**: a directory containing `package.json` and JavaScript modules. It can be local or installed; publishing it to npm is optional.

| Piece | Purpose |
|---|---|
| `package.json` | Names and versions the package and exposes its entry points. |
| `preset.js` | A module whose named exports declare the addon's capabilities. Bakers calls this module a **preset**. |
| An `addons` configuration entry | Tells Bakers to load the package in machine or project configuration. |

JavaScript's `export` makes a value available to the module's importer. The conductor imports the preset and reads the exports its API recognizes. Here, `export const addons` lists other addons to load. This is called **composition**: your package bundles existing integrations and their settings.

Other presets export implementations through `agents`, `executors`, `workspaces`, `tools` or `inbox`; see the [API reference](/addons/build/contracts). These examples reuse the shipped implementations.

## What you will build

1. [Add an agent](#add-an-agent): a machine-scoped package with a `review` agent alias.
2. [Add a client](#add-a-client): a project-scoped package selecting the executor and workspace for herdr-app.

Use an existing conductor setup and a disposable project for the client example. You need Node.js, access to the relevant configuration and permission to restart the conductor. Naming a package does not install its underlying application.

## Add an agent

Make a `review` alias backed by Claude's `sonnet` model. The shipped Claude addon must be available to your Bakers installation; [install and authenticate Claude Code](/addons/claude#setup) as the conductor user first.

<span id="create-two-files"></span>

Create `~/.bakers/addons/review-agent/package.json`:

```json
{
  "name": "example-review-agent",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./preset.js",
  "exports": { ".": "./preset.js", "./preset": "./preset.js" }
}
```

Create `~/.bakers/addons/review-agent/preset.js`:

```js
export const scopes = ['machine'];

export const addons = [
  {
    use: '@bakers-build/addon-claude',
    with: { model: 'sonnet' },
    alias: 'review',
  },
];
```

`"type": "module"` enables JavaScript imports/exports. The package's `"./preset"` entry points to the file Bakers imports. Its `addons` export loads the Claude preset; `with` supplies options and `alias` names its single custom candidate. `scopes` says where your package may be configured.

Append `'./addons/review-agent'` to the existing `addons` array in `~/.bakers/machine.config.js`. The path resolves from that file. Keep the other machine settings.

If you maintain an explicit `agents.catalog`, add this entry to its existing array:

```js
{ harness: './addons/review-agent', alias: 'review' },
```

Keep any alias filters consistent with `review`; see [agent selection](/agents/guide). Check machine configuration and restart the conductor:

```sh
bakers config check --scope machine --online
bakers agents
```

Expect `review` backed by harness `claude`. On a disposable ticket, select `agent:review` and dispatch a run. The adapter starts Claude with the configured model; your package does not install Claude or grant model access.

This adds a named configuration of an existing agent. Supporting a new agent program requires its own `AgentPlugin` / `BbAgent` implementation.

## Add a client

Connect the project's runs to **herdr-app**. Its integration needs two contributions: an **executor** hosts agent terminals in herdr-core, and a **workspace** creates each ticket's Git worktree. There is no `clients` export; you supply these capabilities to the conductor. The application itself provides the client UI.

Follow [herdr-core setup](/addons/herdr-core#setup) first and make `hc` available on the conductor's `PATH`. The shipped herdr-core and Git workspace addons must be available to Bakers. Use the [client guide](/get-started/use-your-client#herdr-app) to connect herdr-app to the same local runtime.

Create `.bakers/addons/project-client/package.json` in your disposable project:

```json
{
  "name": "example-project-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./preset.js",
  "exports": { ".": "./preset.js", "./preset": "./preset.js" }
}
```

Create `.bakers/addons/project-client/preset.js`:

```js
export const scopes = ['project'];

export const addons = [
  '@bakers-build/addon-herdr-core',
  '@bakers-build/addon-workspace-git',
];
```

This package composes the two adapters with their defaults. It contributes neither a remote connection nor an agent; keep those existing settings.

<span id="enable-in-project"></span>

In `.bakers/conductor.config.js`, replace the previous executor/workspace addon entries with `'./addons/project-client'`. Keep unrelated addons and project identity. Explicit `executor` or `workspace` settings override addon contributions; a machine `executor` also wins. Resolve those competing selections deliberately in this disposable setup, following [Conductor slots](/addons/slots).

Commit the package and configuration, validate them, then restart the conductor:

```sh
bakers config check --scope project --online
bakers oven check
```

Dispatch a disposable ticket with an available agent. Expect a Git worktree and a herdr-core terminal visible in `hc ls` and herdr-app. Stopping the run must end its terminal; closing the app alone leaves the terminal running. See [herdr-core verification](/addons/herdr-core#verify) for the lifecycle checks.

This composes an existing client integration. A new terminal host needs an `ExecutorPlugin` / `BbExecutor`; a different worktree lifecycle needs a `WorkspacePlugin` / `BbWorkspace`. Their [contract and cleanup obligations](/addons/build/executor-workspace) go beyond composing this package.

## Verify

Use each example's configuration check before dispatch. A successful configuration check proves loading and validation; a disposable run proves that the underlying agent or client works on your machine. Check [conductor logs](/configuration/project/conductor-commands) if loading fails.

## Add a ticket message

An agent or client integration does not automatically add a ticket button. Continue with [Extend the control panel](/addons/build/control-panel) to implement **Is dirty?** through `tools` and `inbox`.

## Remove the example

Remove the package's configuration entry and any catalog row referring to it, restart the conductor, then delete only that example package. For the client example, restore the project's previous executor/workspace configuration before dispatching more runs.

## Extend your addon

Use [Tools](/addons/build/tools) for agent operations, [Messages](/addons/build/actions) for ticket requests, and the [executor/workspace API](/addons/build/executor-workspace) for a client integration with its own implementation. Configuration fields and exports are defined in the [Addon API reference](/addons/build/contracts).
