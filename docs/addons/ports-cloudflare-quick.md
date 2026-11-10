# Cloudflare Quick tunnel

**A ports transport that shares a service under a random `trycloudflare.com` URL, with no account.**

For quick, short-lived previews. It is used by [Ports](/addons/ports).

## Enable it

Set it as the transport of the [Ports](/addons/ports) addon entry, usually in `~/.bakers/machine.config.js`. It is not an `addons` entry of its own. `cloudflared` must be on `PATH`. The current process-ownership implementation uses Linux `/proc`.

```js
addons: [
  {
    use: '@bakers-build/addon-ports',
    with: {
      transport: { use: '@bakers-build/addon-ports-cloudflare-quick' },
    },
  },
],
```

## Options

No options. A non-empty `with` is rejected.

## Check it works

Use `bakers ports list`, then `bakers ports up <service-key>` with the conductor running. Sharing returns a `https://<random>.trycloudflare.com` URL that serves it.

## Good to know

- The URL exposes the service publicly. Stop sharing with `bakers ports down <service-key>` when finished.

- Each route runs its own `cloudflared` process.
- No fixed name: every restart can hand back a different URL.
- [Cloudflare limits](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/#limitations): no uptime guarantee, 200 in-flight requests per tunnel, and no Server-Sent Events. This addon supplies no email-access option.

Package source in a checkout: `bakers-cli/addons/ports-cloudflare-quick`.
