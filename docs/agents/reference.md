# Agent policy reference

Configure agent plugins and selection policy in `~/.bakers/machine.config.js`; keep it private. This reference is for machine owners with an installed harness program and a connected project checkout. Start with [Configure and select agents](/agents/guide) for the two separate tasks; after changes, [verify the resolved catalog](#old-keys-and-verification).

## The agents object

```js
agents: { catalog, enabled, disabled, default_agent, routes }
```

Harness addons in the top-level `addons` supply agent plugins and their initial configurations. Each available configuration has an alias used for selection.

### Configure the catalog

| Field | Meaning and default |
|---|---|
| `catalog` | Optional overlays `{ harness, alias?, with? }`. `harness` must also appear in the top-level `addons`. An overlay with an existing alias replaces that candidate; a new alias adds one. A harness that publishes several candidates needs `alias`. |
| `enabled` | Optional allowlist of aliases. Omitted means every candidate. `[]` removes all and fails. An unknown alias fails. |
| `disabled` | Denylist applied after `enabled`. Default empty. An unknown alias fails. |

Loading builds the effective catalog in this order: candidates from the top-level `addons`, then `catalog` overlays (later wins), then `enabled`, then `disabled`. Errors appear when the conductor or `bakers agents` loads the file; `bakers config check --scope machine` does not inspect `agents`. Each failure is a one-line message, for example `agents.default_agent names unavailable alias 'codex'`.

### Configure selection

These fields choose among the configured aliases; they do not configure the plugins themselves. Ticket labels can override them according to the rules below.

| Field | Meaning and default |
|---|---|
| `default_agent` | Fallback alias. Default is the first remaining candidate. It must survive the filters or loading fails. |
| `routes` | Named maps from a workflow state (or `'*'`) to an alias. If `default` is missing it becomes `{ '*': default_agent }`. Every route needs at least one entry and every value a non-empty alias. |

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

| Harness reference | Configuration it owns |
|---|---|
| [Claude Code](/addons/claude) | Claude aliases, models, effort, measurement and reserved arguments |
| [Codex](/addons/codex) | Codex aliases, models, effort and reserved arguments |
| [Kimi](/addons/kimi) | Kimi model and arguments |
| [OpenCode](/addons/opencode) | OpenCode model and arguments |
| [Pi](/addons/pi) | Provider, model, thinking and local-file approval |
| [Grok](/addons/grok) | Model pins, reasoning effort and reserved arguments |

Run `bakers agents` in the project checkout to see the aliases and models your installed addons publish. A custom `model` can change that catalog; use the addon reference before pinning it. Harnesses belong in the machine file; a harness in a project conductor config is ignored with a warning.

`args` is a list of strings appended in order as separate shell-quoted arguments. Values starting with `~`, including `--option=~/path`, are rejected; use absolute paths. Supported passthrough arguments and flags reserved by bakers.build differ by harness and are listed in those references.

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

This complete file uses the special `default` route for Codex coding and Claude Opus review without a ticket label. The named `careful` route uses Opus throughout. For a complete opt-in route setup, follow [Use agent routes](/agents/guide#use-agent-routes).

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

Agent addons in a conductor config are ignored with a warning, and the retired keys `agent`, `agents`, `default_agent` and `agent_routes` there are rejected. Move that policy here by hand.

```sh
bakers config check --scope machine
bakers agents
```

`bakers agents` prints the resolved aliases, harnesses, models, `enabled_agents`, `disabled_agents`, `default_agent` and `routes` as JSON, without signing in or starting an agent. It reads the conductor config of the current checkout, so run it there. Its `enabled_agents` and `disabled_agents` are output fields, not configuration keys.
