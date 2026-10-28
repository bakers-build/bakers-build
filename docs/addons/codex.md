# Codex

**Lets bakers.build run tickets with the OpenAI Codex CLI.**

For anyone whose machine should run tickets with Codex.

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
| `env_deny` | string[] | the [default list](/advanced/run-security#ticket-env-vars) | Ticket env var names (`*` globs) kept from the run. |
| `args` | string[] | `[]` | Extra arguments, each shell-quoted. |

## Security

A run starts sandboxed unless you choose otherwise, because ticket text is written by other people. What each mode blocks and misses, `env_deny`, risks and machine isolation: [Run security](/advanced/run-security).

| `security` | Launch flags |
|---|---|
| `sandbox` | `--sandbox workspace-write -a never -c sandbox_workspace_write.network_access=<network not empty>`, `--add-dir` per `allow_write`, and `-c mcp_servers.<id>.enabled=false` for every server in `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`) not named in `mcp_servers` |
| `system` | none: your own `~/.codex/config.toml` applies unchanged |
| `yolo` | `--sandbox danger-full-access --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust`, the launch before `security` existed |
| `custom` | one `-c key=value` per `config` entry (non-string values as JSON), nothing else; an object value fails loading, so write one dotted key per value (`'a.b': 1`) |

`sandbox` keys and their defaults:

| Key | Default | Becomes |
|---|---|---|
| `allow_write` | `[]` | `--add-dir <path>`; a leading `~/` is expanded |
| `network` | `['*']` | network on when not empty; Codex has no host list, so any non-empty value allows every host |
| `mcp_servers` | `{}` | the names of servers from your Codex config that stay enabled |
| `trusted_commands`, `deny_read` | `[]` | Codex has no equivalent; a non-empty list fails loading rather than promise a protection Codex does not give |

## Check it works

The agent catalog lists `codex` with harness `codex`.

::: details Per CLI
```sh
bakers agents
```
:::

## Good to know

- `--sandbox`, `-s`, `-a`, `--ask-for-approval`, `--dangerously-bypass-approvals-and-sandbox` and `--dangerously-bypass-hook-trust` are reserved; putting them in `args` fails loading.
- The addon starts `codex`; it does not install it or sign it in. The binary must be on `PATH`.
- Listed in a conductor config, an agent addon is ignored with a warning.

More: [Choose agents and models](/advanced/configuration/agents-and-models), [Machines](/advanced/machines#harnesses).

Source: [`bakers-cli/addons/codex`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/codex)
