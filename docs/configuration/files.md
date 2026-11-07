# Configuration files and precedence

Choose the file by who owns the value. These are JavaScript modules, so review imported code before running a conductor with worker permissions.

| File | Owner and Git policy | Purpose |
|---|---|---|
| `~/.bakers/bakers.config.js` | User; private | Default server connection and sign-in profile |
| `~/.bakers/connections/<id>.js` | User; private | Named connection |
| `.bakers/connection.config.local.js` | Checkout user; ignored | Selects one named connection |
| `~/.bakers/machine.config.js` | Worker owner; private | Machine identity, harness addons, agent aliases/routes and shared security |
| `.bakers/conductor.config.js` | Project maintainers; committed | Literal project identity, engine addons, hooks and project security |
| `.bakers/<name>.conductor.config.js` | Project maintainers; committed | Complete named variant, not an overlay |
| `.bakers/conductor.config.local.js` | Checkout user; ignored | Local values, only effective through explicit imports |
| `WORKFLOW.md` | Project maintainers; committed | Instructions, provisioning profiles and validation; not a JavaScript config layer |

`BB_HOME` relocates the private `.bakers` directory itself, including machine and connection files. Tokens are separate in dropsh's per-host store; see [Connections](/configuration/connector/connections#files). Keep logs and `assets-ai/` out of Git too.

## How files interact

There is no universal “last file wins” merge.

- **Connection selection:** `--config`, `--connection`, `BB_CONFIG`, `BB_CONNECTION`, checkout selector, then default/legacy/sole-connection fallback. The first match wins; [Connections](/configuration/connector/connections#which-connection-is-used) defines fallback errors.
- **Project:** the selected conductor module is evaluated. A local sibling is not automatically overlaid. Its import and JavaScript expressions determine which values apply. Keep `bakers.project` literal so discovery can read it without executing the module.
- **Addons:** machine entries precede project entries. The same resolved package and alias combine at the machine position; machine `with` replaces project options unless the preset defines `mergeWith`. Explicit engine slots beat discovered contributions; otherwise singleton slots are last-wins. [Contracts](/addons/build/contracts#how-discovery-works) owns the details.
- **Security:** harness default → project → machine → harness entry, key by key. Lists replace unless `'$inherit'` includes the lower layer. Only supported keys apply; see [shared settings](/security/shared-settings).
- **Agents:** machine catalog and routes select harness/model; ticket labels can override routing. See [policy precedence](/agents/reference#which-agent-runs-a-state).

## One checkout, one connection, one worker

First use [machine setup](/get-started/machine) to create a private named connection `team` and authenticate on the execution machine. Keep its generated sign-in profile. The following files then fit together; retain your generated machine UUID instead of copying this example identity.

`~/.bakers/machine.config.js`:

```js
// @bakers-schema-version 1
export default {
  schema_version: 1,
  machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',
  label: 'worker-one',
  addons: ['@bakers-build/addon-codex'],
};
```

Private `.bakers/connection.config.local.js`:

```js
export default { connection: 'team' };
```

Committed `.bakers/conductor.config.js`:

```js
// @bakers-schema-version 1
export default {
  schema_version: 1,
  bakers: { project: 'demo', workspace: 'Engineering' },
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
};
```

The project/workspace must already exist, Codex must be installed and signed in, and herdr must be available. This example has no automatic dependency setup; add [project hooks](/provision/hooks) when the application needs them. Everyone can share the project file while selecting their own server and worker identity.

## Validate and migrate

```sh
bakers config check --scope all --online
bakers info
bakers agents
bakers oven check
```

Check that the selected connection, project and workspace match your intent. `check` validates declared schemas and, online, addon resolution/scopes/options; agent catalog loading and sandbox readiness have separate commands above. Neither proves application readiness.

Use [migration](/configuration/project/migration) before modifying older files, and inspect the proposed changes from `bakers config upgrade`. Computed JavaScript needs human editing; upgrading cannot infer its intent. [CLI/plugin updates](/configuration/machine/updates) and [server updates](/self-hosting/server#update) have separate lifecycles.
