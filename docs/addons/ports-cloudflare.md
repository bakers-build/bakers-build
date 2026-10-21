# Named Cloudflare tunnel

**A ports transport that gives each shared service a fixed name in your own Cloudflare zone.**

For teams that want stable preview URLs such as `https://<ticket>-<key>.<zone>`. It is used by [Ports](/addons/ports).

## Enable it

Set it as the transport of the [Ports](/addons/ports) addon entry, usually in `~/.bakers/machine.config.js`. It is not an `addons` entry of its own.

```js
addons: [
  {
    use: '@bakers-build/addon-ports',
    with: {
      transport: {
        use: '@bakers-build/addon-ports-cloudflare',
        with: {
          zone: 'preview.example.org',
          accountId: '<account id>',
          tunnelId: '<tunnel id>',
          zoneId: '<zone id>',
          apiToken: process.env.CF_API_TOKEN,
        },
      },
    },
  },
],
```

Before that, an operator sets up:

1. A dedicated zone that Cloudflare fully manages (nameservers pointed at Cloudflare, not only proxied). A subdomain of an already-managed zone also works.
2. A remotely managed named tunnel in that account, with a long-running `cloudflared` connector signed in to it.
3. A restricted API token with only **Cloudflare Tunnel** (Account, Write) and **DNS** (Zone, Edit), scoped to that account and zone. Create it at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).

## Options

| Option | Type | Default | Effect |
|---|---|---|---|
| `zone` | string | required | Zone the public names are created in. |
| `accountId` | string | required | Cloudflare account. |
| `tunnelId` | string | required | Named tunnel. |
| `zoneId` | string | required | Zone ID for DNS records. |
| `apiToken` | string | required | API token. Rotating it alone is not an identity change. |

## Check it works

Sharing a service returns a `https://<ticket>-<key>.<zone>` URL that serves it.

## Good to know

- A missing field is rejected before any network call, naming the field.
- It owns the tunnel's whole ingress list and the CNAME records it creates. It never starts or stops the `cloudflared` connector.
- One account owns one tunnel. A second machine must not reconcile the same tunnel.
- The token is redacted from errors and logs.

Source: [`bakers-cli/addons/ports-cloudflare`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/ports-cloudflare)
