# Claude

Run tickets with Claude Code.

## AI first

Ask AI to check this harness and its [skills](/skills-and-workflows/skills).

## Setup

[Install Claude](https://docs.claude.com/en/docs/claude-code/setup), authenticate as the conductor user and put its binary on `PATH`.

## Enable it

Enable only in `~/.bakers/machine.config.js`:

```js
addons: ['@bakers-build/addon-claude'],
```

Aliases: `opus` (reasoning), `sonnet` (well-specified changes), `fable` (demanding work), `opus-proxy` (request logs in ignored `assets-ai/`). Select `agent:fable`, or `agent:fable@working` for working only.

Fable needs Claude Code **2.1.257+** and provider access. `--model fable` honors `ANTHROPIC_DEFAULT_FABLE_MODEL`; see [Fable documentation](https://code.claude.com/docs/en/model-config#work-with-fable).

One custom candidate:

```js
{ use: '@bakers-build/addon-claude', with: { model: 'opus', effort: 'high' } }
```

## Options

<!-- @options @bakers-build/addon-claude -->

Without `env_deny`, the [default list](/provision/security/execution#ticket-env-vars) of ticket env vars is kept from the run.

## Security

Default: `system`. An isolating [runtime](/addons/runtime-docker) turns `sandbox` into `system`. See [Execution security](/provision/security/execution) for boundaries, environment filtering and isolation risks.

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

## Container runtime

The [Docker runtime](/addons/runtime-docker) gives Claude a per-run home with agent settings, never
its login. Setup is pre-approved; plugins are read-only and transcripts stay on the host. Export
`CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`) or `ANTHROPIC_API_KEY`; allowlist mode keeps it in the proxy.

## Deny unused tools

Deny unused built-in tools in committed `.claude/settings.json`. [Project setup](/get-started/connect-a-project) writes your choices.

```json
{ "permissions": { "deny": ["<ToolName>"] } }
```

- **Saves:** a denied tool's definition leaves every model request.
- **Binds:** interactive sessions in the repository too.
- **Lives in one file:** deny rules from all settings sources merge and `deny` wins; only deleting the line re-enables a tool.

Keep `AskUserQuestion` for planning; measure with `agent:opus-proxy`.

## Check it works

`bakers agents` lists these aliases under harness `claude`. Claude-only default: `opus`.

::: details Per CLI
```sh
bakers agents
```
:::

## Good to know

- Install and authenticate `claude` yourself; non-interactive shells need its binary on `PATH`.
- bakers.build owns `--session-id`, `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `--permission-mode`, `--settings`, `--setting-sources`, `--strict-mcp-config` and `--mcp-config`. Putting them in `args` fails loading.
- `skip_permissions` and `security` fail loading; use `permissions` (`'yolo'` for the old bypass).
- With `measure: true`, the wrapper folds the generated or `custom` settings into its state-group settings; permission lists are joined.
- `proxy: true` only logs the requests; `measure` wins when both are set.
- Listed in a project config, an agent addon is ignored with a warning.

More: [Choose agents and models](/agents/guide), [Machines](/agents/reference#harnesses).

