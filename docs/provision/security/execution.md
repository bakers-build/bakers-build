---
title: Agent permissions
description: Agent permission modes, native sandbox rules, prerequisites and exceptions; use conductor tools for operations beyond the agent’s own access.
---

# Agent permissions

<span id="run-security"></span>

Agent permissions govern actions the harness allows, refuses or asks you to approve. `permissions: 'sandbox'` also enables the harness's native OS restrictions where supported. This does not select a whole-process runtime: choose [isolation](/agents/isolation) separately. [Tools](/provision/tools#work-across-permissions-and-isolation) provide required operations without broadly relaxing either layer.

Set `permissions` in the harness entry's `with`. A `catalog` entry uses its own `with`: omitted keys take defaults, not the harness entry's values. [Shared policy](/provision/security/shared-settings) supplies supported machine/project defaults; [Agent policy](/agents/reference#run-security) explains placement.

## Modes

| `permissions` | Meaning | MCP servers | Denied ticket env vars |
|---|---|---|---|
| `sandbox` | No permission bypass; the harness's own OS sandbox, tuned by the `sandbox` keys | explicit `sandbox.mcp_servers` plus run-bound conductor tools, where supported | dropped |
| `system` (default) | bakers.build adds no security flag; your own harness configuration decides | yours | dropped |
| `yolo` | Harness safeguards bypassed; outer runtime still applies | yours | passed |
| `custom` | Only your `config`, handed to the harness unchanged | as `config` says | dropped |

The launch flags per mode, the `sandbox` keys and their defaults are on the [Claude](/addons/claude#security), [Codex](/addons/codex#security), [Grok](/addons/grok#security), [OpenCode](/addons/opencode#security) and [Pi](/addons/pi#security) pages; Grok and OpenCode reject `custom`. OpenCode and Pi have no OS sandbox, so an explicit `permissions: 'sandbox'` fails loading for them; Pi also rejects `yolo`. Loading fails for an unknown mode, `skip_permissions`, `security` (renamed `permissions`), `config` outside `custom`, `custom` without `config`, a `sandbox` block outside `sandbox` mode or an unknown `sandbox` key, so a typo never starts a run with rights you did not choose.

## Sandbox prerequisites

`sandbox` mode needs the harness's OS sandbox on the machine that runs the conductor. Check every enabled agent with:

```sh
bakers conductor check
```

It prints `<agent>: sandbox ok`, or `sandbox unavailable: <agent>: <cause> — <fix>`, and exits 1 when one agent cannot start its sandbox. `system`, `yolo` and `custom` agents are not checked.

| Platform | Claude | Codex | Grok |
|---|---|---|---|
| Linux | `bwrap` (package `bubblewrap`) and `socat`, and unprivileged user namespaces | its own `codex sandbox`, which needs unprivileged user namespaces | Landlock active in the kernel (`landlock` in `/sys/kernel/security/lsm`), plus `bwrap` for `allow_write` |
| macOS | nothing to install: the built-in Seatbelt sandbox | nothing to install: the built-in Seatbelt sandbox | nothing to install: the built-in Seatbelt sandbox |

Install Linux prerequisites through your host's package manager. Native sandbox mode inside an outer runtime needs those prerequisites there too; `conductor check` probes only the host.

OpenCode has no OS sandbox on any platform; it runs in `system` and rejects `sandbox` when loading, so `bakers conductor check` never checks it.

A host or container that forbids unprivileged user namespaces shows `bwrap cannot set up its sandbox: …` (Claude) or `codex sandbox cannot start: …` (Codex). Allow them on the host (on Ubuntu 24.04 and later, AppArmor restricts them), or run the conductor where they are allowed.

While an enabled agent cannot start its sandbox, the conductor claims nothing and logs `claims withheld: sandbox unavailable: …` on every cycle; `bakers conductor start` prints the same line as a warning. No run is created, so no ticket is parked by the failed-run limit. After the fix the next cycle claims, without a restart. A run whose sandbox becomes unavailable between the cycle and its start fails with the same message in its error log, and no agent starts.

## Claude in `sandbox` mode

The generated settings set `sandbox.enabled`, `sandbox.failIfUnavailable: true`, `sandbox.allowUnsandboxedCommands: false`, `disableClaudeAiConnectors: true` and allow `Bash`, `Edit(./**)` and `AskUserQuestion`. They run without a prompt. Anything else asks you in the run's terminal, because Claude starts in `default` permission mode: `dontAsk` would deny it outright, and no allow rule can permit a write to a protected path such as `.claude/` or `.git`. A run nobody watches therefore waits at such a prompt.

What the default blocks:

- Shell commands that write outside the worktree, `$TMPDIR`, `allow_write` and the workspace's [Git metadata](#git-metadata-in-codex-and-claude-sandboxes).
- Shell commands and Claude's Read tool reading a `deny_read` path.
- Network access from shell commands to hosts outside `network`.
- Your user-level MCP servers from `~/.claude.json`, your personal `~/.claude/settings.json` rules and claude.ai connectors.
- The start itself when the OS sandbox is unavailable; see [Sandbox prerequisites](#sandbox-prerequisites).

What it does not block:

- `trusted_commands` (default [none](/provision/security/shared-settings#no-global-tools)) exempts commands from the inner sandbox. Prefer conductor tools over broad shell exemptions; any outer runtime still limits the command.
- With `network: ['*']`, a sandboxed command can still reach any host.
- Unconfirmed: whether `--strict-mcp-config` hides plugin MCP servers.

## Codex in `sandbox` mode

What the default blocks:

- Commands that write outside the worktree, configured `allow_write` paths, temporary directories and the workspace's [Git metadata](#git-metadata-in-codex-and-claude-sandboxes).
- Approval prompts: `-a never` makes a refused action fail instead of waiting.
- The MCP servers of your Codex config that `mcp_servers` does not name, whether declared as `[mcp_servers.<id>]` tables, dotted keys or inline tables. A declaration bakers.build cannot read, or a server id that is not a bare key (Codex splits `-c` keys on every dot, so `"my.server"` cannot be addressed), stops the launch with an error instead of leaving the server on.

What it does not block:

- **Reads.** Codex's sandbox does not confine reads, so a command can still read `~/.ssh` and `~/.bakers`. Choose an outer boundary when that matters.
- Network access to any host while `network` is not empty.
- [Git metadata](#git-metadata-in-codex-and-claude-sandboxes): objects and refs stay writable, so a run can rewrite branches. Permission-profile support is required; see [Codex security](/addons/codex#security). The hook-trust bypass is not passed, so Codex hooks may stop at Codex's trust prompt.

## Git metadata in Codex and Claude sandboxes

A linked worktree's run writes its Git dir and the shared `objects`, `refs`, `logs`; a main checkout's run, its `.git`. Only existing protected entries (`config`, `hooks`, …) are named; a missing one would become a placeholder. `allow_write` entries inside `.git` are ignored with a warning. Runs push to the same-name branch ([`autoSetupMerge`](/addons/workspace-git#options)).

Known limit (upstream report pending): in a linked worktree, Claude Code creates empty `config.lock`, `config.worktree`, `remotes/`, `branches/` in the shared `.git`; all but `config.lock` persist.

At run end the conductor ends processes carrying the run's `BAKERS_RUN_UUID` (Linux).

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
- Unverified: MCP enforcement, macOS managed profiles and unattended container-runtime execution. Failed custom-profile startup never permits bypassing the sandbox.

## Ticket env vars

Before a run, the conductor removes ticket and project `env_vars` whose names match the harness's deny list. They never reach the agent or any workspace hook, and a warning names the keys and the ticket, never the values. In `yolo` they are passed, and the warning still appears. `env_deny` replaces the list per harness; `[]` passes everything. Harnesses without `permissions` (Kimi) always drop with the default list:

`ANTHROPIC_*`, `OPENAI_*`, `CLAUDE_*`, `CODEX_*`, `NODE_OPTIONS`, `LD_*`, `DYLD_*`, `PATH`, `BASH_ENV`, `ENV`, `GIT_*`, `SSH_*`, `*_PROXY`, `*_proxy`

These names redirect the model API, inject code into every process, or reconfigure git, SSH and proxies. The server stores any name; filtering happens locally.

The inbox and addon listener contexts for `after_done`, `on_freeze` and `on_resume` use the default deny list because they have no run agent. The `after_done` shell command and `provision_up` inherit the conductor environment without injected ticket variables; see [hook environments](/configuration/project/hooks#environment).

## Risk of loosening

`system` inherits your harness policy; `yolo` bypasses available harness safeguards within the process's environment. Broad write grants, trusted commands or removed environment filters increase ticket authors' access. Committed project policy affects every machine that accepts it; [machine policy](/provision/security/shared-settings) can replace grants.

## Use tools for required operations

Keep operations requiring extra authority behind [conductor tools](/provision/tools#work-across-permissions-and-isolation): `provision_up` for application preparation, DDEV tools for application checks, Forge for delivery, Ports for previews. This keeps the shell restricted and credentials with the integration. Enable the appropriate addons and tool access; a denied tool call is not fixed by choosing an outer runtime.

Tools execute with their own permissions, outside the agent boundary where configured. Their authorization, mounts and editable scripts still need review. Native sandbox and outer isolation rules do not automatically constrain a host-side tool.

## Coder container boundary

For the provided Coder workspace template:

Keep installed harnesses in your [machine config](/configuration/machine). If nested native sandboxes are unavailable, fix host policy or explicitly choose the operator-provided container boundary. This advanced example selects `custom`; it grants no native shell sandbox, so runs can read their container home, including sign-ins and SSH keys. Runs sharing that container are not isolated from each other. Prefer tools for host operations.

```js
{
  use: '@bakers-build/addon-claude',
  with: {
    permissions: 'custom',
    config: {
      permissions: { defaultMode: 'dontAsk', allow: ['Bash', 'Edit(./**)'], deny: ['Read(~/.ssh/**)', 'Read(~/.bakers/**)'] },
      disableClaudeAiConnectors: true,
    },
  },
},
{
  use: '@bakers-build/addon-codex',
  with: { permissions: 'custom', config: { sandbox_mode: 'danger-full-access', approval_policy: 'never' } },
},
```

`dontAsk` denies what `allow` does not list instead of asking, so an unattended run never waits at a question. The `deny` rules cover Claude's Read tool only, not shell commands.

