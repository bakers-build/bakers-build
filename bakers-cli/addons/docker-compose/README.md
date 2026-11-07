# @bakers-build/addon-docker-compose

Generic Docker Compose discovery for a worktree: no runtime-specific knowledge, no port claiming, no
tunnelling — just `docker ps -a`, `docker inspect`, and one bounded per-running-container
`docker exec` (socket `ss -ltnp` + `supervisorctl status`, pid-correlated).

Split out of `@bakers-build/addon-ports` (BB-676 spec v2, operator decision 2026-10-15: `bakers ports`
must not fire `docker` itself). A runtime addon consumes it, asking for its own extra worktree label
match via `discoverCompose`'s `extraLabelFilters` option — this package never has to know what that
label means.

## What it does

`discoverCompose(worktree, deps, opts?)` returns every container matching
`com.docker.compose.project.working_dir=<worktree>` (plus any `opts.extraLabelFilters`), each with
its labels, raw env, `NetworkSettings.Ports` bound-port map, and — for a running container — the
confirmed live sockets (correlated to a supervisor daemon by pid, falling back to an ancestor-process
walk) and any supervisor-managed daemon with no live socket to attach to (`unattachedDaemons`).

A failed probe is a `ComposeDiagnostic`, never a fabricated empty result — `socketsProbed: false` on
a container distinguishes "nothing is listening" from "the probe itself could not see".

## Platform

Linux only (Docker CLI + `ss`/`supervisorctl` inside containers); nothing here needs root.
