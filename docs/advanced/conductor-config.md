---
title: Conductor configuration
description: The committed .bakers/conductor.config.js - project identity, engine wiring, served states, scheduling, herdr, Orca and git workspace options, named variants and explicit composition.
---

# Conductor configuration

`.bakers/conductor.config.js` is the committed file that names a bakers.build project and wires the engine that works its tickets: the remote, the executor and the workspace.

It holds no connection, no credentials and no agent policy. The server and sign-in come from [Connections](/advanced/connections), host identity, capacity and agents from [Machines](/advanced/machines). `bakers config init --scope project --project <name>` writes the file; `bakers config check --scope project` validates it offline without loading plugins.

## The generated file

```js
async function loadMachine() {
  try {
    return (await import(`${process.env.BB_HOME ?? `${process.env.HOME}/.bakers`}/machine.config.js`)).default ?? {};
  } catch {}
  return {};
}

async function loadLocal() {
  try {
    return (await import('./conductor.config.local.js')).default ?? {};
  } catch {}
  return {};
}

const machine = await loadMachine();
const local = await loadLocal();
const project = 'demo';
const composedConductorId =
  machine.user_id && machine.machine_id
    ? `${machine.user_id}-${machine.machine_id}-${project}`
    : undefined;

export default {
  schema_version: 1,
  bakers: { project: 'demo', workspace: 'Engineering' },
  conductor_id: local.conductor_id ?? composedConductorId,
  remote: { plugin: '@bakers-build/addon-remote-drupal' },
  executor: { plugin: '@bakers-build/addon-herdr' },
  workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' },
};
```

This complete file loads and passes `bakers config check`. The generator also writes `addons: [{ use: '@bakers-build/addon-herdr' }]`, the `capture_logs` key and, when you answered them, a `hooks` block. The smallest equivalent with a literal identity is:

```js
export default {
  bakers: { project: 'demo', workspace: 'Engineering' },
  conductor_id: 'dev-laptop-demo',
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
};
```

Each machine needs a distinct `conductor_id`, which is why the generated file composes `<user_id>-<machine_id>-<project>` from the machine file. A literal shared by two live hosts makes them collide.

## Fields

| Field | Meaning and default |
|---|---|
| `bakers.project` | Required. The project name as a string literal; the loader reads it without running the file, so no variables or spreads. |
| `bakers.workspace` | Workspace name. Required only when the project name exists in more than one workspace; the error names the candidates. |
| `conductor_id` | Required registration identity, distinct from the host's `machine_id`. The old `machine_id` key still works with a warning. |
| `label` | Display label. Defaults to the conductor id. |
| `remote`, `executor`, `workspace` | Engine slots: `{ plugin, export?, with? }`. Each must resolve, from a slot or from `addons`. |
| `addons` | Packages that contribute the slots: a name, or `{ use, with }`. A direct slot beats an addon; otherwise the last contributor wins with a warning. |
| `states` | Workflow states this conductor serves. Omitted or empty serves every claimable state. |
| `poll_interval_ms` | Positive integer, default `5000`. |
| `lease_seconds` | Positive integer requested run lease, default `300`; the server caps it at 3600 unless configured otherwise. It is an ownership duration, not a task timeout. |
| `hooks` | Lifecycle commands `after_create`, `before_run`, `after_run`, `after_done`, `on_freeze`, `on_resume`; see [Hooks](/advanced/configuration/hooks). Omitted hooks do nothing. |
| `prompt` | Agent prompt template with `{identifier}`, `{state}` and `{runUuid}`. The default tells the agent to read the ticket and comments, read `WORKFLOW.md` and run only the current state. Keep a custom prompt short and on one line. |
| `selectAgent` | Function `(candidates, ticket) => candidate` that replaces the shipped agent choice. Prefer [machine routes](/advanced/configuration/agents-and-models). |
| `schema_version` | Written by `bakers config init` and `upgrade`; the current project schema is 1. |

`capture_logs` is written as `true` by the generator. Set it to `false` to keep this conductor's run transcripts off the server: the footprint (tokens, turns, tool calls) is still recorded, the transcript stays on this machine.

The loader rejects three old shapes: top-level `project` or `bb_workspace` instead of `bakers`, `max_parallel` in this file (capacity lives in the machine file), and `agent`, `agents`, `default_agent` or `agent_routes` (agent policy lives in the machine file). `site` and `plugins` are ignored with a warning. Repair all of them with `bakers config upgrade --scope all` ([Configuration migration](/advanced/migration)). Agent addons listed in `addons` are dropped with a warning.

## Plugin descriptors

A slot entry `{ plugin, export, with }` names an installed package. `plugin` resolves from the config directory, then the current directory, then the CLI install. `export` picks a named factory; without it the default export is used, and a package with several function exports and no default needs `export`. `with` is the factory's options (`options` is an alias). A config need not import its plugin packages.

| Package | Provides | Options |
|---|---|---|
| `@bakers-build/addon-remote-drupal` | The remote for a bakers.build control plane | None; it uses the connection and engine context. |
| `@bakers-build/addon-herdr` | Executor and workspace from one `addons` entry; the same `with` goes to both | See below. |
| `@bakers-build/addon-orca` | Executor and workspace hosted in [Orca](https://www.onorca.dev/), from one `addons` entry; the same `with` goes to both | See [Orca options](#orca-options). |
| `@bakers-build/addon-workspace-git` | A workspace only, without a terminal executor | `branchPrefix`, `branchTemplate` |

## herdr options

List herdr once in `addons` to wire both slots. The fragment below replaces the `addons` line of a config:

```js
addons: [
  '@bakers-build/addon-remote-drupal',
  {
    use: '@bakers-build/addon-herdr',
    with: {
      worktreeDir: '.bakers-worktrees',
      open: {},
      default: { panelLabel: '{title}' },
      states: {
        review: { panes: [{ direction: 'right', command: 'git diff --stat' }] },
      },
    },
  },
],
```

| Option under `with` | Meaning and default |
|---|---|
| `root` | Main clone path; derived from Git's common directory when omitted. |
| `worktreeDir` | Worktree directory relative to the root, default `.bakers-worktrees`. |
| `baseBranch` | Base ref for new branches; default the remote-tracking branch of the checked-out branch. |
| `open` | Overview layout of a fresh worktree. Omitted runs `bakers ui --ticket {identifier}`; `{}` leaves a bare tab. Keys: `command`, `panes`, `tabLabel`, `panelLabel`. |
| `default`, `states.<state>` | Per-run layout. A state value beats `default`, which beats the built-ins. |
| `launchWatch` | Optional. `startTimeoutMs` (default 60000) waits for the launch wrapper to write `started`; `timeoutMs` (default 4000) then fails the run if the agent exits immediately. |

Layout fields: `tabLabel` (default `{identifier} · {titleSlug}`, must contain `{identifier}`), `workspaceLabel` (`{repoName}`), `panelLabel` (`{title}`) and `panes`, extra splits that are not the agent command (`direction` is `right` or `down`, plus `command` and optional `focus`). A `panes` array replaces the previous one. Labels accept `{identifier}`, `{title}`, `{titleSlug}`, `{runUuid}`, `{repoName}` and `{workspacePath}`; `open` commands also accept `{branch}` and `{worktreePath}`. The open layout runs once, after `after_create`, for a freshly created worktree. Top-level `states` chooses what is served, while `with.states` only lays out panes.

The agent command is executed by non-interactive `/bin/sh`, so the harness binary must resolve through `PATH`. A shell alias or function is not loaded.

## Orca options

[Orca](https://www.onorca.dev/) can host the ticket worktrees instead of herdr. Each ticket's worktree then appears in Orca, with its diff review, browser and mobile monitoring, and each run's agent runs in an Orca terminal of that worktree. Dispatch, claims and status stay with the conductor. List Orca once in `addons` to wire both slots, in place of herdr:

```js
addons: [
  '@bakers-build/addon-remote-drupal',
  {
    use: '@bakers-build/addon-orca',
    with: {
      worktreeDir: '.bakers-worktrees',
      states: { review: { tabLabel: '{identifier} review' } },
    },
  },
],
```

| Option under `with` | Meaning and default |
|---|---|
| `root` | Main clone path; derived from Git's common directory when omitted. |
| `worktreeDir` | Worktree directory relative to the root, default `.bakers-worktrees`. |
| `baseBranch` | Base ref for new branches; default the remote-tracking branch of the checked-out branch. |
| `command` | Fallback agent command when the agent addons supply none, default `claude`. |
| `default`, `states.<state>` | `tabLabel`, the agent terminal's title, default `{identifier} · {titleSlug}`; it must contain `{identifier}`. ` #<run id>` is always appended, and the title is set as the terminal's manual name (`orca terminal rename`). The agent can still change the title shown for the terminal itself; the run's terminal is found again by the renamed tab title in the Orca app, or by the terminal title with `orca serve`. |
| `open` | Overview terminal of a fresh worktree. Omitted runs `bakers ui --ticket {identifier}` titled `{identifier} · {title}`; `{}` opens none. Keys: `command`, `title`. |
| `launchWatch` | As for herdr: `startTimeoutMs` (default 60000) and `timeoutMs` (default 4000). |
| `adoptTimeoutMs` | How long to wait for Orca to pick up a new worktree, default 35000. |

Requirements and behaviour:

- Orca 1.4 or later, with the `orca` CLI enabled in Orca's settings and on the `PATH` of the `bakers oven` process.
- **`bakers oven` and Orca run on the same machine.** The CLI talks to the local Orca runtime. Orca is not a multi-user server: it has no accounts or roles and keeps credentials on its host, so a shared team Orca is not supported.
- If no Orca runtime answers (`orca status`), the run fails at once with `Orca runtime not reachable (state: …)`. Start the desktop app or `orca serve` and the next dispatch succeeds. bakers.build never starts Orca itself.
- The worktree is created with git on the exact ticket branch and Orca adopts it, which can take up to 30 seconds. The addon registers the repository with Orca and makes its git worktrees visible in the sidebar.
- `stopRun` does nothing; the run's terminal closes when the run is cleaned up, also after an Orca restart. Removing a worktree goes through `orca worktree rm`, or through git when Orca does not know it.

## Git-only workspace

`@bakers-build/addon-workspace-git` creates worktrees next to the checkout in `<root>-worktrees`. `branchPrefix` defaults to `bakers/` and `branchTemplate` to `{branchPrefix}{key}-{titleSlug}`; `{identifier}` is also available. The herdr executor pairs only with the herdr workspace, so use this package only with another executor.

## Serve fewer states or poll more slowly

```js
// Fragment: add inside the exported object.
states: ['working', 'review'],
poll_interval_ms: 10000,
label: 'Demo development worker',
```

Use real workflow state names ([Workflows and states](/skills-and-workflows/workflows-and-states)). A restricted conductor never claims a ticket in another state. Add `qualification` when it should qualify hand-written tickets.

## Named variants

Put another full engine config in `.bakers/review.conductor.config.js`, with its own `conductor_id` and for example `states: ['review']`. A variant is complete in itself, not an overlay. Select it with `--conductor review` or `BB_CONDUCTOR=review`; see [Conductors](/advanced/conductors).

## Compose local inputs explicitly

Local JavaScript is merged only where the config imports it. This file needs a gitignored sibling `conductor.config.local.js` exporting `{ conductor_id: 'laptop-demo' }`, and a missing file fails the load:

```js
import local from './conductor.config.local.js';

export default {
  bakers: { project: 'demo', workspace: 'Engineering' },
  conductor_id: local.conductor_id,
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
};
```

It loads, but `bakers config check` reports `conductor_id` as computed with a warning, and `bakers config upgrade` will not guess a computed value. Only `conductor_id` is read from that file; other keys have no effect. Keep project identity literal and committed.
