# Docker runtime

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

- the worktree, with its `.git` pointer read-only. Independent per-run Git metadata replaces
  the linked worktree's admin directory inside the container. Parent and sibling Git metadata
  is never mounted writable; commits and refs stay private until explicit transfer;
- `.bakers/` and effective `runtime.read_only` paths, read-only. DDEV contributes `.ddev`
  automatically. Host provisioning still writes generated files there;
- the bakers CLI build, read-only. The runtime refuses to start when that build's root would
  contain your home directory;
- `$XDG_CACHE_HOME/bakers/runtime/<run uuid>` at its host path;
- the read/write paths from neutral agent preparation: Claude plugins read-only and the worktree transcript directory writable. Docker has no Claude-specific adapter.

No `~/.ssh`, `~/.bakers`, Docker socket or harness login (`.credentials.json`). Secrets use `-e KEY`, never values in argv.
Permissions stay unchanged. Check and startup warn: sandbox preflight probes only the host.
The shipped image lacks `bwrap`/`socat`; unavailable sandboxes fail closed and consume retries.
See [prerequisites](/provision/security/shared-settings#verify). Transfer commits first with `runtime_transfer_commit`, then push with `forge_push`. Cleanup removes the container and home, retaining private Git for recovery.

## Delivery and limits

`runtime_transfer_commit` imports a full commit hash through clean metadata, advancing only
the ticket branch if its previous tip matches. No source config/hooks are imported. Gitlinks/submodules
are refused. Cleanup retains private Git for recovery; remove it only after delivery.
See [transfer, index reconciliation and cache paths](/provision/security/shared-settings#isolated-git-delivery).

A maintainer changes protected files outside the isolated run. See
[shared runtime paths](/provision/security/shared-settings#host-executed-paths).
Host tools still execute unprotected repository code: package lifecycle scripts, docs
configuration and CLI builds. Protecting their launch scripts does not isolate that code.

## Allowlist mode

With `network: 'allowlist'`, runs join the internal network `bb-runtime-<conductorKey>`.
Each conductor’s proxy is its runs’ only way out: HTTPS to `allow` hosts (others get `403`), the agent's model API with the
real credential added by the proxy, and the conductor tool server. The run holds a placeholder key.
Each conductor's proxy serves one model API. The host's `127.0.0.1` is not
reachable; use the conductor tools for DDEV and ports.

On macOS use allowlist mode; host networking cannot reach the host. macOS is untested.
