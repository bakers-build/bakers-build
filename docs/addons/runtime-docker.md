# Docker runtime

`@bakers-build/addon-runtime-docker` fills the [`runtime` slot](/addons/slots#runtime-where-a-run-starts),
starting each run in a container while preserving host paths. Machine scope; add to `~/.bakers/machine.config.js`:

```js
{ use: '@bakers-build/addon-runtime-docker', with: { docker: 'podman' } }
```

## Before the first run

- The default image uses neutral `installCommand`; [Claude](/addons/claude#isolated-runtimes) declares one. With `image`, supply the installed agent.
- A container cannot use your harness login. Export the agent's credential for the conductor; for
  Claude `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or `ANTHROPIC_API_KEY`.
- An agent's first run builds `bakers-runtime:<addon version>-<hash>-<install hash>` from the
  shipped `image/` plus the agent's install command. `with.image` replaces it.

## Options

<!-- @options @bakers-build/addon-runtime-docker -->

## What a run sees

Container `bb-run-<run uuid>`, under your uid. Mounts, and nothing else of your home:

- the worktree and the Git common directory, at their host paths. Read-only: the worktree's
  `.git` file, `hooks/`, `config`, `modules/`, `worktrees/` (except the run's own Git dir), and
  every `config.worktree`, `commondir` and `gitdir`. After container removal, cleanup checks index
  gitlinks without following symlinks. Unprotected repositories get `.git.bakers-quarantine-<uuid>`;
  failed inspections or renames remove the gitlink from the index. If that fails or the scan fails,
  the intact index is quarantined for recovery. Ignored clones stay untouched.
  Run no Git in the worktree until cleanup finishes;
- the bakers CLI build, read-only. The runtime refuses to start when that build's root would
  contain your home directory;
- `$XDG_CACHE_HOME/bakers/runtime/<run uuid>` at its host path;
- the read/write paths from neutral agent preparation: Claude plugins read-only and the worktree transcript directory writable. Docker has no Claude-specific adapter.

No `~/.ssh`, `~/.bakers`, Docker socket or harness login (`.credentials.json`). Secrets use `-e KEY`, never values in argv.
Permissions stay unchanged. Check and startup warn: sandbox preflight probes only the host.
The shipped image lacks `bwrap`/`socat`; unavailable sandboxes fail closed and consume retries.
See [prerequisites](/provision/security/shared-settings#verify). Pushes use `forge_push`; cleanup removes the container and home.

**Not isolated:** conductor tools and project hooks that run worktree files on the host
(`provision_up`, `ddev_start`, `ddev_exec`, `before_run`, `after_run`); the run can edit them.

## Allowlist mode

With `network: 'allowlist'`, runs join the internal network `bb-runtime-<conductorKey>`.
Each conductor’s proxy is its runs’ only way out: HTTPS to `allow` hosts (others get `403`), the agent's model API with the
real credential added by the proxy, and the conductor tool server. The run holds a placeholder key.
Each conductor's proxy serves one model API. The host's `127.0.0.1` is not
reachable; use the conductor tools for DDEV and ports.

On macOS use allowlist mode; host networking cannot reach the host. macOS is untested.
