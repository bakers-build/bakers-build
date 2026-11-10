# Machine

`machine.config.js` is the private file that identifies one execution host and owns its preview-tunnel policy, agent harnesses and agent routes. This page defines the machine fields and links the detailed agent policy. For complete agent and route examples, use [Configure and select agents](/agents/guide#configure-agents). The web UI lists this account's machines at `/user/{user}/machines`. Opening a row shows View at `/user/{user}/machine/{id}` (UUID, max parallel, current load) and Settings when the account owns the machine and holds `update own bb_machine`. The heartbeat creates a machine; **Delete** on its Overview opens `/user/{user}/machine/{id}/delete`.

## Location

| Item | Value |
|---|---|
| File | `~/.bakers/machine.config.js` |
| Relocate | `BAKERS_HOME` names the `.bakers` directory itself, not a home containing one. It moves the machine file and `connections/` together. A relative value resolves against the working directory. |
| Create | `bakers init` writes identity. Configure installed harnesses in `addons` before starting work. `bakers config init --scope machine` does the machine step alone. |
| Commit | Never. It is per user and per host. |

## Minimal example

```js
// @bakers-schema-version 1
/** @type {import('@bakers-build/core').MachineConfig} */
export default {
  schema_version: 1,
  machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',
  label: 'alex-laptop',
  addons: ['@bakers-build/addon-codex'],
};
```

## Fields

| Field | Meaning and default |
|---|---|
| `schema_version` | `1`. The `// @bakers-schema-version 1` header and this field must agree. |
| `machine_id` | Required. This host's key on the server, so each machine has its own. `bakers init` generates a UUID for a new machine; an existing machine keeps the id it already has. A UUID in any case loads lowercased. Conductor ids are derived from it, so two users cannot share a `machine_id`: the second one's `bakers conductor start` is refused; remove `machine_id` and run `bakers init` for a fresh UUID. |
| `label` | Required display name for people, never a key. `bakers init` asks for it (default: the short hostname, used without a prompt when there is no terminal) or takes `--label`. It names the machine on the server when the machine first registers, and a machine still named after its `machine_id` on its next start; rename it there afterwards. |
| `addons` | This host's addons: a package name or `{ use, alias?, with? }`, the same shape as the project's `addons`. Agent harnesses go here and are the source of agent candidates; with none, the catalog is empty and the conductor fails to load. Any addon whose page allows the machine file may go here too, for example `@bakers-build/addon-bakers-ui-artifacts` or `@bakers-build/addon-ports`. An entry in a file its addon does not allow is not loaded. `with` is checked against the addon's options schema. See [Configure addons](/addons/configure). |
| `addons[].use`, `addons[].alias`, `addons[].with`, `addons[].priority` | An entry's package name, its alias, its options (`with`) and an optional `priority` function. |
| `agents` | Object, described [below](#agents). An array is invalid. |
| `agents.catalog` | Extra aliases `{ harness, alias?, with? }` built from installed harnesses. |
| `agents.catalog[].harness`, `agents.catalog[].alias`, `agents.catalog[].with` | The installed harness package, the alias it is offered as, and its options. |
| `agents.enabled` | Aliases to keep; omitted keeps all. |
| `agents.disabled` | Aliases to drop. |
| `agents.routes` | Named routes from workflow states (or `'*'`) to aliases. |
| `agents.routes.default` | The automatic route, applied without a route label. `agents.routes.default['*']` is the default agent; without it the first enabled alias is. |
| `tunnel` | Optional literal boolean, default `false`. See [below](#preview-link-tunnels). |
| `permissions` | Optional. Run permissions for every agent on this host: `mode` (`sandbox`, `system` or `yolo`) and the `sandbox` lists `deny_read`, `allow_write`, `trusted_commands`. It replaces the project's block key by key, and a harness entry's `with` replaces both; `'$inherit'` keeps the layer below. See [Shared run security](/provision/security/shared-settings). |
| `permissions.mode` | `sandbox`, `system` or `yolo`. |
| `permissions.sandbox`, `permissions.sandbox.deny_read`, `permissions.sandbox.allow_write`, `permissions.sandbox.trusted_commands` | The `sandbox` block and its lists; see [Shared run security](/provision/security/shared-settings). |
| `executor` | Optional executor slot `{ use, export?, with? }`. Overrides every project executor on this machine; server and worktree remain project-owned. For example, [herdr-core](/addons/herdr-core). Omitted uses the project selection. |
| `executor.use`, `executor.export`, `executor.with` | The slot's package, its named factory and the factory's options. |

Unknown keys fail. The run budget (**Max parallel**) is set on the machine in the backend; a new machine starts with 5. Every conductor on this host shares it and picks up a change on its next tick.

## Preview-link tunnels

`tunnel: true` tells workflow agents to share addon-claimed HTTP(S) services through [Ports](/addons/ports), using this machine's configured transport. The flag does not install or start a transport. Agents receive `BAKERS_TUNNEL` (`1` or `0`); omitted or `false` means share local URLs only. Unknown policy or a failed share must be reported as local-only. Public URLs are reachable from the internet while the tunnel is active. `bakers config check --scope machine` reports the effective policy and its source.

## Shared service tunnels (`bakers ports`)

Configure [Ports](/addons/ports) and its chosen transport in this machine's `addons`. The [Ports reference](/addons/ports) lists the supported transports and their prerequisites. Share a claimed service key, never a raw port; an omitted key shares every eligible service. The `tunnel` flag guides workflow agents and does not disable manual `bakers ports` commands.

## Agents

Top-level `addons` supplies harnesses; the sibling `agents` object holds the catalog, filters and routes. Keep these beside `machine_id`, not in the project file. The guide shows complete files for [one catalog agent](/agents/guide#use-one-agent) and [agent routes](/agents/guide#use-agent-routes).

### The agents object

`agents.catalog` adds or overrides aliases supplied by the harness addons. `enabled` and `disabled` filter what is available. See [all catalog fields, defaults and loading order](/agents/reference#configure-the-catalog).

### Which agent runs a state

`agents.routes` maps workflow states to catalog aliases; its `default` route applies without a route label, and its `'*'` entry is the default agent. Ticket labels can select an alias or named route. See [selection fields](/agents/reference#configure-selection) and [the complete precedence order](/agents/reference#which-agent-runs-a-state).

[Harness configuration](/agents/reference#harnesses) links package-specific options; [Execution security](/provision/security/execution) owns sandbox modes and prerequisites.

## Verify

```sh
bakers config check --scope machine
bakers agents
```

Check host identity; from a connected checkout, the agent catalog must contain an installed, authenticated harness.

## Connection address

Set `connection_url: 'ssh://christian@192.168.1.20:22'` or an absolute HTTPS URL
in the machine configuration. Only public addresses belong here: never include
passwords, tokens or secret query parameters. SSH permits an optional username and
port (1–65535), DNS, IPv4 or bracketed IPv6, and no path except `/`. HTTPS permits
paths, queries and fragments but no username. The maximum length is 2048 characters.

An actual conductor start publishes the address. A manual value takes precedence
over addon discovery; `connection_url: null` explicitly clears it. Omitting the
field preserves the saved address. Later heartbeats and CLI preflight registrations
do not change it. Invalid manual addresses are omitted with a warning and disable
start discovery for that start. The address is a snapshot, not proof of reachability.
