# Grok

**Lets bakers.build run tickets with xAI Grok Build.**

For anyone whose machine should run tickets with the Grok CLI.

## AI first

Ask your AI to check this harness and its [bakers skills](/configuration/agents/skills).

## Setup

Follow the [vendor installation guide](https://docs.x.ai/build/overview), then authenticate `grok` as the conductor user and check it resolves on `PATH`.

## Enable it

Add the package to `addons` in `~/.bakers/machine.config.js`; agent harnesses may be listed only there. Keep the other fields there.

```js
addons: [{ use: '@bakers-build/addon-grok', with: { model: 'grok-4.5' } }],
```

`grok-4.5` is an example pin, not a default. It publishes one alias, `grok`.

## Options

| Option | Type | Default | Effect |
|---|---|---|---|
| `model` | string | Grok CLI default | Passed as `--model`. |
| `effort` | string | none | Passed as `--reasoning-effort`. |
| `reasoningEffort` | string | none | Older name for `effort`; `effort` wins. |
| `security` | `'sandbox'` \| `'system'` \| `'yolo'` | `'sandbox'` | How strictly a run starts; see [Security](#security). `'custom'` fails loading. |
| `sandbox` | object | see below | Only with `security: 'sandbox'`. Only the defaults are accepted. |
| `env_deny` | string[] | the [default list](/configuration/agents/execution-security#ticket-env-vars) | Ticket env var names (`*` globs) kept from the run. |
| `args` | string[] | `[]` | Extra arguments, each shell-quoted. A `-m`/`--model` here wins over `model`. |

## Security

What each mode blocks and misses: [Run security](/configuration/agents/execution-security#grok-in-sandbox-mode).

| `security` | Launch flags |
|---|---|
| `sandbox` | `--sandbox workspace --permission-mode acceptEdits --allow 'Bash(*)' --deny 'MCPTool(*)'` |
| `system` | none |
| `yolo` | `--permission-mode bypassPermissions` |
| `custom` | fails loading; use `system` with `args: ['--sandbox', '<profile>']` |

Custom Grok profiles live in `sandbox.toml`, which bakers.build does not write, so `sandbox` keys keep their defaults; any other value fails loading, naming the key:

| Key | Default | Why fixed |
|---|---|---|
| `network` | `['*']` | `workspace` allows every host |
| `mcp_servers` | `{}` | every MCP tool is denied |
| `trusted_commands` | `[]` | no narrow command exception |
| `deny_read`, `allow_write` | `[]` | needs a `sandbox.toml` profile |

`--permission-mode` and `--session-id` (`-s`) are reserved; in `sandbox` mode also `--sandbox`, `--always-approve`, `--allow`, `--allowedTools`, `--allowed-tools`, `--add-dir`, `--cwd`, `--worktree` (`-w`), `--agents` and `--agent`. A reserved flag in `args` fails loading, also inside a short-flag cluster such as `-cw`. In `sandbox` mode a bare token is allowed only as the value of a Grok flag that takes one, such as `-m`, `-r` or `--rules` (a cluster only after `-c`, `-h`, `-v`, as in `-cm`), because Grok would run any other bare token, such as `wrap`, as a subcommand.

`bakers oven check` needs Landlock on Linux and nothing on macOS; other platforms fail.

## Check it works

The agent catalog lists `grok` with harness `grok`.

::: details Per CLI
```sh
bakers agents
```
:::

## Good to know

- Before `security` existed, Grok always ran with `--permission-mode bypassPermissions`. Set `security: 'yolo'` to keep that launch.

More: [Choose agents and models](/configuration/agents), [Machines](/configuration/agents/reference#harnesses).

