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

| Option | Type | Default | Effect |
|---|---|---|---|
| `model` | string | none | Passed as `--model`. Replaces `opus`, `sonnet` and `fable` with one custom candidate. |
| `effort` | string | none | Passed as `--effort`. |
| `permissions` | `'sandbox'` \| `'system'` \| `'yolo'` \| `'custom'` | `'system'` | How strictly a run starts; see [Security](#security). |
| `sandbox` | object | see below | Only with `permissions: 'sandbox'`. Each key set replaces its default; lists are not merged. |
| `config` | object | none | Required with, and only valid with, `permissions: 'custom'`. |
| `env_deny` | string[] | the [default list](/provision/security/execution#ticket-env-vars) | Ticket env var names (`*` globs) kept from the run. |
| `measure` | boolean | `false` | Starts Claude through the addon's measure wrapper. |
| `guard` | boolean | `true` | `false` turns the [run guard](/provision/security/run-guard) off. |
| `args` | string[] | `[]` | Extra arguments, each shell-quoted. |

## Security

Default: `system`. See [Execution security](/provision/security/execution) for boundaries, environment filtering and isolation risks. Every mode adds the [run guard](/provision/security/run-guard) hook.

| `permissions` | Launch flags |
|---|---|
| `sandbox` | `--permission-mode default --setting-sources project,local --settings '<generated, with the guard hook>' --strict-mcp-config --mcp-config '<sandbox.mcp_servers>'` |
| `system` | `--settings '<guard hook>'` over your own settings |
| `yolo` | `--dangerously-skip-permissions --settings '<guard hook>'` |
| `custom` | `--settings '<config as JSON, plus the guard hook>'` |

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
- Listed in a conductor config, an agent addon is ignored with a warning.

More: [Choose agents and models](/agents/guide), [Machines](/agents/reference#harnesses).

