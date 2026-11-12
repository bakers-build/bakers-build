# Named Cloudflare tunnel

**A ports transport that gives each shared service a fixed name in your own Cloudflare zone.**

For teams that want stable preview URLs such as `https://<ticket>-<key>.<zone>`. It is used by [Ports](/addons/ports).

## Enable it

Set it as the transport of the [Ports](/addons/ports) addon entry, usually in `~/.bakers/machine.config.js`. It is not an `addons` entry of its own.

Before adding the transport, an operator sets up:

1. A dedicated zone that Cloudflare fully manages (nameservers pointed at Cloudflare, not only proxied). A subdomain of an already-managed zone also works.
2. A remotely managed named tunnel in that account, with a long-running `cloudflared` connector signed in to it.
3. A restricted API token with only **Cloudflare Tunnel** (Account, Write) and **DNS** (Zone, Edit), scoped to that account and zone. Create it at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).

```js
addons: [
  {
    use: '@bakers-build/addon-ports',
    with: {
      transport: {
        use: '@bakers-build/addon-ports-cloudflare',
        with: {
          zone: 'preview.example.org',
          account_id: '<account id>',
          tunnel_id: '<tunnel id>',
          zone_id: '<zone id>',
          api_token: process.env.CF_API_TOKEN,
        },
      },
    },
  },
],
```

## Options

<!-- @options @bakers-build/addon-ports-cloudflare -->

## Check it works

Use `bakers ports list`, then `bakers ports up <service-key>` with the conductor running. Sharing returns a `https://<ticket>-<key>.<zone>` URL that serves it.

## Good to know

- The URL exposes the service publicly. Stop sharing with `bakers ports down <service-key>` when finished.

- A missing field is rejected before any network call, naming the field.
- It owns the tunnel's whole ingress list and the CNAME records it creates. It never starts or stops the `cloudflared` connector.
- Dedicate the tunnel to one machine/operator. A second machine must not reconcile it; unmanaged ingress rules block reconciliation.
- The token is redacted from errors and logs.

Package source in a checkout: `bakers-cli/addons/ports-cloudflare`.
