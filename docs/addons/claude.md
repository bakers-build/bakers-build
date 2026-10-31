# Claude

**Lets bakers.build run tickets with the Claude Code CLI.**

## Enable it

Add the package to `addons` in `~/.bakers/machine.config.js`; agent harnesses may be listed only there.

```js
addons: ['@bakers-build/addon-claude'],
```

Without a `model` it publishes two aliases: `opus` for demanding work and `sonnet` for well-specified changes. Set `model` to publish one custom candidate instead:

```js
{ use: '@bakers-build/addon-claude', with: { model: 'opus', effort: 'high' } }
```

## Options

| Option | Type | Default | Effect |
|---|---|---|---|
| `model` | string | none | Passed as `--model`. Replaces `opus` and `sonnet` with one custom candidate. |
| `effort` | string | none | Passed as `--effort`. |
| `security` | `'sandbox'` \| `'system'` \| `'yolo'` \| `'custom'` | `'sandbox'` | How strictly a run starts; see [Security](#security). |
| `sandbox` | object | see below | Only with `security: 'sandbox'`. Each key set replaces its default; lists are not merged. |
| `config` | object | none | Required with, and only valid with, `security: 'custom'`. |
| `env_deny` | string[] | the [default list](/advanced/run-security#ticket-env-vars) | Ticket env var names (`*` globs) kept from the run. |
| `measure` | boolean | `false` | Starts Claude through the addon's measure wrapper. |
| `args` | string[] | `[]` | Extra arguments, each shell-quoted. |

## Security

A run starts sandboxed unless you choose otherwise, because ticket text is written by other people. What each mode blocks and misses, `env_deny`, risks and machine isolation: [Run security](/advanced/run-security).

| `security` | Launch flags |
|---|---|
| `sandbox` | `--permission-mode dontAsk --setting-sources project,local --settings '<generated>' --strict-mcp-config --mcp-config '<sandbox.mcp_servers>'` |
| `system` | none: your own Claude settings apply unchanged |
| `yolo` | `--dangerously-skip-permissions`, the launch before `security` existed |
| `custom` | `--settings '<config as JSON>'`, nothing else |

`sandbox` keys and their defaults:

| Key | Default | Becomes |
|---|---|---|
| `trusted_commands` | `['bakers', 'git', 'ddev']` | `sandbox.excludedCommands` as `<name> *`, or unchanged if ending in `*`: these run outside the sandbox |
| `deny_read` | `['~/.ssh', '~/.bakers']` | `sandbox.filesystem.denyRead` and the rules `Read(<path>)`, `Read(<path>/**)`; an absolute path becomes `//<path>` |
| `allow_write` | `[]` | `sandbox.filesystem.allowWrite`; the worktree and `$TMPDIR` are always writable |
| `network` | `['*']` | `sandbox.network.allowedDomains`; `['*']` allows every host |
| `mcp_servers` | `{}` | `--mcp-config`, in Claude's `mcpServers` shape |

```js
{ use: '@bakers-build/addon-claude', with: { sandbox: { trusted_commands: ['bakers', 'git', 'ddev', 'docker'] } } }
```

## Check it works

The agent catalog lists `opus` and `sonnet` (or your custom alias) with harness `claude`.

::: details Per CLI
```sh
bakers agents
```
:::

## Good to know

- Runs start with `CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1`: plugins declared in `.claude/settings.json` install before the first turn.
- The addon starts `claude`; it does not install it or sign it in. The binary must be on `PATH` for a non-interactive shell; an alias is not loaded.
- bakers.build owns `--session-id`, `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `--permission-mode`, `--settings`, `--setting-sources`, `--strict-mcp-config` and `--mcp-config`. Putting them in `args` fails loading.
- `skip_permissions` was removed; setting it fails loading. Use `security: 'yolo'` for the old bypass.
- With `measure: true`, the wrapper folds the generated or `custom` settings into its state-group settings; permission lists are joined.
- Listed in a conductor config, an agent addon is ignored with a warning.

More: [Choose agents and models](/advanced/configuration/agents-and-models), [Machines](/advanced/machines#harnesses).

Source: [`bakers-cli/addons/claude`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/claude)
