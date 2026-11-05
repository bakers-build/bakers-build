# @bakers-build/addon-ports

The ports feature (BB-475, BB-661, BB-676, BB-681): discover a ticket
worktree's **addon-claimed** services and share one over the machine's
**configured tunnel transport** — from the shell (`bakers ports …`), and as a
single contract-2 **inbox message**, `tunnel` ("Share tunnels"), a conductor
answers with its `ports_up` tool when someone sends it from a ticket's inline
message card. It carries
**no terminal UI** of its own: both render from its `inbox.messages`
definition, served by the bakers.build server. List it in the `addons` of a conductor
config to enable the message.

## What it does

**This package fires no `docker`/`ddev` calls itself.** Discovery here is
host-listener-only (`ss`, for the configured process rules); DDEV's own discovery and claiming
lives in two sibling packages — see
[`@bakers-build/addon-docker-compose`](../docker-compose/README.md) (generic Docker
Compose discovery) and [`@bakers-build/addon-ddev`](../ddev/README.md) (DDEV
interpretation), which this package calls as a plain dependency.

**`addon-ddev` does nothing CMS-specific.** Its web-container claim names
itself `web`, splitting into one `web-<host>` claim per configured AND
observed host alias. There is no CMS-specific policy layer (the old
`@bakers-build/addon-ports-drupal` is removed, with no replacement) — a claimed
Drupal (or any other) service shares exactly like any other claim; the
project owns its own public-vs-origin host handling.

1. **Discover** (`src/discovery.ts`): raw observations of this worktree's host
   listeners (`ss`) only. A missing probe is `unknown`, never "dead". No
   Docker call, no full `/proc` scan, no provider call — the budget is under
   a second (AC1); confirm against a real worktree with varying container
   counts rather than assuming the unit fixtures' timing transfers.
2. **Claim** (`src/claims.ts`): ordered claimers — the process rules from the
   entry's `with.services` (`src/service-config.ts`; Storybook is the shipped
   default entry), then DDEV (`@bakers-build/addon-ddev`'s `claimDdev`), then the
   opt-in `with.all_node` rule (`node-<port>`) — each claimer consuming only
   the raw identities (or claims) a prior one left. A Node inspector port
   (9229, an `--inspect*` flag, or a `/json/version` probe) is never claimed.
   DDEV keys never change; a colliding process claim becomes `<key>-<port>`.
   **Unclaimed ports are never tunnelled**; `list` still shows them, dimmed
   "no addon" in a TTY. A claimed
   service carries zero or more `TunnelRule`s; only a healthy claim produces
   an eligible rule.
3. **Name** (`src/claims.ts`, `publicHostname`): `<ticket>-<key>.<zone>` for a
   zone-based transport (Named Cloudflare, frp), single-level (the Universal
   SSL cert only covers `*.<zone>`) — computable from ticket + key alone. The
   Cloudflare Quick transport has no zone and returns an allocated
   `trycloudflare.com` URL per route instead.
4. **Reconcile** (`src/{lock,tunnel-state,tunnel-ops,config,transport}.ts`):
   under a machine-wide cross-process `flock`, pass the **complete** desired
   record set (every worktree/ticket/key, including tombstones) to the
   configured transport's `reconcile()`. Desired intent is persisted before
   any network mutation, so a crash is recoverable without duplicate records
   or lost routes.

A process whose working directory was deleted is an **orphan** — it outlived
its worktree — and is surfaced, not filtered.

## Commands

```
bakers ports list                         every claimed service of this worktree
bakers ports status                       this worktree's machine tunnel records
bakers ports up [service-key] [--ticket <id>]
bakers ports down [service-key]           take one key down, or every key of this worktree
bakers ports reap                         machine-wide reconciliation + legacy cloudflared cleanup
```

`up`, `down`, `status` and `reap` call the ports tools of the running conductor of this checkout
(found through `<BB_HOME>/conductors/*.json`, with its operator token): the conductor is the only
writer of the tunnel routes. With no live conductor they exit 1 naming `bakers oven start` and write
nothing. `list` stays local. Agents use the same tools, `ports_up`, `ports_down`, `ports_status` and
`ports_reap`, through the conductor's MCP server (`src/tools.ts`).

`<service-key>` is a claimed key (`web`, `web-admin-ddev-site`, `mailpit`, …), never a raw
port — the removed generic `up <port> --url` path returned a bare numeric port
as a tunnel target with no addon behind it; it now fails with an actionable
"pick a service key" error naming the claimed keys available. **`up` with no
key brings up every eligible service** (spec v5) — the same
thing the `tunnel` inbox message does; every multisite claim already carries a
distinct, fully-qualifying key, so there is no `--host` option.

`up vite` against a configured-but-dead port is refused, naming both the dead
configured port and the daemon actually observed listening elsewhere — never a
silent 502-producing tunnel.

## Transport

Pluggable, one per machine, selected in this addon's `addons[]` entry
(`with.transport.use`/`with`, machine entry wins over the project's) and
loaded by `loadPortsTransport`
(`src/config.ts`) — see the three shipped packages (`@bakers-build/addon-ports-cloudflare`,
`@bakers-build/addon-ports-cloudflare-quick`, `@bakers-build/addon-ports-frp`) and the
contract a fourth implements. `bakers ports` itself never starts or kills an
operator-run connector (Named Cloudflare, frp); it only calls the configured
transport's `reconcile()` under the machine lock.

## Host header policy

A claimed service's `TunnelRule` (`{ key, service, hostHeader?,
insecureTls?, direct? }`) is whatever the claimer produced — this package applies no
CMS-specific policy. A project that needs its public hostname's `Host` header
to resolve correctly (Drupal multisite site selection, trusted proxies,
absolute URLs, …) configures that itself; `bakers ports` shares the claimed
service unconditionally.

## State

- **Per-worktree view**: `bakers ports status`, filtered from the machine-wide
  record.
- **Machine-wide**: `<homeBbDir()>/tunnels.json` (schema 2, transport-
  agnostic; mode `0600`, atomic rename), the single source every `up`/`down`/
  `reap` reconciles against under the shared lock. **Absence of a key's
  record means its tunnel is off.** A transport/zone/remote identity change
  with remaining records or tombstones is refused — rotating a credential
  alone is never an identity change; switching to an incompatible transport
  or schema is **rejected outright, never migrated**. Retire existing routes
  under the old installation first.
- **Legacy**: a worktree's old `.bakers/ports-tunnels.json` (pre-BB-676
  per-port quick-tunnel state) is read **only** as migration evidence during
  `reap`'s legacy process cleanup — never written or deleted by this addon.
  Quick-tunnel URLs cannot be preserved; remove the old file manually once its
  worktree is reaped.

## Teardown

A finished ticket must leave no tunnel behind. Wire this into the
**machine-local** conductor configuration, never the committed one:

```jsonc
// ~/.bakers/conductor.config.js (or the machine's conductor config)
hooks: {
  after_done: 'bakers ports reap',
}
```

`reap` also kills orphaned **legacy** per-port `cloudflared tunnel --url …`
processes (revalidated by executable/argv/owner/cwd immediately before
`SIGTERM`, to guard against PID reuse) — it never touches an operator-run
connector or another user's processes. This legacy cleanup predates the
pluggable transport and runs regardless of which transport is configured.

## Platform

Linux carries the primary implementation. On another platform discovery
reports an explicit unsupported state rather than a wrong or empty answer
that reads as "nothing running". Nothing here needs root.
