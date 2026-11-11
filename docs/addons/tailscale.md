# Tailscale

`@bakers-build/addon-tailscale` discovers this machine's Tailscale IPv4 address
once when a conductor serve process starts. It publishes an SSH connection URL
through the normal machine registration. It works only in machine scope.

Install and sign in to Tailscale yourself, and configure a reachable SSH server
and account separately. The addon installs or enables neither service.

Add this entry to `~/.bakers/machine.config.js`, keeping your existing addons:

```js
{ use: '@bakers-build/addon-tailscale', with: { ssh_user: 'christian', ssh_port: 22 } }
```

`ssh_user` is required; `ssh_port` defaults to 22 and must be an integer from
1 through 65535. Start the conductor, then open the machine's Identity card to
see and copy the connection address. No browser terminal or login is launched.

A manual `connection_url` takes precedence, including explicit `null` to clear
the saved address. `tailscale ip -4` runs without a shell, with a three-second
limit and 4096-byte output cap. Missing Tailscale, timeout, failure or anything
other than one IPv4 address leaves registration data unchanged. IPv6-only
Tailscale discovery is unsupported; a manual IPv6 SSH address works.

The addon never writes local configuration or calls Drupal directly. Later
heartbeats preserve the saved URL. Restart the conductor after address or user
changes; the saved URL is not a reachability or authentication guarantee.
