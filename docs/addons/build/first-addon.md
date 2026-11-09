# Build your first addon

Use addons to make agents available in Bakers, give them project tools, and add operations to tickets. This guide shows what you can build, how to package it, and how to enable it.

## What can you extend?

Start with the capability your project needs:

| You want to… | The addon provides… |
|---|---|
| Use an AI coding program with Bakers | An **agent** integration that starts and configures that program for a run. |
| Control how a ticket's checkout is prepared | A **workspace** integration that creates and manages its working directory. |
| Give agents an additional operation | A **tool** that an agent can call during a run. |
| Let someone request an operation from a ticket | A **message** with a button or form and an answer in the control panel. |

One addon can provide several of these capabilities. It can implement them in JavaScript, reuse other addons with chosen settings, or do both. Reusing addons inside another package is called **composition**.

The [API reference](/addons/build/contracts) describes the supported exports and their contracts.

<span id="what-an-addon-is"></span>

## How Bakers loads an addon

Create a JavaScript package with a **preset**: a module that tells Bakers what the addon provides. List the package in configuration; Bakers imports its preset and registers the declared capabilities. The package can live in your project; publishing it to npm is optional.

| Piece | Purpose |
|---|---|
| `package.json` | Names and versions the package and exposes its entry points. |
| `preset.js` | A module whose named exports declare the addon's capabilities. Bakers calls this module a **preset**. |
| An `addons` configuration entry | Enables the package on a machine or in a project. |

JavaScript's `export` makes a value available to the code importing a module. Bakers recognizes specific export names: for example, `agents` provides agent integrations, `tools` provides callable operations, and `inbox` provides ticket messages. An `addons` export lists other addons to load as part of this package.

The package's `scopes` export declares whether it belongs in machine configuration, project configuration, or both. Agent integrations belong to the machine where their programs run. Project tools and workflows can be enabled for the project that needs them.

## What you will build

Choose an example by the part of Bakers you want to extend:

1. [Add an agent](#add-an-agent): make an agent available for work on your machine.
2. [Add a client](#add-a-client): connect project runs to a terminal application.
3. [Extend the control panel](/addons/build/control-panel): make an operation available from a ticket.

The first two examples package existing integrations and their settings. The control-panel example implements an operation and exposes it as a ticket message. Each shows a different use of the same package-and-preset structure.

Use an existing conductor setup and a disposable project for the client example. You need Node.js, access to the relevant configuration and permission to restart the conductor. Naming a package does not install its underlying application.

## Add an agent

An agent integration tells Bakers how to start an AI coding program for a ticket. It can also expose named configurations, so a run can select an agent with particular settings.

You can write an integration for another program or reuse an existing one. The example below reuses one to show how a package supplies settings and a selectable name.

### Example: configure an existing agent

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

A terminal client lets you see and interact with running agents. To connect one to Bakers, an addon supplies the run infrastructure the client uses: an **executor** manages the agent's terminal, and a **workspace** prepares the ticket's working directory.

There is no `clients` export. The application provides its own UI; the addon connects Bakers to its runtime through the executor and workspace APIs. A package can reuse existing integrations or implement these interfaces for another runtime.

### Example: connect an existing terminal client

This example connects project runs to **herdr-app**. Its executor hosts agent terminals in herdr-core, and its workspace creates each ticket's Git worktree.

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

To let someone call an operation from a ticket, declare a **message**. Bakers displays its button or form and the returned answer. [Extend the control panel](/addons/build/control-panel) explains this connection and walks through a complete example.

## Remove the example

Remove the package's configuration entry and any catalog row referring to it, restart the conductor, then delete only that example package. For the client example, restore the project's previous executor/workspace configuration before dispatching more runs.

## Extend your addon

Use [Tools](/addons/build/tools) for agent operations, [Messages](/addons/build/actions) for ticket requests, and the [executor/workspace API](/addons/build/executor-workspace) for a client integration with its own implementation. Configuration fields and exports are defined in the [Addon API reference](/addons/build/contracts).
