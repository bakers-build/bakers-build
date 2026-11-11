# Docker runtime

`@bakers-build/addon-runtime-docker` starts each agent run in its own container. It fills the
[`runtime` slot](/addons/slots#runtime-where-a-run-starts): the executor's terminal runs
`docker run …` instead of the agent, and the worktree, Git and conductor tools keep their host
paths. Machine scope only; add it to `~/.bakers/machine.config.js`:

```js
{ use: '@bakers-build/addon-runtime-docker', with: { docker: 'podman' } }
```

## Before the first run

- A container cannot use your Claude login: export `CLAUDE_CODE_OAUTH_TOKEN` (from
  `claude setup-token`) or `ANTHROPIC_API_KEY` for the conductor. Without one, runs refuse to start.
- The first run builds `bakers-runtime:<addon version>-<hash>` from the shipped `image/`
  (Claude Code only); a changed image file rebuilds it. Other harnesses need your own `with.image`.

## Options

| `with` key | Default | Meaning |
|---|---|---|
| `docker` | `'docker'` | `'podman'` also works. |
| `image` | shipped image | Your image; never built. |
| `mounts` | `[]` | Extra host paths, read-only. |
| `network` | `'host'` | Or `'allowlist'`. |
| `allow` | `[]` | Allowlist hosts, exact or `*.suffix`. |

## What a run sees

Container `bb-run-<run uuid>`, under your uid. Mounts, and nothing else of your home:

- the worktree and the Git common directory, at their host paths; `hooks/`, `config` and
  `config.worktree` read-only;
- the bakers CLI build, read-only;
- `$XDG_CACHE_HOME/bakers/runtime/<run uuid>` as `/home/run`;
- Claude's transcript directory for the worktree, so the conductor reads the transcript.

No `~/.ssh`, `~/.bakers`, Docker socket or `.credentials.json`. Secrets enter as `-e KEY`, never in
the command line. The harness sandbox is off. Pushes go through `forge_push` in the conductor. The
container and run home are removed after the run.

## Allowlist mode

With `network: 'allowlist'`, runs join the internal network `bb-runtime`. One proxy per conductor
is their only way out: HTTPS to `allow` hosts (others get `403`), the model API with the real
credential added by the proxy, and the conductor tool server. The host's `127.0.0.1` is not
reachable; use the conductor tools for DDEV and ports.

On macOS `--network host` does not reach the host, so use allowlist mode. macOS is not yet tested.
