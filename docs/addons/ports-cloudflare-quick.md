# Cloudflare Quick tunnel

**A ports transport that shares a service under a random `trycloudflare.com` URL, with no account.**

For quick, short-lived previews. It is used by [Ports](/addons/ports).

## Enable it

Set it as the transport of the [Ports](/addons/ports) addon entry, usually in `~/.bakers/machine.config.js`. It is not an `addons` entry of its own. `cloudflared` must be on `PATH`.

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

Sharing a service returns a `https://<random>.trycloudflare.com` URL that serves it.

## Good to know

- Each route runs its own `cloudflared` process.
- No fixed name: every restart can hand back a different URL.
- No uptime guarantee, a limit of 200 requests in flight per tunnel, and no Server-Sent Events.

Package source in a checkout: `bakers-cli/addons/ports-cloudflare-quick`.
