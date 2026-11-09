# Build your first addon

Use addons to make agents available in Bakers, give them project tools, and add operations to tickets. This guide shows what you can build, how to package it, and where to implement each integration.

## What can you extend?

Start with the capability your project needs:

| You want to… | The addon provides… |
|---|---|
| Use an AI coding program with Bakers | An **agent harness** that translates between Bakers and your program's launch and transcript APIs. |
| Control how a ticket's checkout is prepared | A **workspace** integration that creates and manages its working directory. |
| Give agents an additional operation | A **tool** that an agent can call during a run. |
| Let someone request an operation from a ticket | A **message** with a button or form and an answer in the control panel. |

One addon can provide several capabilities. You implement the operations in JavaScript and register them through a preset. The [API reference](/addons/build/contracts) defines the supported exports.

<span id="what-an-addon-is"></span>

## How Bakers loads an addon

Create a JavaScript package with a **preset**: a module that tells Bakers what the addon provides. List the package in configuration; Bakers imports its preset and registers the declared capabilities. The package can live in your project; publishing it to npm is optional.

| Piece | Purpose |
|---|---|
| `package.json` | Names the package and exposes its `./preset` entry. |
| `preset.js` | Exports your implementations through names Bakers recognizes. |
| An `addons` configuration entry | Enables the package on a machine or in a project. |

For example, `agents` registers an agent harness, `tools` registers callable operations, and `inbox` declares ticket messages. The package's `scopes` export declares where it can be enabled. Agent harnesses belong to the machine where their programs run; project tools belong to the project that needs them.

## What you will build

Each example implements a new integration:

<span id="example-configure-an-existing-agent"></span>
<span id="create-two-files"></span>
<span id="example-connect-an-existing-terminal-client"></span>
<span id="enable-in-project"></span>

1. <span id="add-an-agent"></span>[Add an agent](/addons/build/agent): write a harness for a program Bakers does not yet support.
2. <span id="add-a-client"></span>[Add a client](/addons/build/client): start and close agent terminals in your application through its CLI.
3. [Extend the control panel](/addons/build/control-panel): implement an operation and make it callable from a ticket.

The harness and client guides define a small example CLI/API, then show the complete adapter, registration and verification. Their external programs are hypothetical so you can see which parts must be adapted to your own software.

## Verify

Use a disposable project and the checks in each guide. First verify the adapter against your program's CLI or API, then check configuration, restart the conductor and dispatch a ticket. A configuration check proves registration; the live run proves your external program works with it.

## Add a ticket message

To let someone call an operation from a ticket, declare a **message**. Bakers displays its button or form and the returned answer. [Extend the control panel](/addons/build/control-panel) implements a read-only worktree check through `tools` and `inbox`.

## Remove the example

Remove its addon entry and any catalog entry referring to it, restart the conductor, then delete only the example package. When replacing a client integration, restore the project's previous executor configuration before dispatching further runs.

## Extend your addon

Continue with [Tools](/addons/build/tools), [Messages](/addons/build/actions), the [preset API](/addons/build/contracts) and the [executor/workspace lifecycle](/addons/build/executor-workspace).
