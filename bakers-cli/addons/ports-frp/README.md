# @bakers-build/addon-ports-frp

bakers.build ports transport: a self-hosted [frp](https://github.com/fatedier/frp)
client (`frpc`) over an operator-owned config, reconciled via its local
admin API. Implements `@bakers-build/addon-ports`'s `PortsTransport` contract —
the same shape `@bakers-build/addon-ports-cloudflare` implements for Named
Cloudflare.

## What this addon owns, and what it doesn't

- **Owns:** one file, `<BAKERS_HOME>/frp/routes.json` — the complete desired
  proxy list for every worktree on this machine, no secrets, atomic 0600
  write.
- **Does not own:** the `frpc` process (operator-managed, same stance as
  Cloudflare's `cloudflared`), the frpc client config file itself (read and
  strictly validated, never written to), and any token/credential (those
  live in the operator's own config/token source and are never echoed).
  Installing `frpc`, writing that config and starting the user service are
  documented in `docs/addons/ports-frp.md` › Set up.

## Operator setup expectations

1. **frps** (the frp server) running with a wildcard TLS vhost in front —
   typically Caddy terminating `*.<zone>` and reverse-proxying to frps's
   vhost HTTP port, so this addon's `customDomains` entries resolve to real
   HTTPS without this addon ever touching certificates itself.
2. **A dedicated frpc client identity** per machine (`user` in the client
   config) — not shared with any other frp client, so this addon's
   generation/ownership bookkeeping in `routes.json` cannot collide with
   someone else's proxies.
3. **Token source**: the frpc config's `auth` block carries the actual
   token/secret (however the operator chooses to provision it — a secrets
   manager, a local file with its own permissions, …). This addon never
   reads, writes, or logs it.
4. **The client config's `includes`** must be exactly one entry: the
   absolute path `<BAKERS_HOME>/frp/routes.json`. No inline `proxies`,
   `visitors`, or `store` — this addon strictly rejects any other shape
   before touching anything, so a misconfigured operator file fails loudly
   instead of silently losing routes.
5. **`webServer.addr` must bind `127.0.0.1`** — the admin API this addon
   calls (`/api/reload`, `/api/status`) is loopback-only, never exposed.
6. **Explicit server TLS verification** — frp's default channel encryption
   is not identity verification. This addon requires
   `transport.tls.enable: true` *and* a `trustedCaFile`, so a compromised
   network path can't quietly impersonate the frps server.

## Direct container origins

A rule with a `direct` origin (`http://<container IP>:<port>`, emitted by
a container runtime's claimer) becomes a plain `http` proxy to that IP and port. It has no
plugin and no `hostHeaderRewrite`, and it sets
`requestHeaders.set["X-Forwarded-Proto"] = "https"`, so the app sees the
public Host and scheme. Reconcile first makes a 1500 ms TCP connection to the
container. An unreachable IP, for example on Docker Desktop, fails that
record with a message that recommends OrbStack. `direct` must be a plain
`http:` URL; any other value is rejected for that record. The route targets an IP
on the runtime's shared network. Every `bakers ports up` (and `reap`) re-checks all
recorded routes first, so a changed IP is rewritten and a stopped
container's route is taken down. Until then, another project that takes over
the old IP would be served under this public host.

## The `http2https` origin-TLS limitation

Local HTTPS origins without a `direct` origin (for example a runtime router's
`web-<host>` aliases) (mkcert-signed, not operator/CA-trusted) are
proxied via frp's `http2https` client plugin. **In frp 0.68.0, this plugin
unconditionally skips origin certificate verification** — there is no
config knob to make it actually verify the origin's cert. This addon
therefore only uses `http2https` for a rule that explicitly opts in via
`insecureTls: true`; a rule whose HTTPS origin requested verification
(`insecureTls` false or omitted) is a hard, pre-mutation rejection
(`FrpUnverifiedHttpsError`) — never a silent downgrade.

## Config shape (the `@bakers-build/addon-ports` entry's `with.transport`)

```js
addons: [
  {
    use: '@bakers-build/addon-ports',
    with: {
      transport: {
        use: '@bakers-build/addon-ports-frp',
        with: {
          zone: 'preview.example',
          client_config_path: '/etc/frp/frpc.json', // operator-owned, absolute
          admin_port: 7400,
          admin_user: 'admin',
          admin_password: '...', // the LOCAL admin API's own credential, not the frps token
        },
      },
    },
  },
],
```

## Status

The `/api/status` response shape this addon parses (`tests/frp.test.ts`'s
fixtures, `src/reconcile.ts`'s `FrpStatusResponse`) is a **plausible**
frpc 0.68.0 admin API shape built from the public field names in frp's
docs — it has not been verified against a real frpc instance. If the real
shape differs, only `flattenStatus` in `src/reconcile.ts` needs updating;
nothing else depends on its exact fields.
