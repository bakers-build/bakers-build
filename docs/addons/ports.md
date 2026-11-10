# Ports

**Shares a running service of a ticket's worktree under a public URL.**

Share a site, Mailpit or Storybook.

The `bakers ports` commands ship with the CLI. The addon entry adds the **Share tunnels** message to tickets.

## Enable it

1. Add the package to `addons` with one tunnel transport in its `with.transport`, usually in `~/.bakers/machine.config.js`: [Named Cloudflare](/addons/ports-cloudflare) and [frp](/addons/ports-frp) give a fixed name (`https://<ticket>-<key>.<zone>`), [Cloudflare Quick](/addons/ports-cloudflare-quick) an allocated `trycloudflare.com` URL. Named Cloudflare and frp also need their connector running on that machine.

   ```js
   addons: [
     {
       use: '@bakers-build/addon-ports',
       with: { transport: { use: '@bakers-build/addon-ports-cloudflare-quick' } },
     },
   ],
   ```

   It may also go in the project's `.bakers/project.config.js`; with both, machine settings take precedence and `services` merge by key ([merge rules](/addons/ports-services#options)). Restart the conductor after a change.

The conductor registers the addon; a **Share tunnels** message then appears in the message card of every ticket it works, in the web UI and in `bakers ui`. Anyone who may read the ticket may send it.

## Options

| Option | Meaning |
|---|---|
| `transport.use` | The transport package. Required for `bakers ports up`, `down`, `reap` and the **Share tunnels** message. |
| `transport.with` | The transport's own settings; see each transport's page and [Shared service tunnels](/configuration/machine#shared-service-tunnels-bakers-ports). |
| `claimers` | Runtime claimer packages; see [Shared processes](/addons/ports-services). |
| `services`, `all_node` | Which host processes are shared; see [Shared processes](/addons/ports-services). |

Without a ports entry with `transport.use`, tunnel commands refuse with `bakers ports needs '@bakers-build/addon-ports' in addons[] …`; `bakers ports list` still works. Projects naming different transports are refused at runtime. A top-level `ports` key in the machine file is retired; `bakers config upgrade --scope machine` moves it into the entry.

## Check it works

Start the intended service in the ticket worktree first. **Share tunnels** invokes the same `ports_up` tool an agent can call and returns URLs or an error. It does not start the service.

::: details Per CLI
```sh
bakers config check --scope machine
bakers ports list                         # every claimed service of this worktree
bakers ports up [service-key] [--ticket <id>]
bakers ports status
bakers ports down [service-key]
bakers ports reap                         # machine-wide reconciliation
```

`list` shows a claimed service; `up` returns a public URL. Others need the [conductor](/addons/build/tools).
:::

## Good to know

- Only claimed services get a tunnel: host processes by [`services`](/addons/ports-services), runtime services by `claimers`. A service key comes from `list`, never a raw port; `up` alone shares every eligible one.
- In `bakers ui`, select the Overview message card to send **Share tunnels**.
- Reap is no message: run `bakers ports reap` or wire the [`after_done` hook](/provision/hooks#clean-up-a-preview), so a finished ticket leaves no tunnel behind.
- A public URL is reachable from the internet while the tunnel lives.

::: tip Ask your AI
"Add the ports addon with a transport to my machine file's addons, then run the checks."
:::

Package source in a checkout: `bakers-cli/addons/ports`.
