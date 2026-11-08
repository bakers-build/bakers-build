# Addon API reference

An addon is a JavaScript package whose preset declares contributions to bakers.build. This reference is for addon authors; start with [Build your first addon](/addons/build/first-addon) for a complete local example. Publish a `./preset` export so the loader can find your contributions. Packages under `bakers-cli/addons/` without a `./preset` (`docker-compose`, `name-refs`, the `ports-*` transports) are libraries another addon or the host loads; they never appear in an `addons` list. The shipped reference for a complete addon is [Ports](/addons/ports): preset, lazy `commands`, an `inbox` message and tests, in `bakers-cli/addons/ports` in a source checkout.

To enable an addon, use [Addons](/addons/configure); this page is for people who change or add addons.

<span id="addon-contracts"></span>

## Addons and plugins

The two words name two levels.

- An **addon** is a package you make resolvable to the CLI, either locally or through its package installation. It is what you list in an `addons` array, and one addon may contribute several things. `@bakers-build/addon-herdr` contributes an executor and a workspace.
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

Use the [catalog](/addons/catalog) to choose an integration. The `@bakers-build/ui` package supplies the command; `@bakers-build/addon-bakers-ui` supplies its renderer.

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

Singleton slots (remote, executor, workspace) resolve last-wins, warning about the competitors. A wrong `kind` for its slot is an error. An explicit `remote`, `executor` or `workspace` descriptor in the config takes precedence over anything discovered; a machine `executor` wins ([slots](/addons/slots)). A conductor config with no remote, executor or workspace fails to load.

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

Terminal UI tabs are layered. The three lists concatenate in the order machine, connection, project, and the same module resolved from two layers renders one tab.

## Write an addon

1. Create a JavaScript package with `"type": "module"` and an export such as `"./preset": "./preset.js"`. The [tutorial](/addons/build/first-addon#create-two-files) includes a complete manifest. A local package can live in `.bakers/addons/`; it does not need to be added to the Bakers source repository.
2. Export only the contributions you need. Accumulators preserve previous contributions, for example `(acc, opts) => [...acc, myWorkspace(opts)]`. `tools` and `inbox` are values with their own contract versions.
3. For TypeScript, import `BbPreset` from `@bakers-build/core`, or the typed conductor `Preset` from `@bakers-build/conductor/contract`. That subpath also exports `RemotePlugin`, `ExecutorPlugin`, `WorkspacePlugin`, `AgentPlugin` and their interfaces. Use `import type` for types and compile before loading the package; export the compiled JavaScript path.
4. Declare the contract packages you use as peer dependencies with compatible published versions. You can also use them as development dependencies for local type checking. Keep preset imports light: commands return lazy module descriptors, UI entries return module specifiers, and tool/message handler factories load their implementation only when needed.
5. Make the package resolvable from the configuration directory, working directory or CLI installation. Add it to the correct `addons` list, validate configuration and restart the conductor. Listing a package never installs it.

Do not export project identity, scheduler settings or shell-hook configuration from a preset; those belong to the project's configuration. For hooks, use the listener accumulator and its [lifecycle contract](/provision/hooks#add-a-listener-from-an-addon).

Validate the actual example through its loader and input/result validators, then exercise it on a disposable ticket. A successful type check or config report does not prove runtime behavior. Specialized [executor/workspace contracts](/addons/build/executor-workspace) also require lifecycle and cleanup tests.

## Addon inbox messages

An addon can offer messages that run on the conductor's machine and are triggered from the message card inline in the ticket detail page's right column (web UI) or the ticket's own right-hand-column card in `bakers ui`. The preset exports them as `inbox` (contract 2): message definitions — a label, who may send it, an optional flat `input` — plus lazy `InboxMessageHandler`s or tool `bindings`, each giving one `{ markdown }` answer. Registration is unique per `(workspace, name, version)`: two conductors of one workspace registering the same identity share one record, and a differing definition is ignored. [Write an addon with inbox messages](/addons/build/actions) is the guide and holds the contract and the lifecycle.
