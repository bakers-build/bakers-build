# Docker Compose discovery

**Finds a worktree's Docker Compose containers and the ports they listen on.**

It is a support library. You do not enable it on its own; a runtime addon uses it to claim services for [Ports](/addons/ports).

## Enable it

Nothing to enable directly. Configure a runtime claimer such as [DDEV](/addons/ddev#enable-it), then run `bakers ports list` in the worktree.

## Check it works

Running Compose services of a worktree, claimed by a runtime addon, appear in the ports list.

## Good to know

- It matches containers by their Compose working directory and checks which sockets listen inside each running container.
- A failed check is reported as unknown, never as "nothing running".
- Needs Docker access and Linux containers. It probes `ss`, falling back to `/proc/net/tcp*`; missing `supervisorctl` is allowed. Failed probes remain unknown, so an empty result is not proof that a service stopped.

Package source in a checkout: `bakers-cli/addons/docker-compose`.
