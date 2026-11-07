---
title: Shared run security
description: Set the security mode, read-denied paths, writable paths and trusted commands once for every agent, in the machine config and in the committed project config, and how those layers combine with each harness entry.
---

# Shared run security

A top-level `security` block sets the mode and the `deny_read`, `allow_write` and `trusted_commands` lists for every agent at once. It may appear in `~/.bakers/machine.config.js` and in the project's `.bakers/conductor.config.js` (or the selected variant; local values apply only through explicit imports):

```js
security: {
  mode: 'sandbox',                 // sandbox | system | yolo
  sandbox: {
    deny_read: ['$inherit', '~/.aws'],
    allow_write: ['$inherit', '~/.designbook'],
    trusted_commands: ['$inherit', 'docker'],
  },
},
```

**One rule for every layer.** The layers, from bottom to top, are: harness default, project, machine, then the harness entry's `with`. A layer that sets a key replaces the value below it. The list element `'$inherit'` inserts the value of the layer below at that position; duplicates are dropped. `mode` replaces, with no placeholder; an entry's `security` replaces both shared modes.

- Add one command without restating `bakers` and `git`: `trusted_commands: ['$inherit', 'docker']`, on any layer.
- Veto a project grant on your machine: `trusted_commands: []`, or a list without `'$inherit'`, in `machine.config.js`.
- A harness entry's list without `'$inherit'` replaces everything below it, so existing entries behave as before.

Only `mode` and those three lists can be shared; `network`, `mcp_servers`, `config` and `env_deny` stay per entry, and any other key fails loading with the file named. The shared `mode` takes `sandbox`, `system` or `yolo`; `custom` needs a harness entry's `config`.

Shared lists apply only while an agent's effective mode is `sandbox`. Codex and Grok cannot express `deny_read` or `trusted_commands`: a shared value for them is skipped with a warning (`<harness>: <layer> security.sandbox.<key> is not applied`), while the same key in their own entry still fails loading. OpenCode and Pi keep their own mode and ignore the shared block.

`bakers agents` prints each alias's effective `security`: the `mode` and its source, every list entry with its source (`default`, `project`, `machine`, `agent`), the `removed` defaults and the shared keys `not_applied` with the reason.

**Risk.** A committed project config that loosens the sandbox (a `mode` other than `sandbox`, an `allow_write` or `trusted_commands` entry, a `deny_read` without `'$inherit'`) gives **anyone who can push to the repository** more rights on every machine that runs the project and does not replace that key. With `mode: 'yolo'` that is everything your user can do. Each such loosening prints a warning whenever the conductor loads, including at `bakers oven start`, naming the file and the grant. Replace the key in `machine.config.js` to refuse it. See [Risk of loosening](/security/execution#risk-of-loosening).
