---
title: Shared run security
description: Set the permissions mode, read-denied paths, writable paths and trusted commands once for every agent, in the machine config and in the committed project config, and how those layers combine with each harness entry.
---

# Shared run security

For a configured execution machine, use a top-level `permissions` block to set the mode and the `deny_read`, `allow_write` and `trusted_commands` lists for every agent at once. It may appear in `~/.bakers/machine.config.js` and in the project's `.bakers/project.config.js` (or the selected variant `.bakers/project.<name>.config.js`):

```js
permissions: {
  mode: 'sandbox',                 // sandbox | system | yolo
  sandbox: {
    deny_read: ['$inherit', '~/.aws'],
    allow_write: ['$inherit', '~/.designbook'],
    trusted_commands: ['$inherit', 'docker'],
  },
},
```

**One rule for every layer.** The layers, from bottom to top, are: harness default, project, machine, then the harness entry's `with`. A layer that sets a key replaces the value below it. The list element `'$inherit'` inserts the value of the layer below at that position; duplicates are dropped. `mode` replaces, with no placeholder; an entry's `permissions` replaces both shared modes. The former key `security` fails loading with `security was renamed: use permissions`.

- Add one command without restating the layer below: `trusted_commands: ['$inherit', 'docker']`, on any layer. No harness trusts a command by default.
- Veto a project grant on your machine: `trusted_commands: []`, or a list without `'$inherit'`, in `machine.config.js`.
- A harness entry's list without `'$inherit'` replaces everything below it, so existing entries behave as before.

Only `mode` and those three lists can be shared; `network`, `mcp_servers`, `config` and `env_deny` stay per entry, and any other key fails loading with the file named. The shared `mode` takes `sandbox`, `system` or `yolo`; `custom` needs a harness entry's `config`.

Shared lists apply only while an agent's effective mode is `sandbox`. Codex and Grok cannot express `deny_read` or `trusted_commands`: a shared value for them is skipped with a warning (`<harness>: <layer> permissions.sandbox.<key> is not applied`), while the same key in their own entry still fails loading. OpenCode and Pi keep their own mode and ignore the shared block.

`bakers agents` prints each alias's effective `permissions`: the `mode` and its source, every list entry with its source (`default`, `project`, `machine`, `agent`), the `removed` defaults and the shared keys `not_applied` with the reason.

**Risk.** Without any `mode`, runs use `system`. A committed project config that loosens the sandbox (a `mode` other than `sandbox`, an `allow_write` or `trusted_commands` entry, a `deny_read` without `'$inherit'`) gives **anyone who can push to the repository** more rights on every machine that runs the project and does not replace that key. With `mode: 'yolo'` that is everything your user can do. Each such loosening prints a warning whenever the conductor loads, including at `bakers conductor start`, naming the file and the grant. Replace the key in `machine.config.js` to refuse it. See [Risk of loosening](/provision/security/execution#risk-of-loosening).

## No global tools

When no layer sets `mode`, runs use `system`. A `sandbox` run trusts no command by default: no harness exempts `bakers`, `git` or any other command from its sandbox. Whatever a run needs beyond its worktree comes through tools the conductor serves for an addon, such as `provision_up`, `ddev_exec` and `ports_up`. Configure [Forge](/addons/forge) and its backend for repository delivery through conductor tools; sandbox mode does not enable them automatically.

Without Forge, shell-based delivery needs an explicitly supported permission path for the selected harness. Where supported, trusted commands run with your full rights; do not add broad command exemptions merely to work around missing Forge configuration. Keep the Forge credentials with the conductor.

## Verify

From a connected project checkout, run `bakers agents` and inspect each alias's effective mode, sources and `not_applied` entries. Run `bakers conductor check` for sandbox prerequisites. These checks do not prove that an addon tool or application container has the same limits as the agent.

Runtime selection preserves these settings. Rules apply inside the runtime filesystem: `~` names
the private run home, and `allow_write` does not mount an otherwise hidden host path. Native sandbox
mode still needs its prerequisites there; unavailable sandboxes fail closed instead of switching modes.
