---
title: Conductor configuration
description: The committed .bakers/conductor.config.js - project identity, engine wiring, served states, scheduling, herdr, Orca and git workspace options, named variants and explicit composition.
---

# Project

`.bakers/conductor.config.js` is the committed file that names a bakers.build project and wires the engine that works its tickets: the remote, the executor and the workspace.

It holds no connection, no credentials and no agent policy. The server and sign-in come from [Connections](/configuration/connector/connections), host identity, capacity and agents from [Machines](/configuration/machine). `bakers config init --scope project --project <name>` writes the file; `bakers config check --scope project` validates it offline without loading plugins.

## The generated file

```js
// @bakers-schema-version 1
export default {
  schema_version: 1,
  bakers: { project: 'demo', workspace: 'Engineering' },
  remote: { plugin: '@bakers-build/addon-remote-drupal' },
  executor: { plugin: '@bakers-build/addon-herdr' },
  workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' },
};
```

This complete file loads and passes `bakers config check`. The generator also writes `addons` entries (including a legacy project-level Claude entry, which the loader ignores), the `capture_logs` key and, when you answered them, a `hooks` block. The smallest equivalent is:

```js
export default {
  bakers: { project: 'demo', workspace: 'Engineering' },
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
};
```

The file carries no identity and is identical for everyone. A conductor is identified by machine + project + variant: the machine's `machine_id` from the [machine file](/configuration/machine), `bakers.project`, and the variant, which is the config file's stem (`conductor` for `conductor.config.js`, `review` for `review.conductor.config.js`). bakers derives the conductor id `<machine_id>-<project>-<variant>` from them at runtime; it is never written to a config, and `bakers oven ls` prints it as the last column. A new conductor is named `<machine label> · <project>`, plus `/<variant>` for a variant other than `conductor`; rename it on its Identity card. When this machine, project and variant already have a conductor under an older id, the first `bakers oven start` offers to take it over ([Conductor commands](/configuration/project/conductor-commands)).

## Fields

| Field | Meaning and default |
|---|---|
| `bakers.project` | Required. The project name as a string literal; the loader reads it without running the file, so no variables or spreads. |
| `bakers.workspace` | Workspace name. Required only when the project name exists in more than one workspace; the error names the candidates. |
| `conductor_id`, `machine_id`, `label` | Rejected; run `bakers init`. The conductor's identity comes from the machine, the project and the variant; its label is set when it first registers. |
| `remote`, `executor`, `workspace` | Engine slots: `{ plugin, export?, with? }`. Each must resolve, from a slot or from `addons`. A machine `executor` overrides the project executor. |
| `addons` | Packages that contribute the slots: a name, or `{ use, with }`. A direct slot beats an addon; otherwise the last contributor wins with a warning. |
| `states` | Optional array of non-empty state strings; omitted or empty seeds all claimable states on first registration. Later edits belong on the conductor Identity card or API; changing this file does not update an existing registration. |
| `poll_interval_ms` | Positive integer, default `5000`. |
| `lease_seconds` | Positive integer requested run lease, default `300`; the server caps it at 3600. It is an ownership duration, not a task timeout. |
| `hooks` | Optional command object. [Lifecycle hooks](/configuration/project/hooks) owns its keys, timing, environment, failure behavior and on-demand `provision_up` profiles. |
| `prompt` | Agent prompt template with `{identifier}`, `{state}` and `{runUuid}`. The default tells the agent to read the ticket and comments, read `WORKFLOW.md` and run only the current state. Keep a custom prompt short and on one line. |
| `permissions` | Run permissions for every agent of every machine that runs this project: `mode` and the `sandbox` lists `deny_read`, `allow_write`, `trusted_commands`. The machine's own block and a harness entry replace it key by key; `'$inherit'` keeps the layer below. A block that loosens the sandbox gives anyone who can push here more rights on those machines and warns at every load. See [Shared run security](/provision/security/shared-settings). |
| `selectAgent` | Function `(candidates, ticket) => candidate` that replaces the shipped agent choice. Prefer [machine routes](/agents/guide). |
| `schema_version` | Written by `bakers config init` and `upgrade`; the current project schema is 1. |

`capture_logs` is written by the generator, but the current file loader does not forward it to the engine. Do not rely on `capture_logs: false` in this file to prevent uploads. Use the server's [run-log storage policy](/self-hosting/server#run-log-storage); footprint metrics are recorded independently. This loader limitation is separate from the engine's support for the option.

The loader rejects two old shapes: top-level `project` or `bb_workspace` instead of `bakers`, and `agent`, `agents`, `default_agent` or `agent_routes` (agent policy lives in the machine file). `site`, `plugins` and `max_parallel` are ignored with a warning; the run budget is set on the machine in the backend. Move or remove them by hand; `bakers config upgrade` no longer rewrites them. Agent addons listed in `addons` are dropped with a warning.

## Plugin descriptors

A slot entry `{ plugin, export, with }` names an installed package. `plugin` resolves from the config directory, then the current directory, then the CLI install. `export` picks a named factory; without it the default export is used, and a package with several function exports and no default needs `export`. `with` is the factory's options (`options` is an alias). A config need not import its plugin packages.

| Package | Provides | Options |
|---|---|---|
| `@bakers-build/addon-remote-drupal` | The remote for a bakers.build control plane | None; it uses the connection and engine context. |
| `@bakers-build/addon-herdr` | Executor and workspace from one `addons` entry; the same `with` goes to both | [herdr options](/addons/herdr/options). |
| `@bakers-build/addon-orca` | Executor and workspace hosted in [Orca](https://www.onorca.dev/), from one `addons` entry; the same `with` goes to both | See [Orca options](/addons/orca/options). |
| `@bakers-build/addon-workspace-git` | A workspace only, without a terminal executor | `branchPrefix`, `branchTemplate` |

## Clients and workspaces

### herdr options

Use [herdr setup](/addons/herdr) and its [options reference](/addons/herdr/options) for the paired executor/workspace.

### Orca options

Use [Orca setup](/addons/orca) and its [options reference](/addons/orca/options) for the local runtime.

### Git-only workspace

[Git workspace](/addons/workspace-git) needs a compatible executor. Package options live with the addon.

## Serve fewer states or poll more slowly

```js
// Fragment: add inside the exported object.
states: ['working', 'review'],
poll_interval_ms: 10000,
```

Use real workflow state names ([Workflows and states](/skills-and-workflows/states)). For an existing conductor, change its served states on the Identity card as well. Add `qualification` when it should qualify hand-written tickets.

## Named variants

Put another full engine config in `.bakers/review.conductor.config.js`, for example with `states: ['review']`. Its variant is `review`, so it registers as a separate conductor. A variant is complete in itself, not an overlay. Select it with `--conductor review` or `BB_CONDUCTOR=review`; see [Conductors](/configuration/project/conductors).

## Compose local inputs explicitly

Local JavaScript is merged only where the config imports it. A gitignored sibling `conductor.config.local.js` may hold local values such as a preview transport, never an identity. This file imports it, and a missing file fails the load:

```js
import local from './conductor.config.local.js';

export default {
  bakers: { project: 'demo', workspace: 'Engineering' },
  addons: [
    '@bakers-build/addon-remote-drupal',
    '@bakers-build/addon-herdr',
    { use: '@bakers-build/addon-ports', with: { transport: { use: '@bakers-build/addon-ports-frp', with: local.frp } } },
  ],
};
```

`bakers config upgrade` will not guess a computed value. Keep project identity literal and committed.

## Verify

```sh
bakers config check --scope project --online
bakers info
```

The online check must pass and the resolved project/workspace must match your checkout. Use [project setup](/get-started/connect-a-project) for the first connection.
