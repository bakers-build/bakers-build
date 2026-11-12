# frp tunnel

**A ports transport that shares services through your own frp server under fixed names.**

For teams that run their own [frp](https://gofrp.org/en/docs/) server. It is used by [Ports](/addons/ports).

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
          client_config_path: '/etc/frp/frpc.json',
          admin_port: 7400,
          admin_user: 'bakers',
          admin_password: '<local admin password>',
        },
      },
    },
  },
],
```

The operator runs `frps` with a public-CA certificate behind a wildcard TLS proxy for `*.<zone>`, and hands out your server, port, user and token.

## Set up

1. **Install `frpc` 0.68.0** per frp's [setup docs](https://gofrp.org/en/docs/setup/), from its [release](https://github.com/fatedier/frp/releases/tag/v0.68.0).
2. **Add the ports entry** above: the operator's `zone`, a `client_config_path` your user can write, a free `admin_port`, an admin user and password.
3. **Write `client_config_path`** with mode `600` from this template. `serverAddr`, `serverPort`, `user` and `token` come from your operator; `webServer` matches the entry.

   ```json
   {
     "serverAddr": "<server>",
     "serverPort": 7000,
     "user": "<user>",
     "loginFailExit": false,
     "auth": { "method": "token", "token": "<token>" },
     "transport": {
       "tls": { "enable": true, "trustedCaFile": "<ca>", "serverName": "<server>" }
     },
     "webServer": {
       "addr": "127.0.0.1", "port": 7400, "user": "<admin_user>", "password": "<admin_password>"
     },
     "includes": ["/home/<you>/.bakers/frp/routes.json"]
   }
   ```

   frpc verifies the server certificate against `trustedCaFile`, the system CA bundle: `/etc/ssl/certs/ca-certificates.crt` (Debian, Ubuntu), `/etc/pki/tls/certs/ca-bundle.crt` (Fedora, RHEL) or `/etc/ssl/cert.pem` (macOS).
4. **Create the `includes` directory, then run `frpc -c <client_config_path>` as a user service**: a `systemd --user` unit on Linux ([frp's guide](https://gofrp.org/en/docs/setup/systemd/)), a launchd agent on macOS.

To undo it, stop and remove that service and delete `client_config_path`; `routes.json` and the ports entry stay.

## Options

<!-- @options @bakers-build/addon-ports-frp -->

## Check it works

Use `bakers ports list`, then `bakers ports up <service-key>` with the conductor running. Sharing returns a `https://<ticket>-<key>.<zone>` URL that serves it.

If sharing stays off, check in order:

1. `ls -l <client_config_path>` shows `-rw-------`.
2. `frpc verify -c <client_config_path>` prints `syntax is ok`.
3. The frpc user service is active.
4. `curl -u <admin_user>:<admin_password> http://127.0.0.1:<admin_port>/api/status` answers.

## Good to know

- The URL exposes the service publicly. Stop sharing with `bakers ports down <service-key>` when finished.

- It writes only `<BAKERS_HOME>/frp/routes.json`. It never starts `frpc`. It reads the client config to validate it, but does not use its server-auth token.
- A client config of the wrong shape is rejected before anything changes.
- A service whose claim names a container address is proxied straight to that IP. An unreachable IP, for example on Docker Desktop, fails that service; OrbStack works.
- An HTTPS origin is shared only when its rule allows skipping certificate checks, because frp's `http2https` plugin cannot verify it.

Package source in a checkout: `bakers-cli/addons/ports-frp`.
