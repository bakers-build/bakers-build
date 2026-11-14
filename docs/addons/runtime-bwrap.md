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

The workspace must provide a run clone: the [Git workspace](/addons/workspace-git#isolated-runs) or [herdr](/addons/herdr#isolated-runs). Programs come from the host's
system directories and executable search paths. Additional tool resources can be granted through
`readPaths`; each grant exposes that path to the agent.

## Options

<!-- @options @bakers-build/addon-runtime-bwrap -->

## Files and credentials

Each run has a private home and environment, private process, IPC and hostname namespaces,
and its own `/proc`, `/dev` and temporary directory. The operator's home, SSH keys, `.bakers`
and Docker socket are absent. Only explicitly selected environment variables reach the process;
credential values are absent from the launcher command and plan file.

The agent prepares its configuration and grants. Claude copies settings into the private home,
mounts the host's login file (`~/.claude/.credentials.json`) read-write in place of a copy, so a
token refresh in any run reaches the host and every other run, mounts plugins read-only, and writes
its transcript to the worktree transcript directory. Explicit API credentials override stored login.

The workspace is a fresh [run clone](/provision/security/shared-settings#isolated-git-delivery) of the ticket
branch at the worktree path, made at every run start. The run's Git directory, kept in the
conductor's cache, is mounted as `.git`; the parent repository is absent. The workspace option
`shared` adds the parent's `objects` read-only. `.bakers/` and the project's
[`runtime.read_only`](/provision/security/shared-settings#host-executed-paths) paths are read-only.

Commit inside the run: only checked commits come back, as
[isolated Git delivery](/provision/security/shared-settings#isolated-git-delivery) describes.
Cleanup stops the launcher and removes the home.

## Boundaries

Networking is shared with the Coder environment, including localhost. There is no egress
allowlist in this backend. Resource limits remain those of the outer environment.

Install dependencies and build inside the run. The DDEV web container is as untrusted as the run; bakers checks only a host command's entry point.
