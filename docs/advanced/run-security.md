---
title: Run security
description: How strictly Claude and Codex runs start on a machine - the security modes, what each harness sandbox blocks and what it does not, the ticket env var filter, the risk of loosening and operator-side isolation.
---

# Run security

A run executes text other people wrote (ticket title, description, comments, env vars) on your machine, so Claude and Codex runs start safe by default and only `machine.config.js` decides how strictly. Each harness entry's `with` takes `security`; a `catalog` entry uses its own `with` instead, so a key it does not set takes the default, not the harness entry's value. There is no global or conductor-level setting. Where to set it: [Machines › Run security](/advanced/machines#run-security).

## Modes

| `security` | Meaning | MCP servers | Denied ticket env vars |
|---|---|---|---|
| `sandbox` (default) | No permission bypass; the harness's own OS sandbox, tuned by the `sandbox` keys | only `sandbox.mcp_servers` (default none) | dropped |
| `system` | bakers.build adds no security flag; your own harness configuration decides | yours | dropped |
| `yolo` | Full access, permissions and sandbox bypassed | yours | passed |
| `custom` | Only your `config`, handed to the harness unchanged | as `config` says | dropped |

The launch flags per mode, the `sandbox` keys and their defaults are on the [Claude](/addons/claude#security) and [Codex](/addons/codex#security) pages. Loading fails for an unknown mode, `skip_permissions` (use `security: 'yolo'`), `config` outside `custom`, `custom` without `config`, a `sandbox` block outside `sandbox` mode or an unknown `sandbox` key, so a typo never starts a run with rights you did not choose.

## Claude in `sandbox` mode

The generated settings set `sandbox.enabled`, `sandbox.failIfUnavailable: true`, `sandbox.allowUnsandboxedCommands: false`, `disableClaudeAiConnectors: true` and allow `Bash`, `Edit(./**)` and `AskUserQuestion`. They run without a prompt. Anything else asks you in the run's terminal, because Claude starts in `default` permission mode: `dontAsk` would deny it outright, and no allow rule can permit a write to a protected path such as `.claude/` or `.git`. A run nobody watches therefore waits at such a prompt.

What the default blocks:

- Shell commands that write outside the worktree, `$TMPDIR` and `allow_write`.
- Shell commands and Claude's Read tool reading a `deny_read` path.
- Network access from shell commands to hosts outside `network`.
- Your user-level MCP servers from `~/.claude.json`, your personal `~/.claude/settings.json` rules and claude.ai connectors.
- The start itself when the OS sandbox is unavailable (Linux needs `bubblewrap` and `socat`).

What it does not block:

- `trusted_commands` run with your full rights. An injected `git -c core.sshCommand=…` or `ddev exec …` leaves the sandbox; that is the price of a working workflow. Remove a command you do not need.
- With `network: ['*']`, a sandboxed command can still reach any host.
- Not confirmed: whether `--strict-mcp-config` also hides MCP servers that plugins bring.

## Codex in `sandbox` mode

What the default blocks:

- Commands that write outside the worktree and `allow_write`.
- Approval prompts: `-a never` makes a refused action fail instead of waiting.
- The MCP servers of your Codex config that `mcp_servers` does not name, whether declared as `[mcp_servers.<id>]` tables, dotted keys or inline tables. A declaration bakers.build cannot read, or a server id that is not a bare key (Codex splits `-c` keys on every dot, so `"my.server"` cannot be addressed), stops the launch with an error instead of leaving the server on.

What it does not block:

- **Reads.** Codex's sandbox does not confine reads, so a command can still read `~/.ssh` and `~/.bakers`. Isolate the machine (below) when that matters.
- Network access to any host while `network` is not empty.
- Not confirmed: whether `workspace-write` lets `git commit` write a worktree's shared `.git` directory outside the worktree (add it to `allow_write`, or use `custom`). The hook-trust bypass is not passed, so a project with Codex hooks may stop at Codex's trust prompt.

## Ticket env vars

Before a run, the conductor removes ticket and project `env_vars` whose names match the harness's deny list. They never reach the agent or any workspace hook, and a warning names the keys and the ticket, never the values. In `yolo` they are passed, and the warning still appears. `env_deny` replaces the list per harness; `[]` passes everything. Harnesses without `security` (Grok, Kimi, OpenCode, Pi) always drop with the default list:

`ANTHROPIC_*`, `OPENAI_*`, `CLAUDE_*`, `CODEX_*`, `NODE_OPTIONS`, `LD_*`, `DYLD_*`, `PATH`, `BASH_ENV`, `ENV`, `GIT_*`, `SSH_*`, `*_PROXY`, `*_proxy`

These names redirect the model API, inject code into every process, or reconfigure git, SSH and proxies. The server still stores any name; the filter is on your machine.

The inbox, `after_done`, `on_freeze` and `on_resume` hooks run without a run agent, so they always drop with the default list, even when the agent runs in `yolo` or sets `env_deny`.

## Risk of loosening

Every step away from `sandbox` gives ticket authors more of your rights: `system` gives them whatever your own harness configuration allows, `yolo` gives them everything your user can do (files, keys, network, every MCP server, your GitLab token), and an env var you take off the deny list can redirect the model API or run code in every process. Loosen per agent, not for the whole harness, and only for projects whose ticket authors you trust.

The harness sandboxes do not isolate a machine. Where runs handle untrusted tickets, also run the conductor in a container or VM, give it credentials scoped to the project (a project-only Git token, no personal SSH key), and restrict outbound traffic with a host firewall.
