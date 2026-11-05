# Docker Compose discovery

**Finds a worktree's Docker Compose containers and the ports they listen on.**

It is a support library. You do not enable it on its own; [DDEV discovery](/addons/ddev) uses it for [Ports](/addons/ports).

## Enable it

Nothing to enable — used by [DDEV discovery](/addons/ddev).

## Options

No options.

## Check it works

Running DDEV services of a worktree appear in the ports list.

## Good to know

- It matches containers by their Compose working directory and checks which sockets listen inside each running container.
- A failed check is reported as unknown, never as "nothing running".
- Linux only. It needs the Docker CLI, and `ss` and `supervisorctl` inside the containers. It does not need root.

Package source in a checkout: `bakers-cli/addons/docker-compose`.
