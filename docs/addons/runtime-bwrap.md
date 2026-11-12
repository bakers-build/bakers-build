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

The agent prepares its configuration and declares required read and write paths. Claude copies
settings and the selected login into the private home, exposes plugins read-only and writes its
transcript to the existing worktree transcript directory. An explicit API key or OAuth token
takes precedence over the stored login.

The worktree and required Git data retain host paths. Git control files are read-only; cleanup
quarantines unsafe indexed submodule metadata before host Git resumes. Cleanup stops the
launcher and removes the private home.

## Boundaries

Networking is shared with the Coder environment, including localhost. There is no egress
allowlist in this backend. Resource limits remain those of the outer environment.

Conductor tools and project hooks execute on the host, outside this sandbox; runs can edit
worktree scripts those tools execute. Use the conductor's forge tools for delivery.
