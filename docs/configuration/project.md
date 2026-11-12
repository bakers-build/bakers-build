---
title: Project configuration
description: The committed .bakers/project.config.js - project identity, engine slots, served states, scheduling, hooks, permissions, and named variants.
---

# Project

`.bakers/project.config.js` is the committed file that names a bakers.build project and wires the engine that works its tickets: the server, the executor and the worktree.

It holds no credentials and no agent policy. The server and sign-in come from the [connection](/configuration/connection), host identity and agents from the [machine](/configuration/machine). `bakers config init --scope project --project <name>` writes the file; `bakers config check --scope project` validates it offline without loading plugins.

## The generated file

```js
// @bakers-schema-version 1
/** @type {import('@bakers-build/core').ProjectConfig} */
export default {
  schema_version: 1,
  project: { name: 'demo', workspace: 'Engineering' },
  server: { use: '@bakers-build/addon-remote-drupal' },
  executor: { use: '@bakers-build/addon-herdr' },
  worktree: { use: '@bakers-build/addon-herdr', export: 'herdrWorkspace' },
};
```

The generator also writes `addons`, `capture_logs` and, when you answered them, a `hooks` block. The smallest equivalent is:

```js
export default {
  project: { name: 'demo', workspace: 'Engineering' },
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
};
```

The file carries no identity and is identical for everyone. A conductor is identified by machine + project + variant: the machine's `machine_id` from the [machine file](/configuration/machine), `project.name`, and the variant (`conductor` for `project.config.js`, `review` for `project.review.config.js`). bakers derives the conductor id `<machine_id>-<project>-<variant>` from them at runtime; it is never written to a config, and `bakers conductor ls` prints it as the last column. A new conductor is named `<machine label> · <project>`, plus `/<variant>` for a variant other than `conductor`; rename it on its Identity card. When this machine, project and variant already have a conductor under an older id, the first `bakers conductor start` offers to take it over ([bakers conductor](/cli/conductor)).

## Fields

| Field | Meaning and default |
|---|---|
| `schema_version` | `1`, written by `bakers config init`. |
| `project` | Required object `{ name, workspace? }`, written literally: the loader reads it without running the file, so no variables or spreads. |
| `project.name` | Required project name. `BAKERS_PROJECT` overrides it for one process. |
| `project.workspace` | Workspace name. Required only when the project name exists in more than one workspace; the error names the candidates. |
| `server` | Engine slot that talks to the control plane: `{ use, export?, with? }`, or a constructed plugin with `kind: 'server'`. |
| `executor` | Engine slot that runs agent sessions, same shape. A machine `executor` overrides it. |
| `worktree` | Engine slot that creates ticket worktrees, same shape. |
| `server.use`, `server.export`, `server.with`, `executor.use`, `executor.export`, `executor.with`, `worktree.use`, `worktree.export`, `worktree.with` | A slot's package, its named factory and the factory's options; see [Slot descriptors](#slot-descriptors). |
| `addons` | Packages that contribute slots and tools: a name, or `{ use, alias?, with? }`. A direct slot beats an addon; otherwise the last contributor wins with a warning. `with` is checked against the addon's options schema. Agent harnesses belong in the machine file. |
| `addons[].use`, `addons[].alias`, `addons[].with`, `addons[].priority` | An entry's package name, its alias, its options (`with`) and an optional `priority` function. |
| `states` | Optional array of non-empty state strings; omitted or empty seeds all claimable states on first registration. Later edits belong on the conductor Identity card or API; changing this file does not update an existing registration. |
| `prompt` | Agent prompt template with `{identifier}`, `{state}`, `{run_uuid}` and `{ticket_uuid}`. The default tells the agent to read the ticket and comments, read `WORKFLOW.md` and run only the current state. Keep a custom prompt short and on one line. |
| `poll_interval_ms` | Positive integer, default `5000`. |
| `lease_seconds` | Positive integer requested run lease, default `300`; the server caps it at 3600. It is an ownership duration, not a task timeout. |
| `restart_on_change` | Boolean, default `true`: a foreground conductor restarts itself when a config file changes. Needs Node.js 22.15 or later. |
| `capture_logs` | Boolean, default `true`. Transcripts upload only where the server's [run-log storage policy](/self-hosting/server#run-log-storage) allows it; `false` keeps this conductor's transcripts local even then. Metrics are unaffected. |
| `hooks` | Optional command object. [Lifecycle hooks](/configuration/project/hooks) owns its keys, timing, environment, failure behavior and on-demand `provision_up` profiles. |
| `hooks.after_create`, `hooks.before_run`, `hooks.after_run`, `hooks.after_done`, `hooks.on_freeze`, `hooks.on_resume`, `hooks.provision_up` | The lifecycle hooks; see [Lifecycle hooks](/configuration/project/hooks). |
| `marketplaces` | Optional array of agent plugin marketplaces every run of this project installs: `{ url, ref, plugins }`. See [Agent plugins](#agent-plugins). |
| `marketplaces[].url`, `marketplaces[].ref`, `marketplaces[].plugins` | The marketplace's Git URL, the ref to check out and the plugins to install from it. |
| `runtime`, `runtime.read_only` | Worktree-relative host-executed paths protected from runs. Addon defaults → project → machine → runtime entry; `'$inherit'` inserts inherited paths. `.bakers` is fixed and DDEV declares `.ddev`. See [Shared runtime paths](/provision/security/shared-settings#host-executed-paths). |
| `permissions` | Run permissions for every agent of every machine that runs this project: `mode` and the `sandbox` lists `deny_read`, `allow_write`, `trusted_commands`. The machine's own block and a harness entry replace it key by key; `'$inherit'` keeps the layer below. A block that loosens the sandbox gives anyone who can push here more rights on those machines and warns at every load. See [Shared run security](/provision/security/shared-settings). |
| `permissions.mode` | `sandbox`, `system` or `yolo`. |
| `permissions.sandbox`, `permissions.sandbox.deny_read`, `permissions.sandbox.allow_write`, `permissions.sandbox.trusted_commands` | The `sandbox` block and its lists; see [Shared run security](/provision/security/shared-settings). |
| `select_agent` | Function `(candidates, ticket) => candidate` that replaces the shipped agent choice. Prefer [machine routes](/agents/guide). |

Unknown keys fail.

## Slot descriptors

A slot entry `{ use, export, with }` names an installed package. `use` resolves from the config directory, then the current directory, then the CLI install. `export` picks a named factory; without it the default export is used, and a package with several function exports and no default needs `export`. `with` is the factory's options. A config need not import its plugin packages.

| Package | Provides | Options |
|---|---|---|
| `@bakers-build/addon-remote-drupal` | The server slot for a bakers.build control plane | None; it uses the connection and engine context. |
| `@bakers-build/addon-herdr` | Executor and worktree from one `addons` entry; the same `with` goes to both | [herdr options](/addons/herdr#options) |
| `@bakers-build/addon-orca` | Executor and worktree hosted in [Orca](https://www.onorca.dev/), from one `addons` entry | [Orca options](/addons/orca#options) |
| `@bakers-build/addon-workspace-git` | A worktree only, without a terminal executor; needs a compatible executor | [Git workspace](/addons/workspace-git) |

[Conductor slots](/addons/slots) explains ownership and selection.

## Agent plugins

Declare the plugins every run needs once, here, so every machine runs with the same skills and hooks:

```js
// Fragment: add inside the exported object.
marketplaces: [
  { url: 'https://github.com/mattpocock/skills.git', ref: 'v1.3.2', plugins: ['mattpocock-skills'] },
  { url: 'https://github.com/obra/superpowers.git', ref: 'v7.0.0', plugins: ['superpowers'] },
],
```

- `url` is a remote Git URL (`https://`, `ssh://` or `git@`); a local path or `file://` URL is rejected. `ref` is a tag (the fixed version) or a branch. `plugins` names the plugins to install from that marketplace.
- Before each launch, in every `permissions` mode, the agent addon installs the list with the harness's own commands into an agent home at `~/.cache/bakers/agent-homes/<harness>/<hash>/` (`$XDG_CACHE_HOME` when set), keyed by a hash of the list. Runs with the same list reuse the home; a changed list builds a new one. The run uses only that home: the addon sets `CLAUDE_CONFIG_DIR` or `CODEX_HOME`, links only the credential file (`~/.claude/.credentials.json`, `~/.codex/auth.json`), trusts the run's worktree and leaves your own agent home untouched. Codex then starts with `--dangerously-bypass-hook-trust`, so plugin hooks run without a trust prompt. A Claude login kept only in the macOS keychain cannot be linked, and the run start fails, saying so.
- The conductor checks no skills before the launch: the install is the only gate. A skill a recipe or `WORKFLOW.md` requires but the run cannot load stops the run inside the agent, under the `bb-workflow` stop rule, which names the missing skill.
- Each run writes one `plugins` entry to the conductor log: harness, alias, mode, on or off with the reason, hash, home, `built` or `reused`, the marketplaces and any trust bypass. A failed install fails the run with the reason in its error log.
- Plugins are off, and the run uses your own agent home (Claude then installs the `.claude/settings.json` plugins before the first turn), when the project declares none, the harness addon cannot install plugins (only `claude` and `codex` can), or the machine's agent entry sets `plugins: false`.
- `marketplaces` belongs to the project; in `machine.config.js` it fails loading.

## Serve fewer states or poll more slowly

```js
// Fragment: add inside the exported object.
states: ['working', 'review'],
poll_interval_ms: 10000,
```

Use real workflow state names ([Workflows and states](/skills-and-workflows/states)). For an existing conductor, change its served states on the Identity card as well. Add `qualification` when it should qualify hand-written tickets.

## Named variants

A variant is a second, complete project file `.bakers/project.<name>.config.js`, for example `project.review.config.js` with `states: ['review']`. It is not an overlay: it repeats `project` and every slot it needs. Its variant is `review`, so it registers as a separate conductor. Select it with `--conductor review` or `BAKERS_CONDUCTOR=review`; without a selector `project.config.js` is used, or the only file when there is just one. See [Conductors](/configuration/project/conductors).

Shared values can live in a module both files import; `bakers config check` reports a value it cannot read statically as not checked. Keep `project` literal.

## Verify

```sh
bakers config check --scope project --online
bakers info
```

The online check must pass and the resolved project/workspace must match your checkout. Use [project setup](/get-started/connect-a-project) for the first connection.
