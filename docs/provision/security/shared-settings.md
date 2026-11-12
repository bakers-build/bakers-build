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

From a connected project checkout, run `bakers agents` and inspect each alias's effective mode, sources and `not_applied` entries. Run `bakers conductor check` for sandbox prerequisites on the host. With a runtime configured, check and startup warn that its environment is not checked. A successful host check does not establish that the sandbox can start inside a container. These checks do not prove that an addon tool or application container has the same limits as the agent.

Runtime selection preserves these settings. Rules apply inside the runtime filesystem: `~` names
the private run home, and `allow_write` does not mount an otherwise hidden host path. Native sandbox
mode still needs its prerequisites there; unavailable sandboxes fail closed instead of switching modes.

The shipped Docker image has no `bwrap` or `socat`. Native sandbox mode needs an operator image
with those tools and working nested namespaces. The warning does not block dispatch or change
permissions; an unavailable sandbox can still cause a run to fail and consume retries.

## Host-executed paths

`runtime: { read_only: ['$inherit', 'host-tools'] }` is available in project and machine config.
Its layers are addon defaults → project → machine → runtime entry `with.read_only`.
`bakers agents` reports effective runtime paths with source layers alongside permissions.
A set list replaces; `'$inherit'` inserts inherited entries and deduplicates them. Dropping inherited
paths warns at every load. Invalid lists fail loading; missing, redirected or escaping paths fail
dispatch. `.bakers/` is always protected outside these layers. DDEV declares `.ddev` automatically.
Nested entries protect their entire top-level project folder: protecting only a file would allow
renaming its writable ancestor and replacing the original path. Symlinks and hardlinked files
inside protected trees fail dispatch; only regular files and directories are accepted.
`bakers agents` shows the actual `protected_roots`.
Other addons can export `runtime: { read_only: [...] }` from their preset.

Docker and Bubblewrap mount these paths read-only. Host-runtime Claude/Codex sandbox mode also
protects them: Claude denies Bash writes and Edit/Write tools; Codex adds read-only filesystem
overrides. Other agents and host `system`/`yolo` modes cannot enforce this protection. Commands explicitly
exempted from a native harness sandbox retain their configured host rights; an isolating runtime
still enforces its outer read-only mounts.

Place host scripts in `.bakers/scripts/`. A maintainer applies, commits and delivers protected-file
changes outside the isolated run, including target-branch merges that modify them. There is no
per-ticket write bypass. Host-generated DDEV files remain writable from host provisioning.

## Isolated Git delivery

Docker and Bubblewrap use independent Git metadata with copied objects, preserving worktree paths.
Gitlinks/submodules are refused because nested Git configuration can execute on the host.
The host Git store is mounted read-only. After `forge_fetch`, run `git fetch origin` to refresh
private remote-tracking refs; private local branches remain independent. Agent launches include
this delivery context. Commit normally inside the run, then explicitly call `runtime_transfer_commit` with a full hash
before forge push. The destination is the ticket branch from the host-owned launch record.
The host verifies objects, ancestry and every incoming commit's protected-path changes through clean
metadata; source config/hooks and unrelated refs are never imported. Concurrent host branch movement
fails safely. Git plumbing cannot bypass protected-file delivery rules.

Transfer updates the branch, leaving the host index separate. After the run stops, preserve any
host-side staged changes, then use `git reset --mixed HEAD` in the ticket worktree to reconcile
its index without discarding working files.

Cleanup retains private Git and its host-owned record for recovery. Docker stores them at
`$XDG_CACHE_HOME/bakers/runtime/<run uuid>.git` and `.workspace.json`; Bubblewrap uses
`<cache>/<run uuid>.git` and `.git.json`. Remove each matching pair only after delivery/recovery.
There is no automatic cache GC or dependency on parent object retention.

The first/repeat metadata-copy measurements here were 0.244/0.074 seconds and 56 MB per run,
versus 0.010/0.009 seconds and 100 KB locally with shared objects. These are cache observations,
not cold-cache or end-to-end startup guarantees. Independent objects avoid parent GC dependencies.
