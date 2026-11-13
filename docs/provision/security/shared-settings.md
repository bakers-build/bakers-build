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

When no layer sets `mode`, runs use `system`. A `sandbox` run trusts no command by default: no harness exempts `bakers`, `git` or any other command from its sandbox. Whatever a run needs beyond its worktree comes through tools the conductor serves for an addon, such as `provision_up`, `provision_exec` and `ports_up`. Configure [Forge](/addons/forge) and its backend for repository delivery through conductor tools; sandbox mode does not enable them automatically.

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

Under an isolating runtime ([Docker](/addons/runtime-docker), [Bubblewrap](/addons/runtime-bwrap)) one
principle holds: on the host, only code from protected paths runs; everything else runs in a
container; only checked commits come back.

The protected paths come from the project alone, in `.bakers/project.config.js`:

```js
runtime: { read_only: ['.ddev', '.github'] },
```

Paths are relative to the worktree, and `.bakers` is always protected in addition. A listed path
must exist; otherwise dispatch fails. Symlinks and hardlinked files inside a protected tree also
fail dispatch. There is no machine-level key, no addon default and no runtime-entry option.
bakers.build mounts these paths read-only in the run's container.

Every project hook and every `hooks.provision_up` or `hooks.provision_exec` command must begin with
a script in a protected path; otherwise the config fails to load. See
[the entry-point rule](/provision/hooks#protect-host-executed-files). The run installs dependencies
and builds in its own container, not on the host.

A legitimate change to a protected path is made and delivered by a maintainer outside an isolated
run. If the target branch changed a protected path, merging it fails inside the run as read-only.
The run reports that; a maintainer merges the target into the ticket branch once, outside the run,
and the next run starts from that state.

### DDEV tool protection

Your project's own containers must protect the same paths: bakers.build does not propagate
`runtime.read_only` into them. This repository uses ordinary DDEV Compose configuration in
`.ddev/docker-compose.protection.yaml`. It mounts `.bakers`, `.github`, `.ddev` and the empty
`.git` placeholder read-only into the web container. Mount whole directories: protecting only one
file leaves a writable ancestor that can be renamed and replaced. Apply Compose changes by
recreating the containers.

Host-side DDEV and provisioning can still write generated, ignored files there, such as
`.ddev/config.worktree.yaml` and DDEV's `.ddev/.gitignore`.

## Isolated Git delivery

At every isolated run start, the [Git workspace](/addons/workspace-git#isolated-runs) or
[herdr](/addons/herdr) creates a fresh **run clone** of the ticket branch at the stable worktree
path. Its Git directory lives in the conductor's cache, at
`$XDG_CACHE_HOME/bakers/run-git/<hash>.git` (default `~/.cache`), and is mounted as `.git` only
inside the run's container. On the host, the workspace's `.git` is an empty placeholder directory
and the host never runs Git there. The parent repository is not mounted in the run.

The clone carries the ticket's target branch as `origin/<target>`; nothing is merged. Tracked files
are reset and untracked files removed; ignored files such as `node_modules` and `vendor` are kept.
Uncommitted work is not carried over to the next run, so a run must commit before it ends.

At run end, and inside `forge_push`, the host transfers the run's commits to the ticket branch in
the parent repository:

- objects are copied without following links and checked with `git fsck`;
- the commit must descend from the tip the run started from, and the branch moves only if it still
  has that tip;
- a commit that changes a protected path, compared with that starting tip, is rejected;
- submodules are refused, and the run's Git config and hooks never execute on the host.

`forge_fetch` fetches into the parent repository and refreshes the run's `origin/*` refs; the agent
merges `origin/<target>` itself. `forge_push` transfers, then pushes. Only the ticket branch is
transferred, not other branches created in the clone.

With the workspace option `shared: true`, the clone borrows the parent's objects and the parent's
`objects` directory is mounted read-only in the run. While a run is open, do not prune the parent
repository or run `git repack -d` or `git gc --prune` there: the clone can lose objects it needs.

Measured on ext4 with 16 CPUs and 5918 tracked files, three runs each: an independent clone took
1.81 s without an existing copy and 0.90 s with one, using 140 MB; `shared` took 0.45 s and 114 MB;
a linked worktree took 0.43 s and 113 MB. Startup is not equivalent to a worktree's.

**Residual risks.** The DDEV web container is as untrusted as the run, and all DDEV projects share
the `ddev-global-cache` volume. bakers.build checks only the entry point of a host command, not
what that script calls. The host runtime, in any permission mode including `sandbox`, has none of
this protection: it keeps linked worktrees and host installs. Reasoning: the decision record
`docs/decisions/run-isolation.md`.
