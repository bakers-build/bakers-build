# Grok

**Runs tickets with xAI Grok Build.**

Install and authenticate using the [vendor guide](https://docs.x.ai/build/overview). Keep `grok` on the conductor's `PATH`.

## Enable it

In `~/.bakers/machine.config.js`:

```js
addons: [{ use: '@bakers-build/addon-grok', with: {} }],
```

The alias is `grok`; `bakers agents` lists it.

## Options

| Option | Default | Effect |
|---|---|---|
| `model` | CLI default | `--model` |
| `effort` | none | `--reasoning-effort`; overrides `reasoningEffort` |
| `security` | `sandbox` | See below |
| `sandbox` | below | Only in sandbox mode |
| `env_deny` | [default list](/configuration/agents/execution-security#ticket-env-vars) | Filters ticket environment |
| `args` | `[]` | Shell-quoted arguments; explicit model flags win |

## Security

| Mode | Flags |
|---|---|
| `sandbox` | `--sandbox workspace --permission-mode acceptEdits --allow 'Bash(*)' --deny 'MCPTool(*)'` |
| `system` | none |
| `yolo` | `--permission-mode bypassPermissions` |
| `custom` | rejected |

| Sandbox key | Accepted value |
|---|---|
| `network` | `['*']` |
| `mcp_servers` | `{}` |
| `trusted_commands`, `deny_read` | `[]` |
| `allow_write` | Existing absolute or `~/` directories; default `[]` |

```js
with: {
  sandbox: {
    allow_write: ['/projects/example/.git', '~/.ddev', '~/.npm'],
  },
},
```

Nonempty `allow_write` selects a unique managed profile extending `workspace`. Globs, relative paths and whitespace edges fail; symlinks resolve before launch. Whole directory trees become writable, including granted Git hooks/configuration. This grants no Docker isolation or command exceptions.

Requires Grok 1.0.70+, Linux Landlock and bubblewrap, or macOS Seatbelt. macOS enforcement remains unverified. Unavailable custom-profile enforcement fails closed.

Bakers appends to `~/.grok/sandbox.toml` and removes its appended bytes after exit, preserving existing configuration, authentication and transcripts. A newly created file remains empty. Nonempty enterprise requirements, symlinked Grok homes and symlinked/hard-linked profile files block launch.

One managed run per Grok home: concurrent runs fail. After crashes, inspect `.bakers-profile.lock`, confirm its PID stopped, and remove only its recorded profile and lock. Concurrent operator edits are preserved and reported; unfinished profiles block launch.

Reserved arguments: `--permission-mode`, `--session-id`/`-s`; in sandbox mode also `--sandbox`, `--always-approve`, `--allow`, `--allowedTools`, `--allowed-tools`, `--add-dir`, `--cwd`, `--worktree`/`-w`, `--agents`, `--agent`. Managed profiles additionally reserve `--continue`/`-c`, `--resume`/`-r`, `--fork-session`, `--restore-code`, `--leader-socket`. Clustered flags and bare subcommands cannot bypass these restrictions.

`bakers oven check` checks Linux prerequisites. Storage, directory and version checks precede launch. Shell approval prompts remain possible; unattended DDEV completion is unverified.

More: [Run security](/configuration/agents/execution-security#grok-in-sandbox-mode), [Choose agents](/configuration/agents).
