# Bubblewrap runtime

`@bakers-build/addon-runtime-bwrap` isolates the complete agent process on Linux, including
its file tools and subprocesses. It fills the [runtime slot](/addons/slots#runtime-where-a-run-starts)
without an image or an agent-specific Bubblewrap adapter. Executors such as herdr still manage
the terminal. Machine scope only:

```js
{ use: '@bakers-build/addon-runtime-bwrap' }
```

## Requirements

Install `bwrap` on the conductor host and enable unprivileged user namespaces. Startup checks
namespace support and refuses to run if unavailable. A Linux Coder workspace is supported;
the outer container's security policy must allow nested namespaces. This external wrapper does
not require `socat` itself. Agent permissions remain unchanged; native sandbox mode additionally
needs its own tools and support for nested namespaces.

Runs require linked Git worktrees; the main checkout is refused. Programs come from the host's
system directories and executable search paths. Additional tool resources can be granted through
`readPaths`; each grant exposes that path to the agent.

## Options

<!-- @options @bakers-build/addon-runtime-bwrap -->

## Files and credentials

Each run has a private home and environment, private process, IPC and hostname namespaces,
and its own `/proc`, `/dev` and temporary directory. The operator's home, SSH keys, `.bakers`
and Docker socket are absent. Only explicitly selected environment variables reach the process;
credential values are absent from the launcher command and plan file.

The agent prepares its configuration and grants. Claude copies settings and login into the
private home, mounts plugins read-only, and writes its transcript to the worktree transcript directory.
Explicit API credentials override stored login.

The worktree keeps its host path, but independent private Git metadata replaces its admin
directory inside the run. The `.git` pointer is read-only; parent and sibling Git metadata is
not writable. `.bakers/` and effective `runtime.read_only` paths are read-only; DDEV contributes
`.ddev`. Host provisioning can still write generated files under these mounts.

Commit locally, then call `runtime_transfer_commit` with the full hash before forge delivery.
Only the ticket branch advances, checking its previous tip; source config/hooks are never imported.
Gitlinks/submodules are refused. Cleanup stops the launcher, removes the home, and retains private
Git for recovery. See [transfer, index reconciliation and cache paths](/provision/security/shared-settings#isolated-git-delivery).
A maintainer delivers protected-file changes outside the run.

## Boundaries

Networking is shared with the Coder environment, including localhost. There is no egress
allowlist in this backend. Resource limits remain those of the outer environment.

Host tools still execute unprotected repository code, including package lifecycle scripts, docs configuration and CLI builds. Protecting launch scripts alone does not isolate that code.
