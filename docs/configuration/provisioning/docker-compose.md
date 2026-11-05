# Docker Compose

Use the repository's Compose application with a separate project for every ticket. This is project tooling called by hooks, not a bakers.build provisioning addon.

## AI first

```text
Read https://bakers.build/configuration/provisioning/docker-compose.
Read this repository’s Compose setup. Propose separate per-ticket
identities, ports, readiness and cleanup using this reference. Confirm exact
commands before wiring them with bb-init-project; keep existing data safe.
```

The reference below explains the commands and configuration changes.

**You need:** Docker and Compose available to the conductor user, an existing Compose file with application health checks, and a repository-specific readiness command.

```sh
docker info
docker compose version
```

Both must succeed without `sudo`. Install missing tools through your project's platform instructions.

## Per-ticket setup

Merge these hooks into `.bakers/conductor.config.js`:

```js
hooks: {
  after_create: 'sh scripts/prepare-compose.sh',
  after_done: 'sh scripts/cleanup-compose.sh',
},
```

Create `scripts/prepare-compose.sh`:

```sh
set -eu
: "${BB_ID:?ticket UUID required}"
printf '%s\n' "$BB_ID" | grep -Eq '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
printf 'bakers-%s\n' "$BB_ID" > .bakers/compose-project.local
project=$(cat .bakers/compose-project.local)
docker compose --project-name "$project" up -d
docker compose --project-name "$project" ps
```

Ignore `.bakers/compose-project.local` in Git. Keep the Compose configuration consistent on every dispatch. Compose scopes ordinary containers, networks and volumes by project name; fixed `container_name`, explicitly named or external resources can bypass that isolation. Avoid them or supply ticket-specific names. Bind preview ports to loopback and use distinct or dynamically allocated host ports; a unique project name alone does not isolate fixed host ports.

## Readiness

`up -d` starts containers; it does not prove the application is ready. Check container health and run your repository's HTTP/database readiness command before work begins. Put this mandatory gate in `WORKFLOW.md`. Run setup twice in a disposable worktree and confirm it reuses only that project's resources. [Hook failures](/configuration/provisioning/hooks#failure-behavior) are logged without stopping dispatch.

## Cleanup

`after_done` has no ticket variables. Read and validate the stored identity in `scripts/cleanup-compose.sh`:

```sh
set -eu
project=$(cat .bakers/compose-project.local)
printf '%s\n' "$project" | grep -Eq '^bakers-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
docker compose --project-name "$project" down
```

A missing/invalid identity aborts cleanup. This stops/removes that Compose project's containers and networks while retaining named volumes. Export needed data before adding destructive volume removal; never run global prune as ticket cleanup. External resources need their own scoped lifecycle.

**Agents need the running services?** Configure [`provision_up`](/configuration/provisioning/hooks#provision-on-an-agent-s-request) with a command that follows its contract.

**Done when:** two ticket worktrees can run concurrently, both pass application readiness, and cleaning one leaves the other working. [Docker Compose discovery](/addons/docker-compose) can expose the resulting services to [Ports](/addons/ports).
