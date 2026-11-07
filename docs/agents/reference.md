# Agent policy reference

Owned by `~/.bakers/machine.config.js`; keep it private.

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
| `@bakers-build/addon-claude` | `opus`, `sonnet` | `model`, `effort`, `security`, `sandbox`, `config`, `env_deny`, `args`, `measure` (default `false`) |
| `@bakers-build/addon-codex` | `codex`, `astra`, `sol`, `terra`, `luna` | `model`, `effort`, `security`, `sandbox`, `config`, `env_deny`, `args` |
| `@bakers-build/addon-kimi` | `kimi` | `model`, `args`; `effort` is ignored with a log line |
| `@bakers-build/addon-opencode` | `opencode` | `model`, `args`; `effort` is ignored with a log line |
| `@bakers-build/addon-pi` | `pi` | `model`, `provider`, `thinking` or `effort`, `approve`, `args` |
| `@bakers-build/addon-grok` | `grok` (Grok CLI default) | `model`, `effort` (or legacy `reasoningEffort`), `security`, `sandbox`, `env_deny`, `args` |

Setting `model` on Claude publishes one custom candidate instead of `opus` and `sonnet`; on Codex it drops the four named variants. Run `bakers agents` to see what your release actually publishes.

Omitting `model` for Grok uses the Grok CLI's own default. An explicit `model` pins that version. Passthrough `-m`/`--model` in `args` wins over the configured model. `grok-4.5` below is an example pin, not an addon default:

```js
{ use: '@bakers-build/addon-grok', with: { model: 'grok-4.5' } }
```

Place that object in `addons` of `machine.config.js`. An agent harness in a conductor config is not loaded and warns.

`args` is a list of strings appended, in order, each as one shell-quoted argument. Paths must be absolute: an element starting with `~`, or a long option assigned a value starting with `~`, fails loading. `args` may carry `--model` or `--effort`; bakers.build then omits its own flag. Precedence: explicit `args`, then `effort`, then a harness-specific legacy setting, then the harness default. Flags bakers.build owns are rejected in `args`:

| Package | Reserved |
|---|---|
| claude | `--session-id`, `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `--permission-mode`, `--settings`, `--setting-sources`, `--strict-mcp-config`, `--mcp-config` |
| codex | `--sandbox`, `-s`, `-a`, `--ask-for-approval`, `--dangerously-bypass-approvals-and-sandbox`, `--dangerously-bypass-hook-trust` |
| kimi | `-p`, `--prompt`, `--output-format` |
| opencode | `--prompt`, `--auto` |
| pi | `--session-dir`, `--approve`, `-a`, `--no-approve`, `-na` |
| grok | `--permission-mode`, `--session-id` |

Pi's `approve` trusts project-local Pi files and grants no bakers.build access. Claude `measure: true` launches Claude through the addon's measure wrapper, which runs a logging proxy for that process and applies the state-group settings; it also works on a `catalog` entry.

## Run security

Claude and Codex runs start sandboxed by default. Set `security`, the `sandbox` keys, `config` and `env_deny` in a harness entry's `with`; a `catalog` entry uses only its own `with`. The mode and the `deny_read`, `allow_write` and `trusted_commands` lists can also be set once for every agent in a top-level `security` block of `machine.config.js` or the project's `.bakers/conductor.config.js`; layers combine as [Shared run security](/provision/security/shared-settings) describes, including the risk of a committed project block that loosens the sandbox.

```js
agents: {
  catalog: [
    { harness: '@bakers-build/addon-claude', alias: 'opus-yolo', with: { model: 'opus', security: 'yolo' } },
  ],
},
```

Modes, blocks, env var filter, risks and isolation: [Run security](/provision/security/execution).

## Mixed harnesses

Codex for coding, Claude Opus for review, a `careful` route that uses Opus throughout:

```js
// @bakers-schema-version 1
export default {
  schema_version: 1,
  machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',
  label: 'alex-laptop',
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

Agent addons in a conductor config are ignored with a warning, and the retired keys `agent`, `agents`, `default_agent` and `agent_routes` there are rejected. Move that policy here by hand ([migration](/configuration/project/migration)).

```sh
bakers config check --scope machine
bakers agents
```

`bakers agents` prints the resolved aliases, harnesses, models, `enabled_agents`, `disabled_agents`, `default_agent` and `routes` as JSON, without signing in or starting an agent. It reads the conductor config of the current checkout, so run it there. Its `enabled_agents` and `disabled_agents` are output fields, not configuration keys.
