# Configuration

Choose the file by who owns the value. All are JavaScript modules at schema version 1; review imported code before running a conductor.

| File | Owner, Git | Reference |
|---|---|---|
| `~/.bakers/connections/default.js`, `connections/<id>.js` | You; private | [Connection](/configuration/connection) |
| `.bakers/connection.config.js` | Project; optional | [Connection](/configuration/connection) |
| `~/.bakers/machine.config.js` | Worker owner; private | [Machine](/configuration/machine) |
| `.bakers/project.config.js`, `project.<name>.config.js` | Maintainers; committed | [Project](/configuration/project) |
| `WORKFLOW.md` | Maintainers; committed | [Workflows](/skills-and-workflows/workflow-file) |

`BAKERS_HOME` relocates `~/.bakers`. Commands: [CLI reference](/cli/).

## How files interact

No file overlays another.

- **Connection:** `--config`, `--connection`, `BAKERS_CONFIG`, `BAKERS_CONNECTION`, then defaults; the first match wins ([selection](/configuration/connection#which-connection-is-used)).
- **Project:** one file is evaluated; a variant is complete, never an overlay.
- **Addons:** machine entries precede project entries. Same package and alias combine; machine `with` wins. The machine `executor` beats the project's; explicit slots beat addons ([contracts](/addons/build/contracts#how-discovery-works)).
- **Permissions:** harness default, project, machine, harness entry, key by key ([shared settings](/provision/security/shared-settings)).
- **Agents:** machine catalog and routes; labels can override ([precedence](/agents/reference#which-agent-runs-a-state)).

## Example

```js
// @bakers-schema-version 1
// ~/.bakers/machine.config.js
export default {
  schema_version: 1,
  machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',
  label: 'worker-one',
  addons: ['@bakers-build/addon-codex'],
};
```

```js
// @bakers-schema-version 1
// .bakers/project.config.js
export default {
  schema_version: 1,
  project: { name: 'demo', workspace: 'Engineering' },
  addons: ['@bakers-build/addon-herdr'],
};
```

## Validate and upgrade

```sh
bakers config check --scope all --online
bakers config upgrade --scope all --dry-run
```

An old key name fails as an unknown key, and an old file name is not read; rename them by hand. See [Update bakers.build](/configuration/guides/updates).
