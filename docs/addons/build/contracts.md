# Addon contracts

An addon is an npm package that declares what it contributes to the bakers.build CLI through a fixed `./preset` export; this page lists the kinds of contribution, the entry fields a config uses, and how to write an addon. Packages under `bakers-cli/addons/` without a `./preset` (`docker-compose`, `name-refs`, the `ports-*` transports) are libraries another addon or the host loads; they never appear in an `addons` list. The shipped reference for a complete addon is [Ports](/addons/ports): preset, lazy `commands`, an `inbox` message and tests, in `bakers-cli/addons/ports` in a source checkout.

To enable an addon, use [Addons](/addons/configure); this page is for people who change or add addons.

## Addons and plugins

The two words name two levels.

- An **addon** is a package under `bakers-cli/addons/`. It is what you list in an `addons` array, and one addon may contribute several things. `@bakers-build/addon-herdr` contributes an executor and a workspace.
- A **plugin** is one typed contribution: `RemotePlugin`, `ExecutorPlugin`, `WorkspacePlugin` or `AgentPlugin` on the conductor surface, `BbCommandPlugin` on the command surface, and dropsh's `DropSHPlugin` on the connection surface.

## Surfaces and extension points

A preset declares contributions through named accumulator functions of the form `(acc, opts) => acc`, sync or async. Each returns a new list from the one built so far, so an addon can append, replace or filter. There are three surfaces, each named for where its configuration lives, and the loader for a file runs only the accumulators of that file's surface. The names are canonical in `bakers-cli/core/src/plugins/preset.ts`.

| Surface | Accumulators | Configured in | Element |
|---|---|---|---|
| command | `commands` | The registry of the `bakers` host | A descriptor: `name`, `plugin` module, `describe` text, optional `export` |
| conductor | `remotes`, `executors`, `workspaces` | `addons` per [`scopes`](#where-an-addon-may-be-configured) | `RemotePlugin`, `ExecutorPlugin`, `WorkspacePlugin` |
| conductor | `hooks` | `addons` per [`scopes`](#where-an-addon-may-be-configured) | `HookListener`, see [Hooks](/provision/hooks#add-a-listener-from-an-addon) |
| conductor | `agents` | `addons` per [`scopes`](#where-an-addon-may-be-configured) | `AgentCandidate` |
| conductor | `inbox`, `tools` (values, not accumulators) | `addons` per [`scopes`](#where-an-addon-may-be-configured) | `InboxMessages`: message definitions and lazy `InboxMessageHandler`s, contract 2, see [Write an addon with inbox messages](/addons/build/actions); `AddonTools`: [agent tools](/addons/build/tools) |
| connection | `connectionPlugins` | `addons` of a connection config | A dropsh plugin: authentication, renderers, schema, request hooks |
| connection | `uiEntries` | `addons` of the machine, connection or conductor config | A module specifier, a string |

Contract 1 (`actions`: a contract definition and lazy handlers rendering tables/views/row actions) is retired; it is not a current surface and no addon may still export it (see [Migrating a contract-1 addon](/addons/build/actions#migrating-a-contract-1-addon)).

A conductor-surface plugin has a `kind`, an `id`, `requiredModules` and one factory: `createRemote(config)`, `createExecutor(config, deps)`, `createWorkspace(config, deps?)` or `createAgent(config)`. An agent candidate adds an optional `alias`, `description`, `model`, `modelVersion` and `priority`. The interfaces they return are `BbRemote`, `BbExecutor`, `BbWorkspace` and `BbAgent`, all exported from `@bakers-build/conductor/contract`.

What ships today:

| Surface | Addons |
|---|---|
| command | `conductor` and `ui` (inside their own packages), `addon-dropsh`, `addon-deployment`, `addon-agents`, `addon-info`, `addon-ports`, `addon-track` |
| conductor | `addon-remote-drupal` (remote), `addon-herdr` (executor and workspace), `addon-workspace-git` (workspace), the agents `addon-claude`, `addon-codex`, `addon-grok`, `addon-kimi`, `addon-opencode`, `addon-pi`, and the inbox of `addon-ports` |
| connection | `addon-auth-basic`, `addon-essentials`, `addon-bakers-ui` (the terminal renderer), `addon-workspace`, and the cockpit tab `addon-bakers-ui-artifacts` |

`addon-fake` is a workspace-only test fixture that contributes a remote, an executor, a workspace and an inbox. `addon-essentials` is a meta-addon that brings the Markdown renderer, the JSON:API schema plugin and the name resolver `addon-name-refs`, which has no preset of its own.

Two packages have similar names. `@bakers-build/ui` is the `bakers ui` command, an application. `@bakers-build/addon-bakers-ui` is the renderer it loads, a connection addon.

## Addon entry fields

An `addons` array takes a bare package name or an object.

```js
// in a connection config
addons: [
  '@bakers-build/addon-essentials',
  { use: '@bakers-build/addon-auth-basic', with: { basic: '<base64 user:password>' } },
],
```

| Field | Meaning |
|---|---|
| `use` | The package name. `name` is accepted as an alias. One of the two is required, or loading fails. |
| `with` | Options handed to the addon's accumulators as `opts`. `options` is accepted as an alias. |
| `alias` | For agents only. Selects one named variant of the addon, or names a single custom contribution. Fails when the alias does not pick exactly one variant. |
| `priority` | For agents only. A function `(ticket) => number` for priority selection. Normally use named routes instead. |

An entry never carries a `kind` or an `export`. The surface is decided by which accumulator the preset exports, and the kind by the contribution itself. On the connection surface, the config's `workspace_id` is also passed to every preset as a global option, and an entry's own `with` overrides it key by key.

## How discovery works

One function, `discoverAddons`, in `bakers-cli/core/src/plugins/discover-addons.ts`, serves every surface.

1. Entries apply in array order. A meta-addon's own `addons` children apply first, depth first, and the declaring preset applies after them, so a parent overrides its children.
2. Each entry resolves `<package>/preset` first, then the package's main module when that is preset-shaped. Resolution looks in the config file's directory, then the working directory, then the CLI installation. A package with no preset is adapted from its default export with a legacy warning. A `./preset` that declares nothing is an error.
3. An exact repeat, meaning the same resolved module, options and alias, is skipped with a warning. The same package with different options loads again as a second instance.
4. Discovery does not install packages. An unresolvable addon is an error, except in the machine file and the `uiEntries` layers, where it is skipped with a warning naming the package and file.

Singleton slots (remote, executor, workspace) resolve last-wins, with a warning naming the competitors. A contribution of the wrong `kind` for its slot is an error. An explicit `remote`, `executor` or `workspace` descriptor in the config takes precedence over anything discovered. A conductor config with no remote, executor or workspace fails to load.

The machine file `~/.bakers/machine.config.js` and the project file `.bakers/conductor.config.js` each carry one `addons` list, merged into one effective list by `scopeAddons` (`bakers-cli/core/src/plugins/scoped-addons.ts`). The addon's `scopes` export (next section) decides where it may be listed; an entry elsewhere is not loaded and warns, and `bakers config check --online` reports `addon_scope_not_allowed`. The same resolved package and `alias` in both files becomes one entry at the machine position, machine entries first. An unresolvable machine entry is skipped with a warning; an unresolvable project entry fails the conductor load.

Agent harnesses are machine-scoped. The machine `agents.catalog` entries select and name variants; each `harness` must also appear in the machine `addons`. [Machines](/configuration/machine) lists the fields.

### Where an addon may be configured

A preset may export `scopes`, `mergeWith` and `checkWith`:

```ts
import type { BbPreset } from '@bakers-build/core';

export const scopes: BbPreset['scopes'] = ['machine', 'project'];
// Optional. Without it, a machine `with` replaces the project `with` whole.
export const mergeWith: BbPreset['mergeWith'] = (project, machine) => ({
  ...(project as object),
  ...(machine as object),
});
// Optional. Each problem in one entry's own `with` (per file, before the
// merge; `undefined` for none), keyed relative to it. `bakers config check
// --online` reports each as `addon_with_invalid` at `addons[<i>].with.<key>`;
// a throwing check becomes one finding.
export const checkWith: BbPreset['checkWith'] = (value) =>
  value === undefined ||
  (value !== null && typeof value === 'object' && !Array.isArray(value))
    ? []
    : [{ key: '', message: 'must be an object' }];
```

| Export | Meaning |
|---|---|
| `scopes` | Any non-empty subset of `'machine'` (`~/.bakers/machine.config.js`) and `'project'` (`.bakers/conductor.config.js`). Absent means both. |
| `mergeWith(project, machine)` | Called when the addon is listed in both files, `undefined` for a missing `with`; returns the entry's `with`. Absent: a given machine `with` replaces the project `with` whole, else the project `with` is used. |

[Configure addons](/addons/configure#which-file-takes-addons) lists the shipped declarations. An addon with hook listeners declares `['project']`, so no machine runs hooks for every project. Settings live only in the entry's `with`.

Cockpit tabs are layered. The three lists concatenate in the order machine, connection, project, and the same module resolved from two layers renders one tab.

## Write an addon

1. Create `bakers-cli/addons/<name>/` with a `package.json` whose `exports` include `"./preset": "./dist/src/preset.js"`, and a `tsconfig.json` like a sibling's.
2. Declare the contract packages as peer dependencies, never as plain dependencies: `@bakers-build/core`, and `@bakers-build/conductor` if you contribute to the conductor surface. Import conductor-surface types from the light subpath.

   ```ts
   import type { ExecutorPlugin } from '@bakers-build/conductor/contract';
   ```

   It carries only types and a few helpers, no engine or runtime, so importing it costs nothing at boot.
3. Export the accumulators from `src/preset.ts`. Type a conductor preset as `Preset` from the contract, and a command, connection or UI preset as `BbPreset` from `@bakers-build/core`.

   ```ts
   import type { Preset } from '@bakers-build/conductor/contract';

   export const workspaces: Preset['workspaces'] = (acc, opts) => [...acc, myWorkspace(opts)];
   ```

4. Keep presets light. A `commands` accumulator returns descriptors, never a constructed plugin, so the host can list every command without importing any of them. A `uiEntries` accumulator returns module specifiers, never objects, because discovery runs on every connection load and the terminal toolkit is large. A UI addon's preset must import no UI code. Its entry module, exported as `./ui`, imports `register` from `@bakers-build/addon-bakers-ui/ui`, and the addon peer-depends on `@bakers-build/addon-bakers-ui`. [The tab guide](/addons/bakers-ui/tabs) documents `register`.
5. To make the addon part of the stock CLI, add it to the dependencies of `bakers-cli/host/package.json`. A new command addon also needs its `commands` accumulator added to the list in `bakers-cli/host/src/host.ts`.
6. Check the boundaries and the package set.

   ```sh
   cd bakers-cli && pnpm install && pnpm -r run build
   node scripts/assert-acyclic.mjs
   ```

The guard rejects an addon that depends on a sink, names a dependency outside its allowance, lists a contract as a plain dependency, or contributes to the conductor or UI surface without the matching peer dependency; [architecture](/development/architecture) has the rules. A new non-private package under `addons/` is published without a list to edit. [Build from source](/development/build-from-source) covers `verify:package`, which installs the whole set the way npm users do.

## Addon inbox messages

An addon can offer messages that run on the conductor's machine and are triggered from the message card inline in the ticket detail page's right column (web UI) or the ticket's own right-hand-column card in `bakers ui`. The preset exports them as `inbox` (contract 2): message definitions — a label, who may send it, an optional flat `input` — plus lazy `InboxMessageHandler`s or tool `bindings`, each giving one `{ markdown }` answer. Registration is unique per `(workspace, name, version)`: two conductors of one workspace registering the same identity share one record, and a differing definition is ignored. [Write an addon with inbox messages](/addons/build/actions) is the guide and holds the contract and the lifecycle.
