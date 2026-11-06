# Machines

`machine.config.js` is the private file that identifies one execution host and owns its capacity, preview-tunnel policy, agent harnesses and agent routes; every field is listed here with its default and precedence. To set agents up step by step, use [Choose agents and models](/configuration/agents). The web UI lists this account's machines at `/user/{user}/machines`. Opening a row shows View at `/user/{user}/machine/{id}` (UUID, max parallel, current load) and Settings when the account owns the machine and holds `update own bb_machine`. The heartbeat creates a machine; **Delete** on its Overview opens `/user/{user}/machine/{id}/delete`.

## Location

| Item | Value |
|---|---|
| File | `~/.bakers/machine.config.js` |
| Relocate | `BB_HOME` names the `.bakers` directory itself, not a home containing one. It moves the machine file, the connection files and `connections/` together. A relative value resolves against the working directory. |
| Create | `bakers init` writes identity and an `addons` list naming the Claude, Codex and Grok harnesses. `bakers config init --scope machine` does the machine step alone. |
| Commit | Never. It is per user and per host. |

## Minimal example

```js
// @bakers-schema-version 1
export default {
  schema_version: 1,
  machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',
  label: 'alex-laptop',
  addons: ['@bakers-build/addon-codex'],
};
```

## Top-level fields

| Field | Meaning and default |
|---|---|
| `schema_version` | Current schema is 1. The `// @bakers-schema-version 1` header and this field must agree. Any other version fails loading; run `bakers init`. |
| `machine_id` | Required. This host's key on the server, so each machine has its own. `bakers init` generates a UUID for a new machine; an existing machine keeps the id it already has. A UUID in any case loads lowercased. Conductor ids are derived from it, so two users cannot share a `machine_id`: the second one's `bakers oven start` is refused; remove `machine_id` and run `bakers init` for a fresh UUID. |
| `label` | Display name for people, never a key. `bakers init` asks for it (default: the short hostname, used without a prompt when there is no terminal) or takes `--label`. It names the machine on the server when the machine first registers, and a machine still named after its `machine_id` on its next start; rename it there afterwards. |
| `max_parallel` | Not read here. The run budget is set on the machine in the backend (machine form, **Max parallel**); a new machine starts with 5. Every conductor on this host shares it and picks up a change on its next tick. A leftover key loads with a warning and is ignored; `bakers config upgrade` leaves it in place. |
| `tunnel` | Optional literal boolean, default `false`. See below. |
| `agents` | Object, described in the next section. An array is invalid. |
| `security` | Optional. Run security for every agent on this host: `mode` and the `sandbox` lists `deny_read`, `allow_write`, `trusted_commands`. It replaces the project's block key by key, and a harness entry's `with` replaces both; `'$inherit'` keeps the layer below. See [Shared run security](/configuration/agents/shared-security). |
| `addons` | This host's addons, the same entry shape as a conductor config's `addons`: a package name or `{ use, alias?, with? }` (`name` and `options` are accepted aliases of `use` and `with`). Agent harnesses go here and are the source of agent candidates; with none, the catalog is empty and the conductor fails to load. Any addon whose page allows the machine file may go here too, for example `@bakers-build/addon-bakers-ui-artifacts` or `@bakers-build/addon-ports`. An entry in a file its addon does not allow is not loaded. See [Configure addons](/addons/configure). |
| `user_id` | Rejected; run `bakers init`, which rewrites the file without it and keeps `machine_id`. The server takes the owner from the sign-in. |
| `agents.addons`, `ports` | Retired. Loading fails with the exact replacement; move both into `addons`. |

Server URLs and credentials do not belong here. `bakers config check` reports `base_url`, `client_id`, `client_secret` and `workspace_id` in this file as misplaced; they live in the [connection](/configuration/connector/connections). A `tunnel` in a connection or conductor file is misplaced the same way.

## Preview-link tunnels

`tunnel: true` lets agents on this host share a local HTTP(S) preview through a public `cloudflared` tunnel. It starts a tunnel only for the one service an agent is about to share, never for every port, and needs `cloudflared` on `PATH`. Agents read the result as `BB_TUNNEL` (`1` or `0`). With `tunnel` omitted, `false` or unresolvable, agents offer the local URL only. A public tunnel hostname is reachable from the internet for as long as the tunnel lives. `bakers config check --scope machine` prints `Machine tunnel: <value> (from <file>)`.

## Shared service tunnels (`bakers ports`)

Configure [Ports](/addons/ports) and a [transport](/addons/ports-cloudflare) in this machine’s `addons`. This policy is independent of the single-preview `tunnel` flag above.

## Agents

### The agents object

[Agent policy fields](/configuration/agents/reference#the-agents-object) defines catalog overlays and optional filters.

### Which agent runs a state

[Routing precedence](/configuration/agents/reference#which-agent-runs-a-state) defines labels, routes and fallback.

### Harnesses

[Harness configuration](/configuration/agents/reference#harnesses) links package-specific options.

### Run security

[Execution security](/configuration/agents/execution-security) owns sandbox modes and prerequisites.

[Agents](/configuration/agents) owns harness selection and routing; [Agent policy reference](/configuration/agents/reference) lists every field and precedence rule.

## Verify

```sh
bakers config check --scope machine
bakers agents
```

Check host identity and capacity; from a connected checkout, the agent catalog must contain an installed, authenticated harness.
