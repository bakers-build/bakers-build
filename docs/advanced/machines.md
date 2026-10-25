# Machines

`machine.config.js` is the private file that identifies one execution host and owns its capacity, preview-tunnel policy, agent harnesses and agent routes; every field is listed here with its default and precedence. To set agents up step by step, use [Choose agents and models](/advanced/configuration/agents-and-models). The web UI lists this account's machines at `/user/{user}/machines`. Opening a row shows View at `/user/{user}/machine/{id}` (host key, max parallel, current load) and Settings when the account owns the machine and holds `update own bb_machine`. Create, delete and the admin collection stay under `/admin/bakers/machine`.

## Location

| Item | Value |
|---|---|
| File | `~/.bakers/machine.config.js` |
| Relocate | `BB_HOME` names the `.bakers` directory itself, not a home containing one. It moves the machine file, the connection files and `connections/` together. A relative value resolves against the working directory. |
| Create | `bakers init` writes identity, capacity and an `addons` list naming the Claude, Codex and Grok harnesses. `bakers config init --scope machine` does the machine step alone. |
| Commit | Never. It is per user and per host. |

## Complete example

```js
// @bakers-schema-version 3
export default {
  schema_version: 3,
  machine_id: 'alex-laptop',
  user_id: 'alex',
  max_parallel: 1,
  tunnel: false,
  addons: [
    '@bakers-build/addon-codex',
    { use: '@bakers-build/addon-claude', with: { skip_permissions: true } },
    '@bakers-build/addon-bakers-ui-artifacts',
  ],
  agents: {
    catalog: [
      { harness: '@bakers-build/addon-codex', alias: 'codex', with: { model: 'gpt-5.6-terra' } },
    ],
    enabled: ['codex', 'opus', 'sonnet'],
    disabled: ['sonnet'],
    default_agent: 'codex',
    routes: {
      default: { working: 'codex', review: 'opus', '*': 'codex' },
      careful: { '*': 'opus' },
    },
  },
};
```

## Top-level fields

| Field | Meaning and default |
|---|---|
| `schema_version` | Current schema is 3. The `// @bakers-schema-version 3` header and this field must agree. `bakers config upgrade` raises older files. |
| `machine_id` | Required. Identifies this host; use a different value on every machine. Letters, digits, dot, underscore and hyphen, starting with a letter or digit. |
| `user_id` | Required. The local operator name, not the bakers.build account. Same character rules. The generated conductor identity is `<user_id>-<machine_id>-<project>`. |
| `max_parallel` | Positive integer, required by `bakers config check`. The conductor runtime falls back to `1` when it is missing or invalid. The budget is shared by every conductor on this host, not granted per project. |
| `tunnel` | Optional literal boolean, default `false`. See below. |
| `agents` | Object, described in the next section. An array is invalid. |
| `addons` | This host's addons, the same entry shape as a conductor config's `addons`: a package name or `{ use, alias?, with? }` (`name` and `options` are accepted aliases of `use` and `with`). Agent harnesses go here and are the source of agent candidates; with none, the catalog is empty and the conductor fails to load. Any addon whose page allows the machine file may go here too, for example `@bakers-build/addon-bakers-ui-artifacts` or `@bakers-build/addon-ports`. An entry in a file its addon does not allow is not loaded. See [Configure addons](/addons/configure). |
| `agents.addons`, `ports` | Retired. Loading fails with the exact replacement; `bakers config upgrade --scope machine` moves both into `addons`. |

Server URLs and credentials do not belong here. `bakers config check` reports `base_url`, `client_id`, `client_secret` and `workspace_id` in this file as misplaced; they live in the [connection](/advanced/connections). A `max_parallel` or `tunnel` in a connection or conductor file is misplaced the same way.

## Preview-link tunnels

`tunnel: true` lets agents on this host share a local HTTP(S) preview through a public `cloudflared` tunnel. It starts a tunnel only for the one service an agent is about to share, never for every port, and needs `cloudflared` on `PATH`. Agents read the result as `BB_TUNNEL` (`1` or `0`). With `tunnel` omitted, `false` or unresolvable, agents offer the local URL only. A public tunnel hostname is reachable from the internet for as long as the tunnel lives. `bakers config check --scope machine` prints `Machine tunnel: <value> (from <file>)`.

## Shared service tunnels (`bakers ports`)

The `@bakers-build/addon-ports` entry in `addons` gives every worktree on this
host a public name per shared service: fixed (`<ticket>-<key>.<zone>`) for
Named Cloudflare and frp, allocated per process for Quick,
through a pluggable transport addon — unlike the single ad hoc `tunnel`
boolean above, which only covers one unnamed preview link at a time. The
transport is the entry's `with.transport`; without the entry, `bakers ports up`
refuses and `bakers ports list` still lists:

```js
addons: [
  {
    use: '@bakers-build/addon-ports',
    with: {
      transport: {
        use: '@bakers-build/addon-ports-cloudflare', // or -cloudflare-quick, or -frp
        with: { /* transport-specific settings */ },
      },
    },
  },
],
```

**Named Cloudflare** (`@bakers-build/addon-ports-cloudflare`) needs a zone that is
actually managed by Cloudflare — its nameservers pointed at Cloudflare, not
just proxied there, since this transport creates real DNS records in it
through the API. Onboard the zone first (Cloudflare dashboard → **Add a
domain** → the full nameserver setup, not the partial/CNAME one; some ccTLDs
do not support the full setup at all, but a subdomain of an
already-Cloudflare-managed zone works without its own delegation). Create the
restricted API token at
[dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
with exactly the **"Cloudflare Tunnel"** (Account, Write) and **"DNS"** (Zone,
Edit) permissions, scoped to that one account and zone.

## The agents object

```js
agents: { catalog, enabled, disabled, default_agent, routes }
```

The candidates come from the harnesses in the top-level `addons`.

| Field | Meaning and default |
|---|---|
| `catalog` | Optional overlays `{ harness, alias?, with? }`. `harness` must also appear in the top-level `addons`. An overlay with an existing alias replaces that candidate; a new alias adds one. A harness that publishes several candidates needs `alias`. |
| `enabled` | Optional allowlist of aliases. Omitted means every candidate. `[]` removes all and fails. An unknown alias fails. |
| `disabled` | Denylist applied after `enabled`. Default empty. An unknown alias fails. |
| `default_agent` | Fallback alias. Default is the first remaining candidate. It must survive the filters or loading fails. |
| `routes` | Named maps from a workflow state (or `'*'`) to an alias. If `default` is missing it becomes `{ '*': default_agent }`. Every route needs at least one entry and every value a non-empty alias. |

Loading builds the effective catalog in this order: candidates from the top-level `addons`, then `catalog` overlays (later wins), then `enabled`, then `disabled`. Errors appear when the conductor or `bakers agents` loads the file; `bakers config check --scope machine` does not inspect `agents`. Each failure is a one-line message, for example `agents.default_agent names unavailable alias 'codex'`.

### Which agent runs a state

The conductor takes the first match, top to bottom. Labels are ticket labels; `<state>` is the current workflow state.

1. `agent:<alias>@<state>` naming an available alias.
2. `agent:<alias>` naming an available alias.
3. `agent:<route>@<state>` naming a route with an entry for the state or `'*'`.
4. `agent:<route>`, same rule.
5. `routes.default[<state>]`.
6. `routes.default['*']`.
7. `default_agent`.
8. Priority order: candidates with a `priority` function first, then config order.

Unknown or unavailable labels log a warning and fall through; `agent:default` is ignored. A direct alias always beats a route, whatever the label order. A conductor `selectAgent` function replaces this whole chain. Routes choose an agent for the current state only; they neither pick a conductor nor move the ticket, so the same route names must exist on every host that may run the ticket.

## Harnesses

Options go in the addon entry's `with` object (or a `catalog` entry). The addon starts the vendor CLI; it does not install it or sign it in.

| Package | Aliases | Options |
|---|---|---|
| `@bakers-build/addon-claude` | `opus`, `sonnet` | `model`, `effort`, `skip_permissions` (default `true`), `args`, `measure` (default `false`) |
| `@bakers-build/addon-codex` | `codex`, `astra`, `sol`, `terra`, `luna` | `model`, `effort`, `args` |
| `@bakers-build/addon-kimi` | `kimi` | `model`, `args`; `effort` is ignored with a log line |
| `@bakers-build/addon-opencode` | `opencode` | `model`, `args`; `effort` is ignored with a log line |
| `@bakers-build/addon-pi` | `pi` | `model`, `provider`, `thinking` or `effort`, `approve`, `args` |
| `@bakers-build/addon-grok` | `grok` (Grok CLI default) | `model`, `effort` (or legacy `reasoningEffort`), `args` |

Setting `model` on Claude publishes one custom candidate instead of `opus` and `sonnet`; on Codex it drops the four named variants. Run `bakers agents` to see what your release actually publishes.

Omitting `model` for Grok uses the Grok CLI's own default. An explicit `model` pins that version. Passthrough `-m`/`--model` in `args` wins over the configured model. `grok-4.5` below is an example pin, not an addon default:

```js
{ use: '@bakers-build/addon-grok', with: { model: 'grok-4.5' } }
```

Place that object in `addons` of `machine.config.js`. An agent harness in a conductor config is not loaded and warns.

`args` is a list of strings appended, in order, each as one shell-quoted argument. Paths must be absolute: an element starting with `~`, or a long option assigned a value starting with `~`, fails loading. `args` may carry `--model` or `--effort`; bakers.build then omits its own flag. Precedence: explicit `args`, then `effort`, then a harness-specific legacy setting, then the harness default. Flags bakers.build owns are rejected in `args`:

| Package | Reserved |
|---|---|
| claude | `--session-id`, `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `--permission-mode` |
| codex | `--sandbox`, `-s`, `--dangerously-bypass-approvals-and-sandbox`, `--dangerously-bypass-hook-trust` |
| kimi | `-p`, `--prompt`, `--output-format` |
| opencode | `--prompt`, `--auto` |
| pi | `--session-dir`, `--approve`, `-a`, `--no-approve`, `-na` |
| grok | `--permission-mode`, `--session-id` |

`skip_permissions: false` only omits bakers.build's bypass flag; Claude settings that select bypass mode still apply. Pi's `approve` trusts project-local Pi files and grants no bakers.build access. Claude `measure: true` launches Claude through the addon's measure wrapper, which runs a logging proxy for that process and applies the state-group settings; it also works on a `catalog` entry.

## Mixed harnesses

Codex for coding, Claude Opus for review, a `careful` route that uses Opus throughout:

```js
// @bakers-schema-version 3
export default {
  schema_version: 3,
  machine_id: 'alex-laptop',
  user_id: 'alex',
  max_parallel: 1,
  addons: ['@bakers-build/addon-codex', '@bakers-build/addon-claude'],
  agents: {
    enabled: ['codex', 'opus'],
    default_agent: 'codex',
    routes: {
      default: { working: 'codex', review: 'opus', '*': 'codex' },
      careful: { '*': 'opus' },
    },
  },
};
```

| Ticket labels | Working | Review | Other states |
|---|---|---|---|
| none | `codex` | `opus` | `codex` |
| `agent:careful` | `opus` | `opus` | `opus` |
| `agent:opus@working` | `opus` | `opus` (default route) | `codex` |
| `agent:codex` | `codex` | `codex` | `codex` |

## Old keys and verification

Agent addons in a conductor config are ignored with a warning, and the retired keys `agent`, `agents`, `default_agent` and `agent_routes` there are rejected. `bakers config upgrade --scope all` moves supported old policy here ([migration](/advanced/migration)).

```sh
bakers config check --scope machine
bakers agents
```

`bakers agents` prints the resolved aliases, harnesses, models, `enabled_agents`, `disabled_agents`, `default_agent` and `routes` as JSON, without signing in or starting an agent. It reads the conductor config of the current checkout, so run it there. Its `enabled_agents` and `disabled_agents` are output fields, not configuration keys.
