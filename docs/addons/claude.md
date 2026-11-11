# Claude

Run tickets with Claude Code.

## AI first

Ask AI to check this harness and its [skills](/skills-and-workflows/skills).

## Setup

Follow the [installation guide](https://docs.claude.com/en/docs/claude-code/setup), authenticate as the conductor user and check `claude` is on `PATH`.

## Enable it

Enable only in `~/.bakers/machine.config.js`:

```js
addons: ['@bakers-build/addon-claude'],
```

Aliases: `opus` for reasoning, `sonnet` for well-specified changes, `fable` for demanding, long-running work. Select `agent:fable`, or `agent:fable@working` for working only.

Fable uses `--model fable`; supported baseline: Claude Code **2.1.257+**. This version-free selector honors `ANTHROPIC_DEFAULT_FABLE_MODEL`; account/provider access still applies. See [Claude's Fable documentation](https://code.claude.com/docs/en/model-config#work-with-fable).

One custom candidate:

```js
{ use: '@bakers-build/addon-claude', with: { model: 'opus', effort: 'high' } }
```

## Options

<!-- @options @bakers-build/addon-claude -->

## Security

Default: `system`. See [Execution security](/provision/security/execution) for boundaries, environment filtering and isolation risks.

| `permissions` | Launch flags |
|---|---|
| `sandbox` | `--permission-mode default --setting-sources project,local --settings '<generated>' --strict-mcp-config --mcp-config '<sandbox.mcp_servers>'` |
| `system` | none: your own Claude settings apply unchanged |
| `yolo` | `--dangerously-skip-permissions`, the launch before `permissions` existed |
| `custom` | `--settings '<config as JSON>'`, nothing else |

`sandbox` keys and their defaults:

| Key | Default | Becomes |
|---|---|---|
| `trusted_commands` | `[]` | `sandbox.excludedCommands` as `<name> *`, or unchanged if ending in `*`: these run outside the sandbox |
| `deny_read` | `['~/.ssh', '~/.bakers']` | `sandbox.filesystem.denyRead` and the rules `Read(<path>)`, `Read(<path>/**)`; an absolute path becomes `//<path>` |
| `allow_write` | `[]` | `sandbox.filesystem.allowWrite`, plus worktree, `$TMPDIR`, [Git metadata](/provision/security/execution#git-metadata-in-codex-and-claude-sandboxes); `.git` dropped |
| `network` | `['*']` | `sandbox.network.allowedDomains`; `['*']` allows every host |
| `mcp_servers` | `{}` | `--mcp-config`, in Claude's `mcpServers` shape; plus [`bakers`](/addons/build/tools) |

```js
{ use: '@bakers-build/addon-claude', with: { permissions: 'sandbox', sandbox: { trusted_commands: ['git', 'docker'] } } }
```

## Check it works

`bakers agents` lists these aliases under harness `claude`. Claude-only default: `opus`.

::: details Per CLI
```sh
bakers agents
```
:::

## Good to know

- The addon starts `claude` without installing or authenticating it. Non-interactive shells need the binary on `PATH`, not an alias.
- bakers.build owns `--session-id`, `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `--permission-mode`, `--settings`, `--setting-sources`, `--strict-mcp-config` and `--mcp-config`. Putting them in `args` fails loading.
- `skip_permissions` and `security` fail loading; use `permissions` (`'yolo'` for the old bypass).
- With `measure: true`, the wrapper folds the generated or `custom` settings into its state-group settings; permission lists are joined.
- Listed in a project config, an agent addon is ignored with a warning.

More: [Choose agents and models](/agents/guide), [Machines](/agents/reference#harnesses).

