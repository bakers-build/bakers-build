# @bakers-build/addon-ports-cloudflare

bakers.build ports transport: a remotely managed **Named Cloudflare Tunnel**,
reconciled via the Cloudflare API (ingress configuration + owned proxied DNS
CNAMEs). Implements `@bakers-build/addon-ports`'s `PortsTransport` contract — the
same shape `@bakers-build/addon-ports-frp` and `@bakers-build/addon-ports-cloudflare-
quick` implement.

## What this addon owns, and what it doesn't

- **Owns:** the tunnel's complete ingress list (uploaded whole on every
  reconcile — the Cloudflare API replaces the list, it does not merge it) and
  the proxied CNAME per hostname it created.
- **Does not own:** the `cloudflared` connector process. The operator runs a
  long-lived `cloudflared tunnel run --token …` connector (e.g. a systemd user
  service); this addon never starts or stops it — it only uploads
  configuration and DNS records over the Cloudflare REST API.

## Operator setup expectations

1. A **dedicated Cloudflare zone** for tunnels, so tokens and wildcards never
   touch production DNS.
2. A **remotely managed named tunnel** (`tunnelId`) in that account, plus a
   running `cloudflared` connector authenticated to it.
3. A **restricted API token** (`apiToken`) scoped to that zone/account, with
   *Cloudflare Tunnel: Edit* and *DNS: Edit* — nothing broader.
4. One operator account owns one tunnel: a second machine/user must not
   reconcile the same `tunnelId` independently — the machine-wide lock only
   serializes operations from the owning account.

## Config shape (the `@bakers-build/addon-ports` entry's `with.transport`)

```js
addons: [
  {
    use: '@bakers-build/addon-ports',
    with: {
      transport: {
        use: '@bakers-build/addon-ports-cloudflare',
        with: {
          zone: 'preview.example.org',
          accountId: 'YOUR_ACCOUNT_ID',
          tunnelId: 'YOUR_TUNNEL_ID',
          zoneId: 'YOUR_ZONE_ID',
          apiToken: process.env.CF_API_TOKEN,
        },
      },
    },
  },
],
```

All five fields are required strings; a missing one is rejected before any
network call, naming the missing field(s). `identity` (used to detect a
transport/zone/remote change while records exist) is
`<accountId>/<tunnelId>/<zoneId>` — deliberately excluding `apiToken`, so
rotating the token alone is never treated as an identity change. The token is
redacted wherever it would otherwise leak into a thrown error, log line or CLI
argument.

## Host header policy

Every `TunnelRule`'s `hostHeader`/`insecureTls` map directly to Cloudflare's
ingress `originRequest.httpHostHeader`/`noTLSVerify` — this addon applies
whatever the claimer supplied; it has no CMS-specific policy of its own.

## Status

`reconcile()` uploads the complete desired ingress list (every worktree's
rules, plus a final catch-all `http_status:404`) and creates/deletes the
matching proxied CNAME per hostname, checkpointing ownership results under the
same lock the generic ports layer holds, so a crash mid-reconcile is
recoverable without duplicate or orphaned DNS records.
