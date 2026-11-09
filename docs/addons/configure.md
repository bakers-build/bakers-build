# Configure addons

Enable an existing addon without writing one. Choose it in the [catalog](/addons/catalog), check its prerequisites, then append its entry to the correct file. Configuration does not install packages or their underlying tools.

## AI first

Ask your agent to read the selected addon's guide and existing configuration, explain the owning file, apply the smallest change and run its documented checks.

## Which file takes `addons`

| Contributions | Configuration |
|---|---|
| Agent harnesses | Machine only: `~/.bakers/machine.config.js`. |
| herdr, server remote, Git workspace | Project only: `.bakers/conductor.config.js`. |
| Ports, DDEV, herdr-core, Orca, Artifacts | Machine or project; follow the integration's guide. |
| Authentication and connection plugins | Your private [connection file](/configuration/connector/connections). |

Append entries; keep existing identity and engine settings. Use a package name for defaults, or `{ use, with }` for options:

```js
addons: [
  '@bakers-build/addon-bakers-ui-artifacts',
  {
    use: '@bakers-build/addon-ports',
    with: {
      transport: { use: '@bakers-build/addon-ports-cloudflare-quick' },
    },
  },
],
```

The package must resolve from the configuration directory, working directory or CLI installation. Local paths resolve relative to the configuration file.

**Machine/project precedence:** the same package and alias become one entry. A machine `with` replaces the project `with` as a whole; absent machine options preserve project options. [Ports](/addons/ports-services#options) merges service rules by key. Wrong-scope entries warn and do not load; online checks report an error. Missing machine packages warn and are skipped; missing project or connection packages fail loading.

UI entries layer in machine, connection, project order and deduplicate resolved modules. See the [API reference](/addons/build/contracts#addon-entry-fields) for aliases and author declarations.

## Connection defaults

Keep generated Essentials configuration: it supplies rendering, schema and name resolution. Do not enable its constituent packages separately.

Type, recipe and label names are resolved or created in the ticket's workspace through the [named tools](/configuration/clients/tools#tools). Environment names must already exist in the ticket's project; an unknown name stops the write.

For UI workspace selection, use the [connection's `workspace_id`](/configuration/connector/connections#fields) or `bakers ui --workspace`. It does not scope ordinary CLI calls or replace the conductor's project/workspace configuration.

## Check

```sh
bakers config check --scope machine --online
bakers config check --scope project --online
```

Check the scope you changed, restart the conductor or UI, then follow the addon's success check. Old `agents.addons` and top-level `ports` settings require [configuration migration](/configuration/machine/updates).
