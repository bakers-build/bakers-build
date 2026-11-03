# Codex

Run tickets with the OpenAI Codex CLI.

## AI first

Ask your AI to check this harness and its [bakers skills](/configuration/agents/skills).

## Setup

Follow the [vendor installation guide](https://learn.chatgpt.com/docs/codex/cli), then authenticate `codex` as the conductor user and check it resolves on `PATH`.

## Enable it

Add the package to `addons` in `~/.bakers/machine.config.js`; agent harnesses may be listed only there. Keep the other fields there.

```js
addons: ['@bakers-build/addon-codex'],
```

Without a `model` it publishes `codex` (your locally configured Codex model) plus four named variants: `astra`, `sol`, `terra` and `luna`. With a `model` it publishes only `codex`.

## Options

| Option | Type | Default | Effect |
|---|---|---|---|
| `model` | string | Codex's own default | Passed as `--model`. Drops the four named variants. |
| `effort` | string | none | Passed as `-c model_reasoning_effort=…`. |
| `security` | `'sandbox'` \| `'system'` \| `'yolo'` \| `'custom'` | `'sandbox'` | How strictly a run starts; see [Security](#security). |
| `sandbox` | object | see below | Only with `security: 'sandbox'`. Each key set replaces its default; lists are not merged. |
| `config` | object | none | Required with, and only valid with, `security: 'custom'`. |
| `env_deny` | string[] | the [default list](/configuration/agents/execution-security#ticket-env-vars) | Ticket env var names (`*` globs) kept from the run. |
| `args` | string[] | `[]` | Extra arguments, each shell-quoted. |

## Security

Runs default to the OS sandbox. [Execution security](/configuration/agents/execution-security) owns boundaries, environment filtering and isolation risks.

| `security` | Launch flags |
|---|---|
| `sandbox` | `-a never` with a generated `bakers` permission profile extending `:workspace`; MCP servers not in `mcp_servers` are disabled |
| `system` | none: your own `~/.codex/config.toml` applies unchanged |
| `yolo` | `--sandbox danger-full-access --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust`, the launch before `security` existed |
| `custom` | one `-c key=value` per `config` entry (non-string values as JSON), nothing else; an object value fails loading, so write one dotted key per value (`'a.b': 1`) |

`sandbox` keys and their defaults:

| Key | Default | Becomes |
|---|---|---|
| `allow_write` | `[]` | Additional profile workspace roots; a leading `~/` is expanded |
| `network` | `['*']` | network on when not empty; Codex has no host list, so any non-empty value allows every host |
| `mcp_servers` | `{}` | the names of servers from your Codex config that stay enabled |
| `trusted_commands`, `deny_read` | `[]` | Codex has no equivalent; a non-empty list fails loading rather than promise a protection Codex does not give |

Needs Codex 0.166.0+. Writable: Git directories, not config or hooks; read-only: `.agents`, `.codex`, `.aws`.

## Check it works

The agent catalog lists `codex` with harness `codex`.

::: details Per CLI
```sh
bakers agents
```
:::

## Good to know

- `--sandbox`, `-s`, `-a`, `--ask-for-approval`, `--dangerously-bypass-approvals-and-sandbox` and `--dangerously-bypass-hook-trust` are reserved; putting them in `args` fails loading.
- Listed in a conductor config, an agent addon is ignored with a warning.

More: [Choose agents and models](/configuration/agents), [Machines](/configuration/agents/reference#harnesses).

