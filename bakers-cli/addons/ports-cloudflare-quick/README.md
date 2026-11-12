# @bakers-build/addon-ports-cloudflare-quick

`bakers ports`'s Quick Tunnel transport (`PortsTransport`): one managed
`cloudflared tunnel --url …` process PER ROUTE, each in its own private
directory under `BAKERS_HOME`, with no shared cloudflared account/config.

## Quick Tunnel limitations (real cloudflared constraints — not enforced by this code, surfaced here so operators aren't surprised)

- **No fixed name or URL.** Every (re)start allocates a NEW
  `https://<random-label>.trycloudflare.com` URL. Unlike Named Cloudflare or
  frp, there is no `<ticket>-<key>.<zone>` guarantee — recreating a route
  (origin change, crash) may hand back a different URL every time.
- **No uptime guarantee.** Quick Tunnels are an unmanaged, best-effort
  Cloudflare offering — not for anything that needs to stay up.
- **200 in-flight request limit.** Cloudflare caps concurrent in-flight
  requests per Quick Tunnel; beyond that, requests queue or fail.
- **No SSE support.** Server-Sent Events don't work over a Quick Tunnel.

## Settings

No settings — `cloudflared` is always resolved from `PATH`:

```js
// machine.config.js
addons: [
  {
    use: '@bakers-build/addon-ports',
    with: {
      transport: {
        use: '@bakers-build/addon-ports-cloudflare-quick',
      },
    },
  },
]
```
