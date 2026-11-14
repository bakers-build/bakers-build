# Docker runtime

**Experimental**, unreleased on `next` (13 November 2026). Review [limits](/agents/isolation#experimental-runtimes-known-limits).

`@bakers-build/addon-runtime-docker` fills the [`runtime` slot](/addons/slots#runtime-where-a-run-starts),
starting each run in a container at host paths. Machine scope:

```js
{ use: '@bakers-build/addon-runtime-docker', with: { docker: 'podman' } }
```

## Before the first run

- The agent declares `installCommand`; its first run builds the versioned image. `with.image` supplies an installed agent instead.
- Export the agent credential for the conductor: Claude uses `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`. A container cannot use the host login.

## Options

<!-- @options @bakers-build/addon-runtime-docker -->

## What a run sees

Container `bb-run-<run uuid>`, under your uid, mounts:

- the workspace: a fresh [run clone](/provision/security/shared-settings#isolated-git-delivery) of the ticket branch at the worktree path, made at every run start;
- the run's Git directory as `.git`. It lives in the conductor's cache; the parent repository is not mounted. The workspace option `shared` adds the parent's `objects`, read-only;
- `.bakers/` and the project's [`runtime.read_only`](/provision/security/shared-settings#host-executed-paths) paths, read-only;
- the bakers CLI build, read-only. The runtime refuses to start when that build's root would
  contain your home directory;
- `$XDG_CACHE_HOME/bakers/runtime/<run uuid>` at its host path;
- the read/write paths from neutral agent preparation: Claude plugins read-only and the worktree transcript directory writable. Docker has no Claude-specific adapter;
- with `network: host` and no API credential, the host's Claude login file, read-write inside the run home, so a token refresh reaches the host and every other run.

No `~/.ssh`, `~/.bakers` or Docker socket. Secrets use `-e KEY`, never values in argv.
Permissions stay unchanged. Check and startup warn: sandbox preflight probes only the host.
The shipped image lacks `bwrap`/`socat`; unavailable sandboxes fail closed and consume retries.
See [prerequisites](/provision/security/shared-settings#verify). Cleanup removes the container and home.

## Delivery and limits

Commit inside the run: only checked commits come back, as
[isolated Git delivery](/provision/security/shared-settings#isolated-git-delivery) describes.
Install dependencies and build inside the run.

The DDEV web container is as untrusted as the run. bakers checks only a host command's entry
point, not what that script calls. See [residual risks](/provision/security/shared-settings#isolated-git-delivery).

## Allowlist mode

With `network: 'allowlist'`, runs join the internal network `bb-runtime-<conductorKey>`.
Each conductor’s proxy is its runs’ only way out: HTTPS to `allow` hosts (others get `403`), the agent's model API with the
real credential added by the proxy, and the conductor tool server. The run holds a placeholder key.
Each conductor's proxy serves one model API. The host's `127.0.0.1` is not
reachable; use the conductor tools for DDEV and ports.

On macOS use allowlist mode; host networking cannot reach the host. macOS is untested.
