---
title: Run security
description: How strictly Claude, Codex and Grok runs start on a machine - the security modes, what each harness sandbox blocks and what it does not, the ticket env var filter, the risk of loosening and operator-side isolation.
---

# Run security

A run executes text other people wrote (ticket title, description, comments, env vars) on your machine, so Claude, Codex and Grok runs start safe by default and only `machine.config.js` decides how strictly. Each harness entry's `with` takes `security`; a `catalog` entry uses its own `with` instead, so a key it does not set takes the default, not the harness entry's value. There is no global or conductor-level setting. Where to set it: [Agent policy](/configuration/agents/reference#run-security).

## Modes

| `security` | Meaning | MCP servers | Denied ticket env vars |
|---|---|---|---|
| `sandbox` (default) | No permission bypass; the harness's own OS sandbox, tuned by the `sandbox` keys | only `sandbox.mcp_servers` (default none) | dropped |
| `system` | bakers.build adds no security flag; your own harness configuration decides | yours | dropped |
| `yolo` | Full access, permissions and sandbox bypassed | yours | passed |
| `custom` | Only your `config`, handed to the harness unchanged | as `config` says | dropped |

The launch flags per mode, the `sandbox` keys and their defaults are on the [Claude](/addons/claude#security), [Codex](/addons/codex#security), [Grok](/addons/grok#security), [OpenCode](/addons/opencode#security) and [Pi](/addons/pi#security) pages; Grok and OpenCode reject `custom`. OpenCode and Pi have no OS sandbox, so their default is `system` and an explicit `security: 'sandbox'` fails loading; Pi also rejects `yolo`. Loading fails for an unknown mode, `skip_permissions` (use `security: 'yolo'`), `config` outside `custom`, `custom` without `config`, a `sandbox` block outside `sandbox` mode or an unknown `sandbox` key, so a typo never starts a run with rights you did not choose.

## Sandbox prerequisites

`sandbox` mode needs the harness's OS sandbox on the machine that runs the conductor. Check every enabled agent with:

```sh
bakers oven check
```

It prints `<agent>: sandbox ok`, or `sandbox unavailable: <agent>: <cause> — <fix>`, and exits 1 when one agent cannot start its sandbox. `system`, `yolo` and `custom` agents are not checked.

| Platform | Claude | Codex | Grok |
|---|---|---|---|
| Linux | `bwrap` (package `bubblewrap`) and `socat`, and unprivileged user namespaces | its own `codex sandbox`, which needs unprivileged user namespaces | Landlock active in the kernel (`landlock` in `/sys/kernel/security/lsm`), plus `bwrap` for `allow_write` |
| macOS | nothing to install: the built-in Seatbelt sandbox | nothing to install: the built-in Seatbelt sandbox | nothing to install: the built-in Seatbelt sandbox |

Install the Linux packages with your package manager:

| Package manager | Command |
|---|---|
| apt (Debian, Ubuntu) | `sudo apt-get install -y bubblewrap socat` |
| dnf (Fedora, RHEL) | `sudo dnf install -y bubblewrap socat` |
| pacman (Arch) | `sudo pacman -S --needed bubblewrap socat` |

Other distributions: install the packages `bubblewrap` and `socat`.

OpenCode has no OS sandbox on any platform; it defaults to `system` and rejects `sandbox` when loading, so `bakers oven check` never checks it.

A host or container that forbids unprivileged user namespaces shows `bwrap cannot set up its sandbox: …` (Claude) or `codex sandbox cannot start: …` (Codex). Allow them on the host (on Ubuntu 24.04 and later, AppArmor restricts them), or run the conductor where they are allowed.

While an enabled agent cannot start its sandbox, the conductor claims nothing and logs `claims withheld: sandbox unavailable: …` on every cycle; `bakers oven start` prints the same line as a warning. No run is created, so no ticket is parked by the failed-run limit. After the fix the next cycle claims, without a restart. A run whose sandbox becomes unavailable between the cycle and its start fails with the same message in its error log, and no agent starts.

## Claude in `sandbox` mode

The generated settings set `sandbox.enabled`, `sandbox.failIfUnavailable: true`, `sandbox.allowUnsandboxedCommands: false`, `disableClaudeAiConnectors: true` and allow `Bash`, `Edit(./**)` and `AskUserQuestion`. They run without a prompt. Anything else asks you in the run's terminal, because Claude starts in `default` permission mode: `dontAsk` would deny it outright, and no allow rule can permit a write to a protected path such as `.claude/` or `.git`. A run nobody watches therefore waits at such a prompt.

What the default blocks:

- Shell commands that write outside the worktree, `$TMPDIR` and `allow_write`.
- Shell commands and Claude's Read tool reading a `deny_read` path.
- Network access from shell commands to hosts outside `network`.
- Your user-level MCP servers from `~/.claude.json`, your personal `~/.claude/settings.json` rules and claude.ai connectors.
- The start itself when the OS sandbox is unavailable; see [Sandbox prerequisites](#sandbox-prerequisites).

What it does not block:

- `trusted_commands` run with your full rights. An injected `git -c core.sshCommand=…` or `bakers …` call leaves the sandbox; that is the price of a working workflow. Remove a command you do not need.
- With `network: ['*']`, a sandboxed command can still reach any host.
- Not confirmed: whether `--strict-mcp-config` also hides MCP servers that plugins bring.

## Codex in `sandbox` mode

What the default blocks:

- Commands that write outside the worktree, configured `allow_write` paths, temporary directories and the workspace's resolved Git metadata.
- Approval prompts: `-a never` makes a refused action fail instead of waiting.
- The MCP servers of your Codex config that `mcp_servers` does not name, whether declared as `[mcp_servers.<id>]` tables, dotted keys or inline tables. A declaration bakers.build cannot read, or a server id that is not a bare key (Codex splits `-c` keys on every dot, so `"my.server"` cannot be addressed), stops the launch with an error instead of leaving the server on.

What it does not block:

- **Reads.** Codex's sandbox does not confine reads, so a command can still read `~/.ssh` and `~/.bakers`. Isolate the machine (below) when that matters.
- Network access to any host while `network` is not empty.
- The Codex sandbox profile grants write access to the dispatched workspace's resolved Git directory and shared Git directory. This supports staging/commits in linked worktrees without granting the parent checkout. Their `config`, `config.worktree`, `hooks`, `commondir`, `gitdir`, `modules` and `worktrees` are configured read-only so a run cannot plant code that a later unsandboxed Git command executes; enforcement by Codex, including for paths that do not exist yet, has not been observed on a host. Objects, refs and the index stay writable, so a run can still rewrite branches and history. Other protected workspace paths remain read-only. Permission-profile support is required; see [Codex security](/addons/codex#security) for validation limits. The hook-trust bypass is not passed, so a project with Codex hooks may stop at Codex's trust prompt.

## Grok in `sandbox` mode

Grok starts with its built-in `workspace` profile in `acceptEdits` mode, or a managed profile extending it when `sandbox.allow_write` is nonempty. MCP tools get a deny rule. Terminal commands can still ask for approval despite the `Bash(*)` allow rule; an unattended run may wait or cancel.

What the default blocks:

- Shell commands that write outside the worktree, `~/.grok/`, the temp directories and explicit `allow_write` directories.
- Every MCP tool, through the `MCPTool(*)` deny rule.
- Claims while the sandbox cannot start; see [Sandbox prerequisites](#sandbox-prerequisites).

What it does not block:

- **Reads.** The `workspace` profile reads everywhere, so a command can still read `~/.ssh` and `~/.bakers`.
- Network access to any host.
- `allow_write` includes Git hooks/configuration in granted directories; it provides no Docker isolation.
- Managed profiles require Grok 1.0.70+ and native configuration protection. See [profile lifecycle](/addons/grok#security).
- Unverified: MCP enforcement, macOS managed profiles and unattended DDEV execution. Failed custom-profile startup never permits bypassing the sandbox.

## Ticket env vars

Before a run, the conductor removes ticket and project `env_vars` whose names match the harness's deny list. They never reach the agent or any workspace hook, and a warning names the keys and the ticket, never the values. In `yolo` they are passed, and the warning still appears. `env_deny` replaces the list per harness; `[]` passes everything. Harnesses without `security` (Kimi) always drop with the default list:

`ANTHROPIC_*`, `OPENAI_*`, `CLAUDE_*`, `CODEX_*`, `NODE_OPTIONS`, `LD_*`, `DYLD_*`, `PATH`, `BASH_ENV`, `ENV`, `GIT_*`, `SSH_*`, `*_PROXY`, `*_proxy`

These names redirect the model API, inject code into every process, or reconfigure git, SSH and proxies. The server still stores any name; the filter is on your machine.

The inbox, `after_done`, `on_freeze` and `on_resume` hooks run without a run agent, so they always drop with the default list, even when the agent runs in `yolo` or sets `env_deny`.

## Risk of loosening

Every step away from `sandbox` gives ticket authors more of your rights: `system` gives them whatever your own harness configuration allows, `yolo` gives them everything your user can do (files, keys, network, every MCP server, your GitLab token), and an env var you take off the deny list can redirect the model API or run code in every process. Loosen per agent, not for the whole harness, and only for projects whose ticket authors you trust.

The harness sandboxes do not isolate a machine. Where runs handle untrusted tickets, also run the conductor in a container or VM, give it credentials scoped to the project (a project-only Git token, no personal SSH key), and restrict outbound traffic with a host firewall.

## Coder container boundary

For the provided Coder workspace template:

Keep only the installed harnesses, `@bakers-build/addon-claude` and `@bakers-build/addon-codex`, in `addons` of `~/.bakers/machine.config.js` ([machines](/configuration/machine)), and set both to `security: 'custom'`. The default `sandbox` cannot start in the workspace: its `bwrap` needs unprivileged user namespaces, which a Docker host on Ubuntu 23.10 or later restricts. The container is the boundary instead, so a run can still read everything in your home, including your sign-ins and SSH key ([Run security](/configuration/agents/execution-security)).

```js
{
  use: '@bakers-build/addon-claude',
  with: {
    security: 'custom',
    config: {
      permissions: { defaultMode: 'dontAsk', allow: ['Bash', 'Edit(./**)'], deny: ['Read(~/.ssh/**)', 'Read(~/.bakers/**)'] },
      disableClaudeAiConnectors: true,
    },
  },
},
{
  use: '@bakers-build/addon-codex',
  with: { security: 'custom', config: { sandbox_mode: 'danger-full-access', approval_policy: 'never' } },
},
```

`dontAsk` denies what `allow` does not list instead of asking, so an unattended run never waits at a question. The `deny` rules cover Claude's Read tool only, not shell commands.

