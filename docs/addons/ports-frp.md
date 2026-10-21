# frp tunnel

**A ports transport that shares services through your own frp server under fixed names.**

For teams that run their own [frp](https://github.com/fatedier/frp) server. It is used by [Ports](/addons/ports).

## Enable it

Set it as the transport of the [Ports](/addons/ports) addon entry, usually in `~/.bakers/machine.config.js`. It is not an `addons` entry of its own.

```js
addons: [
  {
    use: '@bakers-build/addon-ports',
    with: {
      transport: {
        use: '@bakers-build/addon-ports-frp',
        with: {
          zone: 'preview.example',
          clientConfigPath: '/etc/frp/frpc.json',
          adminPort: 7400,
          adminUser: 'admin',
          adminPassword: '<local admin password>',
        },
      },
    },
  },
],
```

The operator provides:

1. `frps` behind a wildcard TLS proxy for `*.<zone>`, for example Caddy.
2. A running `frpc` with its own client `user` for this machine.
3. A client config whose `includes` is exactly `<BB_HOME>/frp/routes.json`, with no inline `proxies`, `visitors` or `store`.
4. `webServer.addr` bound to `127.0.0.1`, and `transport.tls.enable: true` with a `trustedCaFile`.

## Options

| Option | Type | Default | Effect |
|---|---|---|---|
| `zone` | string | required | Domain of the public names. |
| `clientConfigPath` | string | required | Absolute path to the frpc JSON config. Read only, never written. |
| `adminPort` | integer | required | Port of frpc's local admin API. |
| `adminUser` | string | required | Admin API user. |
| `adminPassword` | string | required | Admin API password, not the frps token. |

## Check it works

Sharing a service returns a `https://<ticket>-<key>.<zone>` URL that serves it.

## Good to know

- It writes only `<BB_HOME>/frp/routes.json`. It never starts `frpc` or reads its token.
- A client config of the wrong shape is rejected before anything changes.
- DDEV services are proxied straight to the container IP. An unreachable IP, for example on Docker Desktop, fails that service; OrbStack works.
- An HTTPS origin is shared only when its rule allows skipping certificate checks, because frp's `http2https` plugin cannot verify it.

Source: [`bakers-cli/addons/ports-frp`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/ports-frp)
