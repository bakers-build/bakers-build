# @bakers-build/addon-ddev

DDEV-specific service discovery and claiming, over `@bakers-build/addon-docker-compose`'s generic
container data: `HTTP_EXPOSE`/`HTTPS_EXPOSE` router-port parsing, `VIRTUAL_HOST` multisite handling,
`webextradaemons:<name>` naming, and effective-host discovery via `ddev utility configyaml`.
**No CMS-specific policy lives here** — the project's web container router port claims itself
generically as `web`, exactly like every other DDEV service (Mailpit, phpMyAdmin, …); the primary
web claim additionally splits into one `web-<host>` claim per configured AND observed host alias.

Split out of `@bakers-build/addon-ports` (BB-676 spec v2, operator decision 2026-10-15: `bakers ports`
must not fire Docker/DDEV calls itself). It implements `@bakers-build/addon-ports`' `Claimer`
contract and takes `RawPort`/`ClaimedService`/`ClaimContext`/… from `@bakers-build/addon-ports/core`;
the edge runs `addon-ddev -> addon-ports`, never back. Enable it in the ports entry:

```js
{ use: '@bakers-build/addon-ports', with: { claimers: ['@bakers-build/addon-ddev'], transport: { use: '…' } } }
```

## What it does

- `claimer` — the `Claimer` ports loads: `discover` runs `discoverDdevPorts`, `discoverDdevHosts`
  and reads `.ddev/config.yaml`'s `web_extra_exposed_ports`; a failed hosts read becomes a
  `source: 'claimer'` diagnostic with `keyPrefix: 'web'`. `claim` is `claimDdev`.

- `discoverDdevPorts(worktree, deps)` — every DDEV-exposed container port for this worktree, as
  `RawPort[]`: calls `@bakers-build/addon-docker-compose`'s `discoverCompose` (unioning the
  `com.ddev.approot` label), then interprets `HTTP(S)_EXPOSE`/`VIRTUAL_HOST`/service labels.
- `claimDdev(raw, remaining, ctx)` — the DDEV claimer: coalesces a container's primary web router
  ports (80/443) into one group named `web`, names every other service from
  daemon/service-type/compose-service evidence, and rewrites Host to the first observed
  `VIRTUAL_HOST` for any healthy service — the same generic treatment for `web` as for Mailpit or
  phpMyAdmin. A healthy rule also carries `direct: http://<ddev_default IP>:<container port>`
  for transports that dial the container and keep the public Host (frp); `web-<host>` aliases
  never get one.

## Platform

Linux only (inherits `@bakers-build/addon-docker-compose`'s constraint); nothing here needs root.

## Agent tools

`./preset` exports `tools` (`src/tools.ts`): `ddev_status`, `ddev_start` and `ddev_exec(command)`,
run with `cwd` = the run's bound worktree. Listed in a conductor's `addons[]`, the conductor serves
them through its MCP server. Timeouts are 10 minutes for `start` and 5 otherwise; answers carry the
exit code and the last 64 KB of output.
