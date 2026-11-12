# Docker runtime

`@bakers-build/addon-runtime-docker` starts each agent run in its own container. It fills the
[`runtime` slot](/addons/slots#runtime-where-a-run-starts): the executor's terminal runs
`docker run …` instead of the agent, and the worktree, Git and conductor tools keep their host
paths. Machine scope only; add it to `~/.bakers/machine.config.js`:

```js
{ use: '@bakers-build/addon-runtime-docker', with: { docker: 'podman' } }
```

## Before the first run

- The agent must support a container runtime. [Claude](/addons/claude#container-runtime) does. A run
  of an agent that does not refuses to start.
- A container cannot use your harness login. Export the credential the agent names for the
  conductor; for Claude that is `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or
  `ANTHROPIC_API_KEY`. Without one, runs refuse to start.
- The first run of an agent builds `bakers-runtime:<addon version>-<hash>-<install hash>` from the
  shipped `image/` plus the agent's own install command. A changed image file or install rebuilds
  it. `with.image` replaces it for every agent.

## Options

<!-- @options @bakers-build/addon-runtime-docker -->

## What a run sees

Container `bb-run-<run uuid>`, under your uid. Mounts, and nothing else of your home:

- the worktree and the Git common directory, at their host paths. Read-only: the worktree's
  `.git` file, `hooks/`, `config`, `modules/`, `worktrees/` (except the run's own Git dir), and
  every `config.worktree`, `commondir` and `gitdir`. A nested repository the run creates could
  still make host Git run a command, so after the run every `.git` not pointing into `modules/` is
  renamed `.git.bakers-quarantine`. Run no Git in a live run's worktree;
- the bakers CLI build, read-only. The runtime refuses to start when that build's root would
  contain your home directory;
- `$XDG_CACHE_HOME/bakers/runtime/<run uuid>` as `/home/run`;
- what the agent asks for, such as Claude's plugins (read-only) and its transcript directory for
  the worktree, so the conductor reads the transcript.

No `~/.ssh`, `~/.bakers`, Docker socket or harness login (`.credentials.json`). Secrets enter as `-e KEY`, never in
the command line. The harness sandbox is off. Pushes go through `forge_push` in the conductor. The
container and run home are removed after the run.

## Allowlist mode

With `network: 'allowlist'`, runs join the internal network `bb-runtime`. One proxy per conductor
is their only way out: HTTPS to `allow` hosts (others get `403`), the agent's model API with the
real credential added by the proxy, and the conductor tool server. The run holds a placeholder key.
One conductor's proxy serves one model API at a time. The host's `127.0.0.1` is not
reachable; use the conductor tools for DDEV and ports.

On macOS `--network host` does not reach the host, so use allowlist mode. macOS is not yet tested.
